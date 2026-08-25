// Per-location stock pools. The default pool lives in products.stock; every
// named location keeps quantities in location_stock.
import { ApiError } from './api.js';

export async function getDefaultLocation(req) {
  const { rows } = await req.q('SELECT id FROM locations WHERE is_default LIMIT 1');
  return rows[0]?.id ?? null;
}

export async function readPoolStock(req, locationId, productId) {
  if (!locationId) {
    const { rows } = await req.q('SELECT stock FROM products WHERE id = $1', [productId]);
    return Number(rows[0]?.stock ?? 0);
  }
  const { rows } = await req.q(
    'SELECT qty FROM location_stock WHERE location_id = $1 AND product_id = $2',
    [locationId, productId]
  );
  return Number(rows[0]?.qty ?? 0);
}

export async function adjustPoolStock(req, locationId, productId, delta) {
  if (!locationId) {
    await req.q(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2',
      [delta, productId]
    );
    return;
  }
  // UPDATE-first: proposing a negative INSERT candidate would trip the
  // qty >= 0 CHECK even when the conflict-update branch would win.
  const { rowCount } = await req.q(
    'UPDATE location_stock SET qty = qty + $1 WHERE location_id = $2 AND product_id = $3',
    [delta, locationId, productId]
  );
  if (!rowCount) {
    await req.q(
      `INSERT INTO location_stock (tenant_id, location_id, product_id, qty)
       VALUES ($1,$2,$3,$4)`,
      [req.auth.tid, locationId, productId, delta]
    );
  }
}

// Validates a client-supplied location id. null/undefined means the main pool.
export async function resolveOrderLocation(req, locationId) {
  if (!locationId) return null;
  const { rows } = await req.q('SELECT id FROM locations WHERE id = $1', [locationId]);
  if (!rows[0]) throw new ApiError(400, 'Location not found');
  return rows[0].id;
}
