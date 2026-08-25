import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../lib/api.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const settingsRouter = Router();

const settingsInput = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[a-zA-Z]{3}$/, 'Use a 3-letter currency code')
    .transform((v) => v.toUpperCase())
    .optional(),
  taxRate: z.number().min(0).max(99.99).optional(),
  receiptFooter: z.string().trim().max(300).optional().nullable(),
  surchargePct: z.number().min(0).max(99.99).optional(),
  cashRounding: z.enum(['none', 'step5', 'step10', 'step100']).optional(),
  loyaltyEarnPerUnit: z.number().int().min(0).max(1000).optional(),
  loyaltyPointCents: z.number().int().min(1).max(10000).optional(),
});

function tenantOut(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    taxRate: Number(row.tax_rate),
    address: row.address ?? null,
    phone: row.phone ?? null,
    receiptFooter: row.receipt_footer ?? null,
    surchargePct: Number(row.surcharge_pct ?? 0),
    cashRounding: row.cash_rounding ?? 'none',
    loyaltyPointCents: Number(row.loyalty_point_cents ?? 1),
    loyaltyEarnPerUnit: Number(row.loyalty_earn_per_unit ?? 1),
  };
}

settingsRouter.patch(
  '/',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const b = settingsInput.parse(req.body);
    const sets = [];
    const params = [];
    if (b.name !== undefined) { params.push(b.name); sets.push(`name = $${params.length}`); }
    if (b.address !== undefined) { params.push(b.address); sets.push(`address = $${params.length}`); }
    if (b.phone !== undefined) { params.push(b.phone); sets.push(`phone = $${params.length}`); }
    if (b.currency !== undefined) { params.push(b.currency); sets.push(`currency = $${params.length}`); }
    if (b.taxRate !== undefined) { params.push(b.taxRate); sets.push(`tax_rate = $${params.length}`); }
    if (b.receiptFooter !== undefined) { params.push(b.receiptFooter); sets.push(`receipt_footer = $${params.length}`); }
    if (b.surchargePct !== undefined) { params.push(b.surchargePct); sets.push(`surcharge_pct = $${params.length}`); }
    if (b.cashRounding !== undefined) { params.push(b.cashRounding); sets.push(`cash_rounding = $${params.length}`); }
    if (b.loyaltyEarnPerUnit !== undefined) { params.push(b.loyaltyEarnPerUnit); sets.push(`loyalty_earn_per_unit = $${params.length}`); }
    if (b.loyaltyPointCents !== undefined) { params.push(b.loyaltyPointCents); sets.push(`loyalty_point_cents = $${params.length}`); }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.auth.tid);
    await req.q(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    const row = (
      await req.q('SELECT * FROM tenants WHERE id = $1', [req.auth.tid])
    ).rows[0];
    await audit(req, 'settings.updated', 'tenant', req.auth.tid, { fields: Object.keys(b) });
    res.json({ tenant: tenantOut(row) });
  })
);
