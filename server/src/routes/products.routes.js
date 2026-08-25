import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, toUpdate } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const productsRouter = Router();

const nullifyEmpty = (v) => (v === '' ? null : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional().nullable().transform(nullifyEmpty),
  barcode: z.string().trim().max(60).optional().nullable().transform(nullifyEmpty),
  emoji: z.string().trim().min(1).max(8).default('📦'),
  categoryId: z.string().uuid().optional().nullable().transform(nullifyEmpty),
  price: z.number().min(0).max(10_000_000),
  cost: z.number().min(0).max(10_000_000).default(0),
  stock: z
    .number()
    .min(0)
    .max(1_000_000)
    .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places')
    .default(0),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  isActive: z.boolean().default(true),
  parentId: z.string().uuid().optional().nullable().transform(nullifyEmpty),
  variantLabel: z.string().trim().max(40).optional().nullable().transform(nullifyEmpty),
  soldBy: z.enum(['unit', 'weight', 'length']).default('unit'),
  unitLabel: z.string().trim().max(8).optional().nullable().transform(nullifyEmpty),
  reorderQty: z.number().int().min(0).max(1_000_000).default(0),
});

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '', categoryId = '', includeInactive = 'false' } = req.query;
    const clauses = [];
    const params = [];
    if (includeInactive !== 'true') clauses.push('p.is_active');
    if (categoryId) {
      params.push(categoryId);
      clauses.push(`p.category_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      clauses.push(
        `(lower(p.name) LIKE $${params.length} OR lower(p.sku) LIKE $${params.length})`
      );
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await req.q(
      `SELECT p.*, c.name AS category_name, c.color AS category_color,
              EXISTS (SELECT 1 FROM recipe_lines r WHERE r.product_id = p.id) AS has_recipe,
              EXISTS (SELECT 1 FROM products ch WHERE ch.parent_id = p.id) AS has_children
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       ORDER BY COALESCE(p.parent_id, p.id), p.variant_label NULLS FIRST, p.name ASC`,
      params
    );
    res.json(rows.map(serialize));
  })
);

productsRouter.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!code) throw new ApiError(400, 'code query parameter required');
    const { rows } = await req.q(
      `SELECT * FROM products WHERE (sku = $1 OR barcode = $1) AND is_active LIMIT 1`,
      [code]
    );
    if (!rows[0]) throw new ApiError(404, 'No product matches that code');
    res.json(serialize(rows[0]));
  })
);

productsRouter.post(
  '/',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const b = productInput.parse(req.body);
    if (b.parentId) {
      const parent = (
        await req.q('SELECT id FROM products WHERE id = $1', [b.parentId])
      ).rows[0];
      if (!parent) throw new ApiError(400, 'Parent product not found');
    }
    const { rows } = await req.q(
      `INSERT INTO products
         (tenant_id, category_id, sku, barcode, name, emoji, price, cost, stock,
          low_stock_threshold, is_active, parent_id, variant_label, sold_by, unit_label, reorder_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        req.auth.tid, b.categoryId, b.sku, b.barcode, b.name, b.emoji,
        b.price, b.cost, b.stock, b.lowStockThreshold, b.isActive,
        b.parentId, b.variantLabel, b.soldBy, b.unitLabel, b.reorderQty,
      ]
    );
    if (b.stock > 0) {
      await req.q(
        `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, created_by)
         VALUES ($1,$2,$3,'initial',$4)`,
        [req.auth.tid, rows[0].id, b.stock, req.auth.userId]
      );
    }
    await audit(req, 'product.created', 'product', rows[0].id, { name: b.name });
    res.status(201).json(serialize(rows[0]));
  })
);

productsRouter.patch(
  '/:id',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const partial = productInput.partial();
    const b = partial.parse(req.body);
    delete b.stock;
    const upd = toUpdate(b, {
      name: 'name',
      sku: 'sku',
      barcode: 'barcode',
      emoji: 'emoji',
      categoryId: 'category_id',
      price: 'price',
      cost: 'cost',
      lowStockThreshold: 'low_stock_threshold',
      isActive: 'is_active',
      parentId: 'parent_id',
      variantLabel: 'variant_label',
      soldBy: 'sold_by',
      unitLabel: 'unit_label',
      reorderQty: 'reorder_qty',
    });
    if (!upd) throw new ApiError(400, 'Nothing to update');
    const { rows } = await req.q(
      `UPDATE products SET ${upd.assignments.join(', ')}, updated_at = now()
       WHERE id = $${upd.values.length + 1}
       RETURNING *`,
      [...upd.values, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Product not found');
    await audit(req, 'product.updated', 'product', req.params.id, { fields: Object.keys(b) });
    res.json(serialize(rows[0]));
  })
);

productsRouter.post(
  '/:id/adjust',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      delta: z
        .number()
        .refine((v) => v !== 0, 'Delta cannot be zero')
        .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
      note: z.string().trim().max(300).optional().nullable(),
    });
    const { delta, note } = schema.parse(req.body);
    const current = (
      await req.q('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ])
    ).rows[0];
    if (!current) throw new ApiError(404, 'Product not found');
    if (Number(current.stock) + delta < 0) {
      throw new ApiError(400, `Adjustment would take stock below zero (currently ${current.stock})`);
    }
    const { rows } = await req.q(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2 RETURNING *',
      [delta, req.params.id]
    );
    await req.q(
      `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, note, created_by)
       VALUES ($1,$2,$3,'adjustment',$4,$5)`,
      [req.auth.tid, req.params.id, delta, note ?? null, req.auth.userId]
    );
    await audit(req, 'product.stock_adjusted', 'product', req.params.id, { delta, note: note ?? null });
    res.json(serialize(rows[0]));
  })
);

// ---- Recipes / BOM ----

productsRouter.get(
  '/:id/recipe',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT r.component_id, r.quantity, p.name, p.emoji, p.stock, p.cost, p.sold_by, p.unit_label
       FROM recipe_lines r
       JOIN products p ON p.id = r.component_id
       WHERE r.product_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json(
      rows.map((r) => ({
        componentId: r.component_id,
        name: r.name,
        emoji: r.emoji,
        quantity: Number(r.quantity),
        stock: Number(r.stock),
        unitCost: Number(r.cost ?? 0),
        soldBy: r.sold_by,
        unitLabel: r.unit_label,
      }))
    );
  })
);

// Replace the whole recipe. Components must be leaf products (no recipe of
// their own) and cannot include the product itself.
productsRouter.put(
  '/:id/recipe',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      components: z
        .array(
          z.object({
            componentId: z.string().uuid(),
            quantity: z
              .number()
              .positive()
              .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places'),
          })
        )
        .max(50),
    });
    const { components } = schema.parse(req.body);
    const ids = components.map((c) => c.componentId);
    if (ids.includes(req.params.id)) throw new ApiError(400, 'A product cannot be its own ingredient');
    if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Duplicate ingredients');

    if (ids.length) {
      const { rows: bad } = await req.q(
        `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND is_active = false`,
        [ids]
      );
      if (bad.length) throw new ApiError(400, 'Ingredients must be active products');
      const { rows: nested } = await req.q(
        `SELECT DISTINCT product_id FROM recipe_lines WHERE product_id = ANY($1::uuid[])`,
        [ids]
      );
      if (nested.length) throw new ApiError(400, 'Ingredients cannot themselves be recipes');
    }

    await req.q('DELETE FROM recipe_lines WHERE product_id = $1', [req.params.id]);
    for (const c of components) {
      await req.q(
        `INSERT INTO recipe_lines (tenant_id, product_id, component_id, quantity)
         VALUES ($1,$2,$3,$4)`,
        [req.auth.tid, req.params.id, c.componentId, c.quantity]
      );
    }
    const { rows } = await req.q(
      `SELECT r.component_id, r.quantity, p.name, p.emoji, p.stock, p.cost, p.sold_by, p.unit_label
       FROM recipe_lines r
       JOIN products p ON p.id = r.component_id
       WHERE r.product_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json(
      rows.map((r) => ({
        componentId: r.component_id,
        name: r.name,
        emoji: r.emoji,
        quantity: Number(r.quantity),
        stock: Number(r.stock),
        unitCost: Number(r.cost ?? 0),
        soldBy: r.sold_by,
        unitLabel: r.unit_label,
      }))
    );
  })
);

function serialize(p) {
  return {
    id: p.id,
    categoryId: p.category_id,
    categoryName: p.category_name ?? null,
    categoryColor: p.category_color ?? null,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    emoji: p.emoji,
    price: Number(p.price),
    cost: Number(p.cost),
    stock: Number(p.stock),
    lowStockThreshold: p.low_stock_threshold,
    isActive: p.is_active,
    parentId: p.parent_id ?? null,
    variantLabel: p.variant_label ?? null,
    soldBy: p.sold_by ?? 'unit',
    unitLabel: p.unit_label ?? null,
    reorderQty: p.reorder_qty ?? 0,
    hasRecipe: Boolean(p.has_recipe),
    hasChildren: Boolean(p.has_children),
    createdAt: p.created_at,
  };
}
