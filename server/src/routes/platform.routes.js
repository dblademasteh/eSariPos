import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { adminPool } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/api.js';
import { hashToken, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const platformKeysRouter = Router();

platformKeysRouter.use(requireRole('owner'));

const KEY_PREFIX = 'nvpk_';

// ---- Tenant-scoped management (owners, in-app Settings) ----

platformKeysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT id, label, key_prefix, last_used_at, revoked, created_at
       FROM api_keys ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows);
  })
);

platformKeysRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z.object({ label: z.string().trim().min(1).max(80) }).parse(req.body);
    const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 10);
    await req.q(
      `INSERT INTO api_keys (tenant_id, label, key_prefix, key_hash)
       VALUES ($1,$2,$3,$4)`,
      [req.auth.tid, b.label, prefix, hashToken(raw)]
    );
    await audit(req, 'api_key.created', 'api_key', prefix, { label: b.label });
    // The full key is shown exactly once.
    res.status(201).json({ key: raw, prefix });
  })
);

platformKeysRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = z.object({ revoked: z.boolean() }).parse(req.body);
    const { rowCount } = await req.q(
      'UPDATE api_keys SET revoked = $1 WHERE id = $2 AND tenant_id = $3',
      [b.revoked, req.params.id, req.auth.tid]
    );
    if (!rowCount) throw new ApiError(404, 'API key not found');
    res.json({ ok: true });
  })
);

// ---- Platform operator console (super-admin) ----

export function requirePlatformKey(req, res, next) {
  const expected = process.env.PLATFORM_ADMIN_KEY;
  if (!expected) return next(new ApiError(404, 'Not found'));
  if (req.headers['x-platform-key'] !== expected) return next(new ApiError(401, 'Invalid platform key'));
  next();
}

export const platformRouter = Router();

platformRouter.use(requirePlatformKey);

platformRouter.get(
  '/tenants',
  asyncHandler(async (_req, res) => {
    const { rows } = await adminPool.query(
      `SELECT t.id, t.slug, t.name, t.created_at,
              (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS staff_count,
              (SELECT count(*) FROM orders o WHERE o.tenant_id = t.id) AS order_count,
              COALESCE((SELECT SUM(GREATEST(o.total - o.refunded_total,0)) FROM orders o
               WHERE o.tenant_id = t.id AND o.status IN ('completed','partially_refunded','refunded')), 0) AS net_revenue
       FROM tenants t ORDER BY t.created_at DESC`
    );
    res.json(
      rows.map((t) => ({
        ...t,
        netRevenue: Number(t.net_revenue),
        staffCount: Number(t.staff_count),
        orderCount: Number(t.order_count),
      }))
    );
  })
);
