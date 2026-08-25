import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../lib/api.js';
import { signToken, requireAuth, withTenantSession, hashToken } from '../middleware/auth.js';
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
         t.is_active AS tenant_active
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
  });
  return { token: signToken(user, tenant), user, tenant };
}

// ---- httpOnly refresh-cookie sessions (rotating single-use jti) ----

const COOKIE = 'novapos_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
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
    res.json(sessionPayload(row));
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
              t.is_active AS tenant_active
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
    res.json(sessionPayload(row));
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
      res.status(201).json({ token: signToken(userFull, tenantFull), user: userFull, tenant: tenantFull });
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
        'SELECT id, slug, name, currency, tax_rate, address, phone, receipt_footer, surcharge_pct, cash_rounding, loyalty_earn_per_unit, loyalty_point_cents FROM tenants WHERE id = $1',
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
              t.is_active AS tenant_active
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.user_active) throw new ApiError(401, 'Account unavailable');
    await issueRefreshCookie(res, userId); // rotate single-use jti
    res.json(sessionPayload(row));
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
              t.is_active AS tenant_active
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
    res.json(sessionPayload(row));
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
      otpauthUri: `otpauth://totp/NovaPOS:${encodeURIComponent(slugRow.slug)}:${encodeURIComponent(
        me.email
      )}?secret=${secret}&issuer=NovaPOS`,
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
