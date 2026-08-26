import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../lib/api.js';
import { signToken, requireAuth, withTenantSession, hashToken, setAccessCookie, clearAccessCookie } from '../middleware/auth.js';
import { adminPool } from '../db/pool.js';
import { generateSecret, verifyTotp } from '../lib/totp.js';
import { resolvePerms } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

export const authRouter = Router();

const loginSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Business ID may only contain lowercase letters, numbers and dashes'),
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

const LOGIN_SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.password_hash, u.permissions,
         u.is_active AS user_active, u.totp_enabled,
         t.id AS tid, t.slug, t.name AS tenant_name, t.currency, t.tax_rate,
         t.address, t.phone, t.receipt_footer, t.surcharge_pct, t.cash_rounding,
         t.is_active AS tenant_active,
         t.timezone, t.tax_inclusive, t.default_opening_float, t.low_stock_alert_threshold,
         t.receipt_header, t.logo_url, t.default_payment_method,
         t.tips_enabled, t.tip_suggestions, t.auto_close_drawer_hours, t.receipt_width,
         t.tin, t.bir_accreditation_no, t.machine_serial_no,
         t.loyalty_min_redeem, t.loyalty_max_redemption_pct, t.loyalty_expiry_days,
         t.inventory_stock_mode, t.inventory_require_adjustment_note, t.inventory_auto_reorder,
         t.auto_print_receipt, t.open_drawer_on_cash, t.allow_negative_stock,
         t.max_discount_pct, t.require_customer,
         t.setup_completed
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE t.slug = $1 AND u.email = lower($2)
  LIMIT 1`;

function sessionPayload(row) {
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    perms: resolvePerms(row.role, row.permissions),
  };
  const tenant = tenantOut({
    id: row.tid,
    slug: row.slug,
    tax_rate: row.tax_rate,
    address: row.address,
    phone: row.phone,
    receipt_footer: row.receipt_footer,
    surcharge_pct: row.surcharge_pct,
    cash_rounding: row.cash_rounding,
    name: row.tenant_name,
    currency: row.currency,
    timezone: row.timezone,
    tax_inclusive: row.tax_inclusive,
    default_opening_float: row.default_opening_float,
    low_stock_alert_threshold: row.low_stock_alert_threshold,
    receipt_header: row.receipt_header,
    logo_url: row.logo_url,
    default_payment_method: row.default_payment_method,
    tips_enabled: row.tips_enabled,
    tip_suggestions: row.tip_suggestions,
    auto_close_drawer_hours: row.auto_close_drawer_hours,
    receipt_width: row.receipt_width,
    tin: row.tin,
    bir_accreditation_no: row.bir_accreditation_no,
    machine_serial_no: row.machine_serial_no,
    loyalty_min_redeem: row.loyalty_min_redeem,
    loyalty_max_redemption_pct: row.loyalty_max_redemption_pct,
    loyalty_expiry_days: row.loyalty_expiry_days,
    inventory_stock_mode: row.inventory_stock_mode,
    inventory_require_adjustment_note: row.inventory_require_adjustment_note,
    inventory_auto_reorder: row.inventory_auto_reorder,
    auto_print_receipt: row.auto_print_receipt,
    open_drawer_on_cash: row.open_drawer_on_cash,
    allow_negative_stock: row.allow_negative_stock,
    max_discount_pct: row.max_discount_pct,
    require_customer: row.require_customer,
    setup_completed: row.setup_completed,
  });
  return { user, tenant, token: signToken(user, tenant) };
}

// ---- httpOnly refresh-cookie sessions (rotating single-use jti) ----

const COOKIE = 'esaripos_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: 30 * 24 * 3600 * 1000,
  };
}

async function issueRefreshCookie(res, userId) {
  const jti = crypto.randomUUID();
  await adminPool.query('UPDATE users SET refresh_jti = $1 WHERE id = $2', [
    hashToken(jti),
    userId,
  ]);
  res.cookie(COOKIE, `${userId}.${jti}`, refreshCookieOptions());
}

async function readRefresh(req) {
  const header = req.headers.cookie || '';
  const pair = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const raw = pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : null;
  if (!raw) throw new ApiError(401, 'No refresh session');
  const dot = raw.indexOf('.');
  if (dot < 0) throw new ApiError(401, 'Malformed refresh session');
  const userId = raw.slice(0, dot);
  const jti = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new ApiError(401, 'Malformed refresh session');
  const { rows } = await adminPool.query(
    `SELECT u.id, u.refresh_jti, u.is_active AS user_active,
            t.id AS tid
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  // Rotation mismatch means the cookie was already used - reject.
  if (!row || !row.user_active || !row.refresh_jti || row.refresh_jti !== hashToken(jti)) {
    throw new ApiError(401, 'Refresh session expired or reused');
  }
  return { userId: row.id, tid: row.tid, jti };
}

const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use only lowercase letters, numbers and dashes'),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

function tenantOut(t) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    currency: t.currency,
    taxRate: Number(t.tax_rate),
    address: t.address ?? null,
    phone: t.phone ?? null,
    receiptFooter: t.receipt_footer ?? null,
    surchargePct: Number(t.surcharge_pct ?? 0),
    cashRounding: t.cash_rounding ?? 'none',
    loyaltyPointCents: Number(t.loyalty_point_cents ?? 1),
    loyaltyEarnPerUnit: Number(t.loyalty_earn_per_unit ?? 1),
    loyaltyMinRedeem: Number(t.loyalty_min_redeem ?? 100),
    loyaltyMaxRedemptionPct: Number(t.loyalty_max_redemption_pct ?? 100),
    loyaltyExpiryDays: Number(t.loyalty_expiry_days ?? 0),
    inventoryStockMode: t.inventory_stock_mode ?? 'track',
    inventoryRequireAdjustmentNote: t.inventory_require_adjustment_note ?? true,
    inventoryAutoReorder: t.inventory_auto_reorder ?? false,
    timezone: t.timezone ?? 'UTC',
    taxInclusive: t.tax_inclusive ?? false,
    defaultOpeningFloat: Number(t.default_opening_float ?? 100),
    lowStockAlertThreshold: Number(t.low_stock_alert_threshold ?? 5),
    receiptHeader: t.receipt_header ?? null,
    logoUrl: t.logo_url ?? null,
    defaultPaymentMethod: t.default_payment_method ?? 'cash',
    tipsEnabled: t.tips_enabled ?? false,
    tipSuggestions: t.tip_suggestions ?? '10,15,20',
    autoCloseDrawerHours: Number(t.auto_close_drawer_hours ?? 0),
    receiptWidth: Number(t.receipt_width ?? 40),
    autoPrintReceipt: t.auto_print_receipt ?? true,
    openDrawerOnCash: t.open_drawer_on_cash ?? true,
    allowNegativeStock: t.allow_negative_stock ?? false,
    maxDiscountPct: Number(t.max_discount_pct ?? 100),
    requireCustomer: t.require_customer ?? false,
    tin: t.tin ?? null,
    birAccreditationNo: t.bir_accreditation_no ?? null,
    machineSerialNo: t.machine_serial_no ?? null,
    setupCompleted: t.setup_completed ?? false,
  };
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { slug, email, password } = loginSchema.parse(req.body);
    const { rows } = await adminPool.query(LOGIN_SELECT, [slug, email]);
    const row = rows[0];
    const passwordOk = row && (await bcrypt.compare(password, row.password_hash));
    if (!passwordOk || !row.user_active || !row.tenant_active) {
      throw new ApiError(401, 'Invalid business ID, email or password');
    }
    if (row.totp_enabled) {
      const preToken = jwt.sign(
        { sub: row.id, tid: row.tid, stage: '2fa' },
        env.jwtSecret,
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, preToken });
    }
    await issueRefreshCookie(res, row.id);
    const { user, tenant, token } = sessionPayload(row);
    setAccessCookie(res, token);
    res.json({ user, tenant });
  })
);

const verify2faSchema = z.object({
  preToken: z.string().min(20).max(1000),
  code: z.string().trim().max(10),
});

authRouter.post(
  '/verify2fa',
  asyncHandler(async (req, res) => {
    const b = verify2faSchema.parse(req.body);
    let payload;
    try {
      payload = jwt.verify(b.preToken, env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Two-factor session expired - sign in again');
    }
    if (payload.stage !== '2fa') throw new ApiError(401, 'Invalid two-factor session');
    const { rows } = await adminPool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.is_active AS user_active,
              u.totp_enabled, u.totp_secret,
              t.id AS tid, t.slug, t.name AS tenant_name, t.currency, t.tax_rate,
              t.address, t.phone, t.receipt_footer, t.surcharge_pct, t.cash_rounding,
              t.is_active AS tenant_active,
              t.timezone, t.tax_inclusive, t.default_opening_float, t.low_stock_alert_threshold,
              t.receipt_header, t.logo_url, t.default_payment_method,
              t.tips_enabled, t.tip_suggestions, t.auto_close_drawer_hours, t.receipt_width,
              t.tin, t.bir_accreditation_no, t.machine_serial_no,
              t.loyalty_min_redeem, t.loyalty_max_redemption_pct, t.loyalty_expiry_days,
              t.inventory_stock_mode, t.inventory_require_adjustment_note, t.inventory_auto_reorder,
              t.auto_print_receipt, t.open_drawer_on_cash, t.allow_negative_stock,
              t.max_discount_pct, t.require_customer,
              t.setup_completed
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 LIMIT 1`,
      [payload.sub]
    );
    const row = rows[0];
    if (!row || !row.user_active || !row.totp_enabled) {
      throw new ApiError(401, 'Account unavailable');
    }
    if (!verifyTotp(row.totp_secret, b.code)) {
      throw new ApiError(401, 'Invalid authentication code');
    }
    await issueRefreshCookie(res, row.id);
    const { user, tenant, token } = sessionPayload(row);
    setAccessCookie(res, token);
    res.json({ user, tenant });
  })
);

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const b = registerSchema.parse(req.body);
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query('SELECT 1 FROM tenants WHERE slug = $1', [b.slug]);
      if (dup.rows.length) throw new ApiError(409, 'That business ID is already taken');
      const tenant = (
        await client.query('INSERT INTO tenants (slug, name) VALUES ($1,$2) RETURNING *', [
          b.slug,
          b.businessName,
        ])
      ).rows[0];
      const hash = await bcrypt.hash(b.password, 10);
      const user = (
        await client.query(
          `INSERT INTO users (tenant_id, name, email, password_hash, role)
           VALUES ($1,$2,lower($3),$4,'owner')
           RETURNING id, name, email, role`,
          [tenant.id, b.name, b.email, hash]
        )
      ).rows[0];
      await client.query("INSERT INTO categories (tenant_id, name) VALUES ($1,'General')", [
        tenant.id,
      ]);
      await client.query('COMMIT');
      const userFull = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        perms: resolvePerms(user.role, null),
      };
      const tenantFull = tenantOut(tenant);
      await issueRefreshCookie(res, user.id);
      const token = signToken(userFull, tenantFull);
      setAccessCookie(res, token);
      res.status(201).json({ user: userFull, tenant: tenantFull });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

authRouter.get(
  '/me',
  requireAuth,
  withTenantSession,
  asyncHandler(async (req, res) => {
    const user = (
      await req.q('SELECT id, name, email, role, permissions FROM users WHERE id = $1', [
        req.auth.userId,
      ])
    ).rows[0];
    const tenant = (
      await req.q(
        'SELECT * FROM tenants WHERE id = $1',
        [req.auth.tid]
      )
    ).rows[0];
    res.json({
      user: { ...user, perms: resolvePerms(user.role, user.permissions) },
      tenant: tenantOut(tenant),
    });
  })
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { userId } = await readRefresh(req);
    const { rows } = await adminPool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.is_active AS user_active,
              t.id AS tid, t.slug, t.name AS tenant_name, t.currency, t.tax_rate,
              t.address, t.phone, t.receipt_footer, t.surcharge_pct, t.cash_rounding,
              t.is_active AS tenant_active,
              t.timezone, t.tax_inclusive, t.default_opening_float, t.low_stock_alert_threshold,
              t.receipt_header, t.logo_url, t.default_payment_method,
              t.tips_enabled, t.tip_suggestions, t.auto_close_drawer_hours, t.receipt_width,
              t.tin, t.bir_accreditation_no, t.machine_serial_no,
              t.loyalty_min_redeem, t.loyalty_max_redemption_pct, t.loyalty_expiry_days,
              t.inventory_stock_mode, t.inventory_require_adjustment_note, t.inventory_auto_reorder,
              t.auto_print_receipt, t.open_drawer_on_cash, t.allow_negative_stock,
              t.max_discount_pct, t.require_customer,
              t.setup_completed
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.user_active) throw new ApiError(401, 'Account unavailable');
    await issueRefreshCookie(res, userId); // rotate single-use jti
    const { user, tenant, token } = sessionPayload(row);
    setAccessCookie(res, token);
    res.json({ user, tenant });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    try {
      const { userId } = await readRefresh(req);
      await adminPool.query('UPDATE users SET refresh_jti = NULL WHERE id = $1', [userId]);
    } catch {
      // already signed out / bad cookie - still clear it
    }
    res.clearCookie(COOKIE, { path: '/api/auth' });
    clearAccessCookie(res);
    res.json({ ok: true });
  })
);

// ---- Fast staff switching at the register (PIN handover) ----

// Any signed-in staff may list colleagues for the switch screen.
authRouter.get(
  '/switch-targets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await adminPool.query(
      `SELECT id, name, role, pin_hash IS NOT NULL AS has_pin
       FROM users
       WHERE tenant_id = $1 AND is_active AND id <> $2
       ORDER BY name`,
      [req.auth.tid, req.auth.userId]
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, role: r.role, hasPin: r.has_pin })));
  })
);

const switchSchema = z.object({
  targetUserId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits'),
});

// Exchange the current session for a colleague's using their PIN.
authRouter.post(
  '/switch',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = switchSchema.parse(req.body);
    const { rows } = await adminPool.query(
      `SELECT u.id, u.name, u.email, u.role, u.permissions, u.pin_hash,
              u.is_active AS user_active,
              t.id AS tid, t.slug, t.name AS tenant_name, t.currency, t.tax_rate,
              t.address, t.phone, t.receipt_footer, t.surcharge_pct, t.cash_rounding,
              t.is_active AS tenant_active,
              t.timezone, t.tax_inclusive, t.default_opening_float, t.low_stock_alert_threshold,
              t.receipt_header, t.logo_url, t.default_payment_method,
              t.tips_enabled, t.tip_suggestions, t.auto_close_drawer_hours, t.receipt_width,
              t.tin, t.bir_accreditation_no, t.machine_serial_no,
              t.loyalty_min_redeem, t.loyalty_max_redemption_pct, t.loyalty_expiry_days,
              t.inventory_stock_mode, t.inventory_require_adjustment_note, t.inventory_auto_reorder,
              t.auto_print_receipt, t.open_drawer_on_cash, t.allow_negative_stock,
              t.max_discount_pct, t.require_customer,
              t.setup_completed
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2 LIMIT 1`,
      [b.targetUserId, req.auth.tid]
    );
    const row = rows[0];
    if (!row || !row.user_active || !row.pin_hash) {
      throw new ApiError(401, 'That user cannot be switched to');
    }
    if (!(await bcrypt.compare(b.pin, row.pin_hash))) {
      throw new ApiError(401, 'Incorrect PIN');
    }
    await issueRefreshCookie(res, row.id);
    const { user, tenant, token } = sessionPayload(row);
    setAccessCookie(res, token);
    res.json({ user, tenant });
  })
);

const myPinSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits'),
});

// Set or change your own register PIN.
authRouter.put(
  '/my-pin',
  requireAuth,
  withTenantSession,
  asyncHandler(async (req, res) => {
    const b = myPinSchema.parse(req.body);
    const hash = await bcrypt.hash(b.pin, 10);
    await req.q('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, req.auth.userId]);
    await audit(req, 'user.set_own_pin', 'user', req.auth.userId, {});
    res.json({ ok: true });
  })
);

// ---- Owner two-factor authentication (TOTP) ----

function requireOwner(req, _res, next) {
  if (req.auth?.role !== 'owner') return next(new ApiError(403, 'Owners only'));
  next();
}

authRouter.post(
  '/2fa/setup',
  requireAuth,
  withTenantSession,
  requireOwner,
  asyncHandler(async (req, res) => {
    const secret = generateSecret();
    await req.q('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [
      secret,
      req.auth.userId,
    ]);
    const me = (await req.q('SELECT email FROM users WHERE id = $1', [req.auth.userId])).rows[0];
    const slugRow = (await req.q('SELECT slug FROM tenants WHERE id = $1', [req.auth.tid])).rows[0];
    res.json({
      secret,
      otpauthUri: `otpauth://totp/eSariPOS:${encodeURIComponent(slugRow.slug)}:${encodeURIComponent(
        me.email
      )}?secret=${secret}&issuer=eSariPOS`,
    });
  })
);

authRouter.post(
  '/2fa/enable',
  requireAuth,
  withTenantSession,
  requireOwner,
  asyncHandler(async (req, res) => {
    const b = z.object({ code: z.string().trim().max(10) }).parse(req.body);
    const row = (
      await req.q('SELECT totp_secret FROM users WHERE id = $1', [req.auth.userId])
    ).rows[0];
    if (!row?.totp_secret) throw new ApiError(400, 'Run setup first');
    if (!verifyTotp(row.totp_secret, b.code)) throw new ApiError(400, 'Invalid authentication code');
    await req.q('UPDATE users SET totp_enabled = true WHERE id = $1', [req.auth.userId]);
    await audit(req, 'user.2fa_enabled', 'user', req.auth.userId, {});
    res.json({ ok: true });
  })
);

authRouter.post(
  '/2fa/disable',
  requireAuth,
  withTenantSession,
  requireOwner,
  asyncHandler(async (req, res) => {
    const b = z.object({ code: z.string().trim().max(10) }).parse(req.body);
    const row = (
      await req.q('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.auth.userId])
    ).rows[0];
    if (!row?.totp_enabled) throw new ApiError(400, 'Two-factor is not enabled');
    if (!verifyTotp(row.totp_secret, b.code)) throw new ApiError(400, 'Invalid authentication code');
    await req.q('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [
      req.auth.userId,
    ]);
    await audit(req, 'user.2fa_disabled', 'user', req.auth.userId, {});
    res.json({ ok: true });
  })
);
