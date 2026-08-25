// Resolves how much of each stocked product a given sale consumes.
// Composite products (those with recipe_lines) consume their components;
// everything else consumes itself. One level of nesting - components are
// always leaf, stocked products.
import { adjustPoolStock } from './stock.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export async function consumptionFor(req, productId, qty) {
  const out = new Map();
  const { rows } = await req.q(
    'SELECT component_id, quantity FROM recipe_lines WHERE product_id = $1',
    [productId]
  );
  if (!rows.length) {
    out.set(productId, r3((out.get(productId) ?? 0) + qty));
    return out;
  }
  for (const row of rows) {
    out.set(
      row.component_id,
      r3((out.get(row.component_id) ?? 0) + Number(row.quantity) * qty)
    );
  }
  return out;
}

export async function consumptionForLines(req, lines) {
  const total = new Map();
  for (const line of lines) {
    const part = await consumptionFor(req, line.productId, line.quantity);
    for (const [id, qty] of part) {
      total.set(id, r3((total.get(id) ?? 0) + qty));
    }
  }
  return total;
}

// Restocks exactly what a sale consumed (refunds, cancels), into the same
// stock pool the sale drew from.
export async function restockForLines(req, lines, { reason, orderId, tid, userId, locationId = null }) {
  const needs = await consumptionForLines(req, lines);
  for (const [productId, qty] of needs) {
    await adjustPoolStock(req, locationId, productId, qty);
    await req.q(
      `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, order_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, productId, qty, reason, orderId, userId]
    );
  }
  return needs;
}
