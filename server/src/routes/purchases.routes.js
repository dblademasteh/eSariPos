import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';

export const purchasesRouter = Router();

purchasesRouter.use(requirePerm('inventory'));

const r3 = (v) => Math.round(v * 1000) / 1000;

const lineInput = z.object({
  productId: z.string().uuid(),
  quantity: z
    .number()
    .positive()
    .max(1_000_000)
    .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
  unitCost: z.number().min(0).max(10_000_000),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(lineInput).min(1).max(200),
});

async function loadHeader(req, id) {
  const { rows } = await req.q(
    `SELECT po.*, s.name AS supplier_name, u.name AS created_by_name
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE po.id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Purchase order not found');
  return rows[0];
}

async function loadLines(req, poId) {
  const { rows } = await req.q(
    `SELECT l.*, p.name AS product_name, p.sku
     FROM po_lines l JOIN products p ON p.id = l.product_id
     WHERE l.po_id = $1 ORDER BY l.id`,
    [poId]
  );
  return rows;
}

function serializeHeader(po, lines) {
  const total = lines.reduce((s, l) => s + Number(l.unit_cost) * Number(l.quantity), 0);
  const receivedTotal = lines.reduce((s, l) => s + Number(l.unit_cost) * Number(l.received_qty), 0);
  return {
    id: po.id,
    status: po.status,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    note: po.note ?? null,
    receivedAt: po.received_at,
    createdBy: po.created_by_name ?? null,
    createdAt: po.created_at,
    lineCount: lines.length,
    totalCost: Math.round(total * 100) / 100,
    receivedCost: Math.round(receivedTotal * 100) / 100,
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: l.product_name,
      sku: l.sku,
      quantity: Number(l.quantity),
      unitCost: Number(l.unit_cost),
      receivedQty: Number(l.received_qty),
      lineTotal: Math.round(Number(l.unit_cost) * Number(l.quantity) * 100) / 100,
    })),
  };
}

purchasesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status = '', limit = '50' } = req.query;
    const clauses = [];
    const params = [];
    if (status && status !== 'all') {
      params.push(String(status));
      clauses.push(`po.status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 50, 200));
    const { rows } = await req.q(
      `SELECT po.*, s.name AS supplier_name,
              (SELECT count(*) FROM po_lines l WHERE l.po_id = po.id) AS line_count,
              (SELECT COALESCE(SUM(l.unit_cost * l.quantity),0) FROM po_lines l WHERE l.po_id = po.id) AS total_cost
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       ${where}
       ORDER BY po.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(
      rows.map((po) => ({
        id: po.id,
        status: po.status,
        supplierName: po.supplier_name,
        lineCount: Number(po.line_count),
        totalCost: Number(po.total_cost),
        createdAt: po.created_at,
        receivedAt: po.received_at,
        note: po.note ?? null,
      }))
    );
  })
);

purchasesRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const coverageDays = Math.min(Math.max(Number(req.query.coverageDays) || 14, 3), 60);
    const { rows } = await req.q(
      `WITH velocity AS (
         SELECT oi.product_id,
                SUM(oi.quantity - oi.refunded_qty) / $1::numeric AS sold_per_day
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN ('completed','partially_refunded','refunded')
           AND o.created_at >= now() - ($1::int * interval '1 day')
           AND oi.product_id IS NOT NULL
         GROUP BY oi.product_id
       )
       SELECT p.id, p.name, p.emoji, p.stock, p.low_stock_threshold,
              p.reorder_qty, p.cost,
              COALESCE(v.sold_per_day, 0) AS sold_per_day
       FROM products p
       LEFT JOIN velocity v ON v.product_id = p.id
       WHERE p.is_active AND p.parent_id IS NULL AND p.stock <= p.low_stock_threshold
       ORDER BY p.stock ASC
       LIMIT 100`,
      [days]
    );
    res.json(
      rows.map((p) => {
        const stock = Number(p.stock);
        const threshold = p.low_stock_threshold;
        const avgDaily = Number(p.sold_per_day);
        let base = p.reorder_qty > 0 ? p.reorder_qty : Math.ceil(avgDaily * coverageDays);
        if (base <= 0 && avgDaily <= 0) base = threshold * 2;
        const suggested = Math.max(r3(base - stock), 1);
        return {
          productId: p.id,
          name: p.name,
          emoji: p.emoji,
          stock,
          lowStockThreshold: threshold,
          reorderQty: p.reorder_qty,
          avgDailySales: Math.round(avgDaily * 1000) / 1000,
          suggestedQty: suggested,
          lastCost: Number(p.cost ?? 0),
        };
      })
    );
  })
);

purchasesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const header = await loadHeader(req, req.params.id);
    const lines = await loadLines(req, req.params.id);
    res.json(serializeHeader(header, lines));
  })
);

purchasesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const supplier = (
      await req.q('SELECT id FROM suppliers WHERE id = $1 AND is_active', [b.supplierId])
    ).rows[0];
    if (!supplier) throw new ApiError(400, 'Supplier not found or inactive');

    const { rows: poRows } = await req.q(
      `INSERT INTO purchase_orders (tenant_id, supplier_id, note, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.auth.tid, b.supplierId, b.note ?? null, req.auth.userId]
    );
    for (const line of b.lines) {
      await req.q(
        `INSERT INTO po_lines (tenant_id, po_id, product_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.auth.tid, poRows[0].id, line.productId, line.quantity, line.unitCost]
      );
    }
    const header = await loadHeader(req, poRows[0].id);
    const lines = await loadLines(req, poRows[0].id);
    res.status(201).json(serializeHeader(header, lines));
  })
);

// Replace draft lines / note before sending.
purchasesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      note: z.string().trim().max(500).optional().nullable(),
      lines: z.array(lineInput).min(1).max(200).optional(),
    });
    const b = schema.parse(req.body);
    const po = await loadHeader(req, req.params.id);
    if (po.status !== 'draft') throw new ApiError(409, 'Only draft purchase orders can be edited');

    if (b.note !== undefined) {
      await req.q('UPDATE purchase_orders SET note = $1 WHERE id = $2', [b.note, po.id]);
    }
    if (b.lines) {
      await req.q('DELETE FROM po_lines WHERE po_id = $1', [po.id]);
      for (const line of b.lines) {
        await req.q(
          `INSERT INTO po_lines (tenant_id, po_id, product_id, quantity, unit_cost)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.auth.tid, po.id, line.productId, line.quantity, line.unitCost]
        );
      }
    }
    const header = await loadHeader(req, po.id);
    const lines = await loadLines(req, po.id);
    res.json(serializeHeader(header, lines));
  })
);

purchasesRouter.post(
  '/:id/send',
  asyncHandler(async (req, res) => {
    const po = await loadHeader(req, req.params.id);
    if (po.status !== 'draft') throw new ApiError(409, 'Only draft purchase orders can be sent');
    await req.q("UPDATE purchase_orders SET status = 'sent' WHERE id = $1", [po.id]);
    const header = await loadHeader(req, po.id);
    const lines = await loadLines(req, po.id);
    res.json(serializeHeader(header, lines));
  })
);

// Receive some or all remaining quantities. Stock is incremented immediately
// and each received line updates the product's cost to the PO unit cost.
purchasesRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      lines: z
        .array(
          z.object({
            lineId: z.string().uuid(),
            quantity: z.number().positive().refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
          })
        )
        .max(200)
        .optional(),
    });
    const b = schema.parse(req.body ?? {});
    const po = await loadHeader(req, req.params.id);
    if (!['sent', 'partial'].includes(po.status)) {
      throw new ApiError(409, `Cannot receive a ${po.status} purchase order`);
    }

    const lines = await loadLines(req, po.id);
    const byLineId = new Map(lines.map((l) => [l.id, l]));
    const targets = b.lines?.length
      ? b.lines
      : lines.map((l) => ({ lineId: l.id, quantity: Number(l.quantity) - Number(l.received_qty) }));

    for (const t of targets) {
      const line = byLineId.get(t.lineId);
      if (!line) throw new ApiError(400, 'Line does not belong to this purchase order');
      const remaining = r3(Number(line.quantity) - Number(line.received_qty));
      if (t.quantity > remaining + 1e-9) {
        throw new ApiError(400, `Only ${remaining} × ${line.product_name} left to receive`);
      }
      await req.q(
        'UPDATE po_lines SET received_qty = received_qty + $1 WHERE id = $2',
        [t.quantity, line.id]
      );
      await req.q(
        'UPDATE products SET stock = stock + $1, cost = $2, updated_at = now() WHERE id = $3',
        [t.quantity, line.unit_cost, line.product_id]
      );
      await req.q(
        `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, note, created_by)
         VALUES ($1,$2,$3,'restock',$4,$5)`,
        [req.auth.tid, line.product_id, t.quantity, `PO received`, req.auth.userId]
      );
    }

    const after = await loadLines(req, po.id);
    const fullyReceived = after.every((l) => Number(l.received_qty) >= Number(l.quantity));
    const anyReceived = after.some((l) => Number(l.received_qty) > 0);
    const nextStatus = fullyReceived ? 'received' : anyReceived ? 'partial' : po.status;
    await req.q(
      'UPDATE purchase_orders SET status = $1, received_at = $2 WHERE id = $3',
      [nextStatus, fullyReceived ? new Date() : null, po.id]
    );

    const header = await loadHeader(req, po.id);
    res.json(serializeHeader(header, after));
  })
);

purchasesRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const po = await loadHeader(req, req.params.id);
    if (!['draft', 'sent'].includes(po.status)) {
      throw new ApiError(409, 'Only draft or sent purchase orders can be cancelled');
    }
    await req.q("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", [po.id]);
    const header = await loadHeader(req, po.id);
    const lines = await loadLines(req, po.id);
    res.json(serializeHeader(header, lines));
  })
);
