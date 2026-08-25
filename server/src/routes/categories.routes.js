import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, toUpdate } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';

export const categoriesRouter = Router();

const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488')
    .default('#0d9488'),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT c.*, (SELECT count(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.sort_order, c.name`
    );
    res.json(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        sortOrder: c.sort_order,
        productCount: Number(c.product_count),
      }))
    );
  })
);

categoriesRouter.post(
  '/',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const b = categoryInput.parse(req.body);
    try {
      const { rows } = await req.q(
        'INSERT INTO categories (tenant_id, name, color, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.auth.tid, b.name, b.color, b.sortOrder]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'A category with that name exists');
      throw err;
    }
  })
);

categoriesRouter.patch(
  '/:id',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const b = categoryInput.partial().parse(req.body);
    const upd = toUpdate(b, {
      name: 'name',
      color: 'color',
      sortOrder: 'sort_order',
    });
    if (!upd) throw new ApiError(400, 'Nothing to update');
    try {
      const { rows } = await req.q(
        `UPDATE categories SET ${upd.assignments.join(', ')} WHERE id = $${upd.values.length + 1} RETURNING *`,
        [...upd.values, req.params.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Category not found');
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'A category with that name exists');
      throw err;
    }
  })
);

categoriesRouter.delete(
  '/:id',
  requirePerm('products'),
  asyncHandler(async (req, res) => {
    const inUse = await req.q('SELECT count(*) AS n FROM products WHERE category_id = $1', [
      req.params.id,
    ]);
    if (Number(inUse.rows[0].n) > 0) {
      throw new ApiError(409, 'Move or remove its products before deleting this category');
    }
    const { rowCount } = await req.q('DELETE FROM categories WHERE id = $1', [
      req.params.id,
    ]);
    if (!rowCount) throw new ApiError(404, 'Category not found');
    res.json({ ok: true });
  })
);
