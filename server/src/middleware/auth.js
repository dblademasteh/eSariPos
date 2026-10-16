import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { appPool, adminPool } from '../db/pool.js';
import { ApiError } from '../lib/api.js';
import { env } from '../env.js';
import { resolvePerms } from '../lib/permissions.js';

const ACCESS_COOKIE = 'esaripos_access';

// Short-lived access token; the long-lived session lives in an httpOnly
// refresh cookie (see auth.routes.js) and rotates on every refresh.
export function signToken(user, tenant) {
  return jwt.sign(
    { sub: user.id, tid: tenant.id, role: user.role },
    env.jwtSecret,
    { expiresIn: '30m' }
  );
}

export function setAccessCookie(res, token) {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 60 * 1000, // 30 minutes
  });
}

export function clearAccessCookie(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
}

export const hashToken = (v) => crypto.createHash('sha256').update(v).digest('hex');

function readTokenFromRequest(req) {
  // Prefer httpOnly cookie
  const header = req.headers.cookie || '';
  const pair = header.split(/;\s*/).find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
  if (pair) return decodeURIComponent(pair.slice(ACCESS_COOKIE.length + 1));
  // Fallback: Authorization header (for API keys, external clients)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

export async function requireAuth(req, res, next) {
  // Public API key path (X-Api-Key) - resolved against adminPool because RLS
  // needs the tenant, which only the key itself can provide (chicken-and-egg).
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.startsWith('nvpk_')) {
    try {
      const { rows } = await adminPool.query(
        'SELECT id, tenant_id FROM api_keys WHERE key_hash = $1 AND NOT revoked',
        [hashToken(apiKey)]
      );
      const key = rows[0];
      if (!key) return next(new ApiError(401, 'Invalid API key'));
      req.auth = {
        apiKey: true,
        keyId: key.id,
        tid: key.tenant_id,
        role: 'api',
        userId: null,
        perms: ['reports'],
      };
      await adminPool
        .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id])
        .catch(() => {});
      return next();
    } catch {
      return next(new ApiError(401, 'Invalid API key'));
    }
  }
  const token = readTokenFromRequest(req);
  if (!token) return next(new ApiError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = { userId: payload.sub, tid: payload.tid, role: payload.role };
    next();
  } catch {
    next(new ApiError(401, 'Session expired - please sign in again'));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth?.role)) {
      return next(new ApiError(403, 'You do not have permission to do that'));
    }
    next();
  };
}

// Capability check against the effective permission set (role baseline merged
// with per-user overrides), resolved fresh from the DB on every request.
export function requirePerm(...perms) {
  return (req, res, next) => {
    const granted = req.auth?.perms ?? [];
    if (!perms.every((p) => granted.includes(p))) {
      return next(new ApiError(403, 'You do not have permission to do that'));
    }
    next();
  };
}

export async function withTenantSession(req, res, next) {
  const client = await appPool.connect();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Commit only when the response completed successfully; errors and
    // aborted requests must roll back so partial writes never persist.
    const ok = res.writableEnded && res.statusCode < 400;
    client
      .query(ok ? 'COMMIT' : 'ROLLBACK')
      .catch(() => {})
      .finally(() => client.release());
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      req.auth.tid,
    ]);
    if (req.auth.apiKey) {
      // Tenant + key already resolved in requireAuth.
    } else {
      const { rows } = await client.query(
        'SELECT role, permissions FROM users WHERE id = $1 AND is_active',
        [req.auth.userId]
      );
      if (!rows.length) throw new ApiError(401, 'Account disabled or removed');
      req.auth.role = rows[0].role; // authorize against current DB role, not the JWT claim
      req.auth.perms = resolvePerms(rows[0].role, rows[0].permissions);
    }
    req.q = (text, params) => client.query(text, params);
    next();
  } catch (err) {
    done = true;
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    next(err);
  }
}
