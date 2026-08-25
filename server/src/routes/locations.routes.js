import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';

export const locationsRouter = Router();

// Reads are open to every signed-in role (the register needs its location
// list); stock-mutating operations require the inventory capability.
const r3 = (v) => Math.round(v * 1000) / 1000;

function requireInventory(req, res, next) {
  const granted = req.auth?.perms ?? [];
  if (!granted.includes('inventory')) return next(new ApiError(403, 'You do not have permission to do that'));
  next();
}

// The default location's stock lives in products.stock; every other location
// keeps quantities in location_stock.
async function defaultLocation(req) {
  const { rows } = await req.q(
    'SELECT id FROM locations WHERE is_default LIMIT 1'
  );
  return rows[0] ?? null;
}

async function resolveLocation(req, id, { allowDefault }) {
  if (id === null || id === undefined) {
    if (!allowDefault) throw new ApiError(400, 'A location is required');
    const def = await defaultLocation(req);
    return { id: def?.id ?? null, isDefault: true };
  }
  const { rows } = await req.q('SELECT id, name, is_default FROM locations WHERE id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'Location not found');
  return { id: rows[0].id, name: rows[0].name, isDefault: rows[0].is_default };
}

async function readStockAt(req, loc, productId) {
  if (loc.isDefault || loc.id === null) {
    const { rows } = await req.q('SELECT stock FROM products WHERE id = $1', [productId]);
    return Number(rows[0]?.stock ?? 0);
  }
  const { rows } = await req.q(
    'SELECT qty FROM location_stock WHERE location_id = $1 AND product_id = $2',
    [loc.id, productId]
  );
  return Number(rows[0]?.qty ?? 0);
}

async function adjustStockAt(req, loc, productId, delta) {
  if (loc.isDefault || loc.id === null) {
    await req.q(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2',
      [delta, productId]
    );
    return;
  }
  // UPDATE-first avoids proposing a negative INSERT candidate, which would
  // trip the qty >= 0 CHECK even when the conflict-update branch would win.
  const { rowCount } = await req.q(
    'UPDATE location_stock SET qty = qty + $1 WHERE location_id = $2 AND product_id = $3',
    [delta, loc.id, productId]
  );
  if (!rowCount) {
    await req.q(
      `INSERT INTO location_stock (tenant_id, location_id, product_id, qty)
       VALUES ($1,$2,$3,$4)`,
      [req.auth.tid, loc.id, productId, delta]
    );
  }
}

locationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT l.*,
              (SELECT count(*) FROM location_stock ls WHERE ls.location_id = l.id AND ls.qty > 0) AS stocked_products
       FROM locations l ORDER BY l.is_default DESC, l.name ASC`
    );
    res.json(
      rows.map((l) => ({
        id: l.id,
        name: l.name,
        isDefault: l.is_default,
        stockedProducts: Number(l.stocked_products),
        createdAt: l.created_at,
      }))
    );
  })
);

locationsRouter.post(
  '/',
  requireInventory,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(60),
      isDefault: z.boolean().default(false),
    });
    const b = schema.parse(req.body);
    try {
      if (b.isDefault) {
        // The first default takes over from any previous default.
        await req.q('UPDATE locations SET is_default = false WHERE is_default');
      }
      const { rows } = await req.q(
        'INSERT INTO locations (tenant_id, name, is_default) VALUES ($1,$2,$3) RETURNING *',
        [req.auth.tid, b.name, b.isDefault]
      );
      res.status(201).json({ id: rows[0].id, name: rows[0].name, isDefault: rows[0].is_default });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'A location with that name exists');
      throw err;
    }
  })
);

locationsRouter.patch(
  '/:id',
  requireInventory,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(60).optional(),
      isDefault: z.boolean().optional(),
    });
    const b = schema.parse(req.body);
    const loc = (
      await req.q('SELECT * FROM locations WHERE id = $1 FOR UPDATE', [req.params.id])
    ).rows[0];
    if (!loc) throw new ApiError(404, 'Location not found');

    if (b.isDefault === true) {
      // Moving the default flag relocates where "the shop" keeps its stock:
      // swap products.stock with this location's pooled quantities.
      const { rows: poolRows } = await req.q(
        'SELECT product_id, qty FROM location_stock WHERE location_id = $1',
        [loc.id]
      );
      for (const row of poolRows) {
        await req.q('UPDATE products SET stock = $1, updated_at = now() WHERE id = $2', [
          row.qty,
          row.product_id,
        ]);
      }
      await req.q('DELETE FROM location_stock WHERE location_id = $1', [loc.id]);
      await req.q(
        `INSERT INTO location_stock (tenant_id, location_id, product_id, qty)
         SELECT tenant_id, $1, id, stock FROM products WHERE stock > 0
         ON CONFLICT (location_id, product_id) DO NOTHING`,
        [loc.id]
      );
      await req.q('UPDATE locations SET is_default = false WHERE is_default');
      await req.q('UPDATE locations SET is_default = true WHERE id = $1', [loc.id]);
    } else if (b.isDefault === false && loc.is_default) {
      throw new ApiError(400, 'Assign the default flag to another location instead');
    }

    if (b.name !== undefined) {
      try {
        await req.q('UPDATE locations SET name = $1 WHERE id = $2', [b.name, loc.id]);
      } catch (err) {
        if (err.code === '23505') throw new ApiError(409, 'A location with that name exists');
        throw err;
      }
    }
    res.json({ ok: true });
  })
);

// Inter-location transfers. from/to accept a location id or null for the
// default stock pool. Both movements are journaled in stock_movements with a
// shared reference note so pairs can be correlated.
locationsRouter.post(
  '/transfers',
  requireInventory,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      productId: z.string().uuid(),
      fromLocationId: z.string().uuid().nullable(),
      toLocationId: z.string().uuid().nullable(),
      quantity: z
        .number()
        .positive()
        .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
      note: z.string().trim().max(200).optional().nullable(),
    });
    const b = schema.parse(req.body);
    if (
      (b.fromLocationId ?? null) === (b.toLocationId ?? null)
    ) {
      throw new ApiError(400, 'Source and destination must differ');
    }

    const product = (
      await req.q('SELECT id, name FROM products WHERE id = $1 AND is_active', [b.productId])
    ).rows[0];
    if (!product) throw new ApiError(400, 'Product not found or inactive');

    const from = await resolveLocation(req, b.fromLocationId, { allowDefault: true });
    const to = await resolveLocation(req, b.toLocationId, { allowDefault: true });

    const available = await readStockAt(req, from, product.id);
    if (available < b.quantity - 1e-9) {
      throw new ApiError(400, `Only ${r3(available)} available at the source`);
    }

    const ref = `transfer ${Date.now().toString(36)}`;
    await adjustStockAt(req, from, product.id, -b.quantity);
    await adjustStockAt(req, to, product.id, b.quantity);

    for (const [loc, reason] of [
      [from, 'transfer_out'],
      [to, 'transfer_in'],
    ]) {
      await req.q(
        `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          req.auth.tid,
          product.id,
          reason === 'transfer_out' ? -b.quantity : b.quantity,
          reason,
          `${ref} · ${b.note ?? ''}`.trim(),
          req.auth.userId,
        ]
      );
    }

    res.status(201).json({
      ok: true,
      reference: ref,
      productId: product.id,
      productName: product.name,
      quantity: b.quantity,
      from: from.isDefault ? 'Main stock' : from.name,
      to: to.isDefault ? 'Main stock' : to.name,
    });
  })
);

locationsRouter.get(
  '/transfers',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT m.delta, m.note, m.created_at, p.name AS product_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.reason IN ('transfer_in','transfer_out')
       ORDER BY m.created_at DESC
       LIMIT 100`
    );
    const paired = new Map();
    for (const row of rows) {
      const key = String(row.note ?? '').split(' ·')[0];
      if (!paired.has(key)) paired.set(key, []);
      paired.get(key).push(row);
    }
    res.json(
      [...paired.values()].slice(0, 50).map((pair) => ({
        reference: String(pair[0].note ?? '').split(' ·')[0],
        note: String(pair[0].note ?? '').split('· ')[1] ?? null,
        productName: pair[0].product_name,
        quantity: Math.abs(Number(pair.find((p) => p.delta < 0)?.delta ?? pair[0].delta)),
        createdAt: pair[0].created_at,
      }))
    );
  })
);
