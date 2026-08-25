import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, toUpdate } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const customersRouter = Router();

const nullifyEmpty = (v) => (v === '' ? null : v);

const customerInput = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().nullable().transform(nullifyEmpty),
  email: z.string().trim().email().max(200).optional().nullable().transform(nullifyEmpty),
  note: z.string().trim().max(500).optional().nullable().transform(nullifyEmpty),
});

function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    note: c.note,
    loyaltyPoints: Number(c.loyalty_points ?? 0),
    storeCredit: Number(c.store_credit ?? 0),
    createdAt: c.created_at,
  };
}

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '' } = req.query;
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      where = `WHERE lower(name) LIKE $1 OR lower(coalesce(phone,'')) LIKE $1 OR lower(coalesce(email,'')) LIKE $1`;
    }
    const { rows } = await req.q(
      `SELECT * FROM customers ${where} ORDER BY name ASC LIMIT 200`,
      params
    );
    res.json(rows.map(serialize));
  })
);

// Marketing segments: spend + visit aggregates for every customer.
customersRouter.get(
  '/export',
  requirePerm('reports'),
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 365, 1), 3650);
    const { rows } = await req.q(
      `SELECT c.id, c.name, c.phone, c.email,
              COUNT(o.id) AS visits,
              COALESCE(SUM(GREATEST(o.total - o.refunded_total, 0)), 0) AS lifetime_value,
              COALESCE(SUM(CASE WHEN o.created_at >= now() - ($1::int * interval '1 day')
                THEN GREATEST(o.total - o.refunded_total, 0) ELSE 0 END), 0) AS recent_spend
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id AND o.status IN ('completed','partially_refunded','refunded')
       GROUP BY c.id
       ORDER BY lifetime_value DESC`,
      [days]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        visits: Number(r.visits),
        lifetimeValue: Math.round(Number(r.lifetime_value) * 100) / 100,
        recentSpend: Math.round(Number(r.recent_spend) * 100) / 100,
      }))
    );
  })
);

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = customerInput.parse(req.body);
    const { rows } = await req.q(
      'INSERT INTO customers (tenant_id, name, phone, email, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.auth.tid, b.name, b.phone, b.email, b.note]
    );
    res.status(201).json({ id: rows[0].id });
  })
);

customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = customerInput.partial().parse(req.body);
    const upd = toUpdate(b, { name: 'name', phone: 'phone', email: 'email', note: 'note' });
    if (!upd) throw new ApiError(400, 'Nothing to update');
    const { rowCount } = await req.q(
      `UPDATE customers SET ${upd.assignments.join(', ')} WHERE id = $${upd.values.length + 1}`,
      [...upd.values, req.params.id]
    );
    if (!rowCount) throw new ApiError(404, 'Customer not found');
    res.json({ ok: true });
  })
);

// Profile: identity + loyalty/credit balances + lifetime value.
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = (
      await req.q('SELECT * FROM customers WHERE id = $1', [req.params.id])
    ).rows[0];
    if (!customer) throw new ApiError(404, 'Customer not found');
    const stats = (
      await req.q(
        `SELECT COUNT(*) AS visits,
                COALESCE(SUM(GREATEST(total - refunded_total, 0)), 0) AS ltv,
                MAX(created_at) AS last_visit
         FROM orders
         WHERE customer_id = $1 AND status IN ('completed','partially_refunded','refunded')`,
        [customer.id]
      )
    ).rows[0];
    const orders = (
      await req.q(
        `SELECT id, order_no, total, status, created_at FROM orders
         WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 25`,
        [customer.id]
      )
    ).rows;
    res.json({
      ...serialize(customer),
      stats: {
        visits: Number(stats.visits),
        lifetimeValue: Math.round(Number(stats.ltv) * 100) / 100,
        lastVisit: stats.last_visit,
      },
      orders: orders.map((o) => ({
        id: o.id,
        orderNo: Number(o.order_no),
        total: Number(o.total),
        status: o.status,
        createdAt: o.created_at,
      })),
    });
  })
);

// Add store credit to a customer's account.
customersRouter.post(
  '/:id/topup',
  requirePerm('giftcards'),
  asyncHandler(async (req, res) => {
    const b = z
      .object({ amount: z.number().positive().max(10_000), note: z.string().trim().max(200).optional().nullable().transform(nullifyEmpty) })
      .parse(req.body);
    const { rows } = await req.q(
      'UPDATE customers SET store_credit = store_credit + $1 WHERE id = $2 RETURNING store_credit',
      [b.amount, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Customer not found');
    await audit(req, 'customer.store_credit_topup', 'customer', req.params.id, {
      amount: b.amount,
      note: b.note,
    });
    res.json({ storeCredit: Number(rows[0].store_credit) });
  })
);

// ---- Coupon manager (marketing) ----

const couponInput = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[\w-]+$/, 'Letters, numbers, dashes only')
    .transform((v) => v.toUpperCase()),
  percentOff: z.number().min(0.01).max(100),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().positive().max(1_000_000).nullable().optional(),
});

export const couponsRouter = Router();

couponsRouter.use(requirePerm('reports'));

couponsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200`
    );
    res.json(
      rows.map((c) => ({
        id: c.id,
        code: c.code,
        percentOff: Number(c.percent_off),
        startsAt: c.starts_at,
        endsAt: c.ends_at,
        maxUses: c.max_uses,
        timesUsed: c.times_used,
        isActive: c.is_active,
      }))
    );
  })
);

couponsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = couponInput.parse(req.body);
    try {
      const { rows } = await req.q(
        `INSERT INTO coupons (tenant_id, code, percent_off, starts_at, ends_at, max_uses, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          req.auth.tid,
          b.code,
          b.percentOff,
          b.startsAt ? new Date(b.startsAt) : null,
          b.endsAt ? new Date(b.endsAt) : null,
          b.maxUses ?? null,
          req.auth.userId,
        ]
      );
      await audit(req, 'coupon.created', 'coupon', rows[0].id, { code: b.code });
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'That coupon code already exists');
      throw err;
    }
  })
);

couponsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = z.object({ isActive: z.boolean() }).parse(req.body);
    const { rowCount } = await req.q('UPDATE coupons SET is_active = $1 WHERE id = $2', [
      b.isActive,
      req.params.id,
    ]);
    if (!rowCount) throw new ApiError(404, 'Coupon not found');
    await audit(req, 'coupon.updated', 'coupon', req.params.id, { isActive: b.isActive });
    res.json({ ok: true });
  })
);
