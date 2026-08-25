import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, toUpdate } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';

export const suppliersRouter = Router();

suppliersRouter.use(requirePerm('inventory'));

const nullifyEmpty = (v) => (v === '' ? null : v);

const supplierInput = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120).optional().nullable().transform(nullifyEmpty),
  phone: z.string().trim().max(40).optional().nullable().transform(nullifyEmpty),
  email: z.string().trim().email().max(200).optional().nullable().transform(nullifyEmpty),
  note: z.string().trim().max(500).optional().nullable().transform(nullifyEmpty),
  isActive: z.boolean().default(true),
});

function serialize(s) {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contact_name,
    phone: s.phone,
    email: s.email,
    note: s.note,
    isActive: s.is_active,
    createdAt: s.created_at,
  };
}

suppliersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '', includeInactive = 'false' } = req.query;
    const clauses = [];
    const params = [];
    if (includeInactive !== 'true') clauses.push('s.is_active');
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      clauses.push(`(lower(s.name) LIKE $${params.length} OR lower(coalesce(s.contact_name,'')) LIKE $${params.length})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await req.q(
      `SELECT s.*, (SELECT count(*) FROM purchase_orders po WHERE po.supplier_id = s.id) AS order_count
       FROM suppliers s ${where} ORDER BY s.name ASC LIMIT 300`,
      params
    );
    res.json(rows.map((s) => ({ ...serialize(s), orderCount: Number(s.order_count) })));
  })
);

suppliersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = supplierInput.parse(req.body);
    const { rows } = await req.q(
      `INSERT INTO suppliers (tenant_id, name, contact_name, phone, email, note, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.auth.tid, b.name, b.contactName, b.phone, b.email, b.note, b.isActive]
    );
    res.status(201).json(serialize(rows[0]));
  })
);

suppliersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = supplierInput.partial().parse(req.body);
    const upd = toUpdate(b, {
      name: 'name',
      contactName: 'contact_name',
      phone: 'phone',
      email: 'email',
      note: 'note',
      isActive: 'is_active',
    });
    if (!upd) throw new ApiError(400, 'Nothing to update');
    const { rows } = await req.q(
      `UPDATE suppliers SET ${upd.assignments.join(', ')} WHERE id = $${upd.values.length + 1} RETURNING *`,
      [...upd.values, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Supplier not found');
    res.json(serialize(rows[0]));
  })
);
