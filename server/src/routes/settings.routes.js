import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../lib/api.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const settingsRouter = Router();

const TIMEZONES = [
  'UTC', 'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Manila',
  'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/Mexico_City', 'Africa/Johannesburg',
];

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
  loyaltyMinRedeem: z.number().int().min(0).max(100000).optional(),
  loyaltyMaxRedemptionPct: z.number().min(0).max(100).optional(),
  loyaltyExpiryDays: z.number().int().min(0).max(3650).optional(),

  inventoryStockMode: z.enum(['track', 'none']).optional(),
  inventoryRequireAdjustmentNote: z.boolean().optional(),
  inventoryAutoReorder: z.boolean().optional(),

  timezone: z.string().trim().optional(),
  taxInclusive: z.boolean().optional(),
  defaultOpeningFloat: z.number().min(0).max(100000).optional(),
  lowStockAlertThreshold: z.number().int().min(0).max(10000).optional(),
  receiptHeader: z.string().trim().max(300).optional().nullable(),
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  defaultPaymentMethod: z.enum(['cash', 'card', 'card_terminal', 'mobile', 'gcash', 'maya', 'other']).optional(),
  tipsEnabled: z.boolean().optional(),
  tipSuggestions: z.string().trim().max(50).optional(),
  autoCloseDrawerHours: z.number().int().min(0).max(24).optional(),
  receiptWidth: z.literal(40).or(z.literal(80)).optional(),

  autoPrintReceipt: z.boolean().optional(),
  openDrawerOnCash: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  maxDiscountPct: z.number().int().min(0).max(100).optional(),
  requireCustomer: z.boolean().optional(),

  tin: z.string().trim().max(30).optional().nullable(),
  birAccreditationNo: z.string().trim().max(50).optional().nullable(),
  machineSerialNo: z.string().trim().max(50).optional().nullable(),
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
    loyaltyMinRedeem: Number(row.loyalty_min_redeem ?? 100),
    loyaltyMaxRedemptionPct: Number(row.loyalty_max_redemption_pct ?? 100),
    loyaltyExpiryDays: Number(row.loyalty_expiry_days ?? 0),
    inventoryStockMode: row.inventory_stock_mode ?? 'track',
    inventoryRequireAdjustmentNote: row.inventory_require_adjustment_note ?? true,
    inventoryAutoReorder: row.inventory_auto_reorder ?? false,

    timezone: row.timezone ?? 'UTC',
    taxInclusive: row.tax_inclusive ?? false,
    defaultOpeningFloat: Number(row.default_opening_float ?? 100),
    lowStockAlertThreshold: Number(row.low_stock_alert_threshold ?? 5),
    receiptHeader: row.receipt_header ?? null,
    logoUrl: row.logo_url ?? null,
    defaultPaymentMethod: row.default_payment_method ?? 'cash',
    tipsEnabled: row.tips_enabled ?? false,
    tipSuggestions: row.tip_suggestions ?? '10,15,20',
    autoCloseDrawerHours: Number(row.auto_close_drawer_hours ?? 0),
    receiptWidth: Number(row.receipt_width ?? 40),
    autoPrintReceipt: row.auto_print_receipt ?? true,
    openDrawerOnCash: row.open_drawer_on_cash ?? true,
    allowNegativeStock: row.allow_negative_stock ?? false,
    maxDiscountPct: Number(row.max_discount_pct ?? 100),
    requireCustomer: row.require_customer ?? false,
    tin: row.tin ?? null,
    birAccreditationNo: row.bir_accreditation_no ?? null,
    machineSerialNo: row.machine_serial_no ?? null,
  };
}

settingsRouter.patch(
  '/',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const b = settingsInput.parse(req.body);
    const sets = [];
    const params = [];

    const COL_MAP = {
      name: 'name',
      address: 'address',
      phone: 'phone',
      currency: 'currency',
      taxRate: 'tax_rate',
      receiptFooter: 'receipt_footer',
      surchargePct: 'surcharge_pct',
      cashRounding: 'cash_rounding',
      loyaltyEarnPerUnit: 'loyalty_earn_per_unit',
      loyaltyPointCents: 'loyalty_point_cents',
      loyaltyMinRedeem: 'loyalty_min_redeem',
      loyaltyMaxRedemptionPct: 'loyalty_max_redemption_pct',
      loyaltyExpiryDays: 'loyalty_expiry_days',
      inventoryStockMode: 'inventory_stock_mode',
      inventoryRequireAdjustmentNote: 'inventory_require_adjustment_note',
      inventoryAutoReorder: 'inventory_auto_reorder',
      timezone: 'timezone',
      taxInclusive: 'tax_inclusive',
      defaultOpeningFloat: 'default_opening_float',
      lowStockAlertThreshold: 'low_stock_alert_threshold',
      receiptHeader: 'receipt_header',
      logoUrl: 'logo_url',
      defaultPaymentMethod: 'default_payment_method',
      tipsEnabled: 'tips_enabled',
      tipSuggestions: 'tip_suggestions',
      autoCloseDrawerHours: 'auto_close_drawer_hours',
      receiptWidth: 'receipt_width',
      autoPrintReceipt: 'auto_print_receipt',
      openDrawerOnCash: 'open_drawer_on_cash',
      allowNegativeStock: 'allow_negative_stock',
      maxDiscountPct: 'max_discount_pct',
      requireCustomer: 'require_customer',
      tin: 'tin',
      birAccreditationNo: 'bir_accreditation_no',
      machineSerialNo: 'machine_serial_no',
    };

    for (const [key, col] of Object.entries(COL_MAP)) {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }

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

settingsRouter.get(
  '/timezones',
  requireRole('owner'),
  asyncHandler(async (_req, res) => {
    res.json(TIMEZONES);
  })
);
