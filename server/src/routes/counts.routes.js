import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';

export const countsRouter = Router();

countsRouter.use(requirePerm('inventory'));

const r3 = (v) => Math.round(v * 1000) / 1000;

async function loadCount(req, id) {
  const { rows } = await req.q(
    `SELECT c.*, cat.name AS category_name, u.name AS created_by_name
     FROM stock_counts c
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Stock count not found');
  return rows[0];
}

async function loadLines(req, id) {
  const { rows } = await req.q(
    `SELECT cl.*, p.name AS product_name, p.emoji, p.cost, p.sold_by, p.unit_label
     FROM stock_count_lines cl
     JOIN products p ON p.id = cl.product_id
     WHERE cl.count_id = $1
     ORDER BY p.name`,
    [id]
  );
  return rows.map((l) => ({
    id: l.id,
    productId: l.product_id,
    productName: l.product_name,
    emoji: l.emoji,
    soldBy: l.sold_by,
    unitLabel: l.unit_label,
    systemQty: Number(l.system_qty),
    countedQty: l.counted_qty == null ? null : Number(l.counted_qty),
    variance: l.counted_qty == null ? null : r3(Number(l.counted_qty) - Number(l.system_qty)),
    cost: Number(l.cost ?? 0),
  }));
}

function serialize(c, lines) {
  const varianceValue = lines.reduce(
    (s, l) => (l.variance == null ? s : s + l.variance * l.cost),
    0
  );
  return {
    id: c.id,
    status: c.status,
    categoryId: c.category_id,
    categoryName: c.category_name ?? null,
    note: c.note ?? null,
    appliedAt: c.applied_at,
    createdBy: c.created_by_name ?? null,
    createdAt: c.created_at,
    lineCount: lines.length,
    countedCount: lines.filter((l) => l.countedQty != null).length,
    varianceValue: Math.round(varianceValue * 100) / 100,
    lines,
  };
}

countsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT c.*, cat.name AS category_name,
              (SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = c.id) AS line_count,
              (SELECT count(*) FROM stock_count_lines cl WHERE cl.count_id = c.id AND cl.counted_qty IS NOT NULL) AS counted_count
       FROM stock_counts c
       LEFT JOIN categories cat ON cat.id = c.category_id
       ORDER BY c.created_at DESC LIMIT 50`
    );
    res.json(
      rows.map((c) => ({
        id: c.id,
        status: c.status,
        categoryName: c.category_name ?? null,
        note: c.note ?? null,
        appliedAt: c.applied_at,
        createdAt: c.created_at,
        lineCount: Number(c.line_count),
        countedCount: Number(c.counted_count),
      }))
    );
  })
);

countsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      categoryId: z.string().uuid().optional().nullable(),
      note: z.string().trim().max(300).optional().nullable(),
    });
    const b = schema.parse(req.body ?? {});

    const params = [];
    let where = 'p.is_active AND p.parent_id IS NULL';
    if (b.categoryId) {
      params.push(b.categoryId);
      where += ` AND p.category_id = $${params.length}`;
    }
    const { rows: products } = await req.q(
      `SELECT id, stock FROM products p WHERE ${where} ORDER BY p.name`,
      params
    );
    if (!products.length) throw new ApiError(400, 'No products match this count scope');

    const { rows: countRows } = await req.q(
      `INSERT INTO stock_counts (tenant_id, category_id, note, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.auth.tid, b.categoryId ?? null, b.note ?? null, req.auth.userId]
    );
    for (const p of products) {
      await req.q(
        `INSERT INTO stock_count_lines (tenant_id, count_id, product_id, system_qty)
         VALUES ($1,$2,$3,$4)`,
        [req.auth.tid, countRows[0].id, p.id, p.stock]
      );
    }
    const header = await loadCount(req, countRows[0].id);
    const lines = await loadLines(req, countRows[0].id);
    res.status(201).json(serialize(header, lines));
  })
);

countsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const header = await loadCount(req, req.params.id);
    const lines = await loadLines(req, req.params.id);
    res.json(serialize(header, lines));
  })
);

// Save counting progress. Lines not included keep their previous value;
// pass countedQty: null to clear an entry.
countsRouter.put(
  '/:id/lines',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      entries: z
        .array(
          z.object({
            productId: z.string().uuid(),
            countedQty: z
              .number()
              .min(0)
              .max(1_000_000)
              .nullable()
              .refine((v) => v === null || Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
          })
        )
        .min(1)
        .max(500),
    });
    const b = schema.parse(req.body);
    const count = await loadCount(req, req.params.id);
    if (count.status !== 'open') throw new ApiError(409, 'This count is closed');

    for (const e of b.entries) {
      await req.q(
        `UPDATE stock_count_lines SET counted_qty = $1 WHERE count_id = $2 AND product_id = $3`,
        [e.countedQty, count.id, e.productId]
      );
    }
    const header = await loadCount(req, count.id);
    const lines = await loadLines(req, count.id);
    res.json(serialize(header, lines));
  })
);

// Apply variances: every counted line adjusts product stock to the counted
// quantity and journals a 'count' movement.
countsRouter.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const count = await loadCount(req, req.params.id);
    if (count.status !== 'open') throw new ApiError(409, 'This count is already closed');

    const lines = await loadLines(req, count.id);
    const toApply = lines.filter((l) => l.countedQty != null && l.variance !== 0);
    let varianceValue = 0;

    for (const line of toApply) {
      await req.q('UPDATE products SET stock = $1, updated_at = now() WHERE id = $2', [
        line.countedQty,
        line.productId,
      ]);
      await req.q(
        `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, note, created_by)
         VALUES ($1,$2,$3,'count',$4,$5)`,
        [req.auth.tid, line.productId, line.variance, `Cycle count adjustment`, req.auth.userId]
      );
      varianceValue += line.variance * line.cost;
    }

    await req.q(
      `UPDATE stock_counts SET status = 'applied', applied_at = now(), variance_total = $1 WHERE id = $2`,
      [Math.round(varianceValue * 100) / 100, count.id]
    );
    const header = await loadCount(req, count.id);
    const fresh = await loadLines(req, count.id);
    res.json({ ...serialize(header, fresh), adjustments: toApply.length });
  })
);

countsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const count = await loadCount(req, req.params.id);
    if (count.status !== 'open') throw new ApiError(409, 'This count is already closed');
    await req.q("UPDATE stock_counts SET status = 'cancelled' WHERE id = $1", [count.id]);
    const header = await loadCount(req, count.id);
    const lines = await loadLines(req, count.id);
    res.json(serialize(header, lines));
  })
);
