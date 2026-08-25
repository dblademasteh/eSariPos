import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { ApiError, asyncHandler, toUpdate } from '../lib/api.js';
import { requireRole } from '../middleware/auth.js';
import { resolvePerms } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

export const staffRouter = Router();

staffRouter.use(requireRole('owner'));

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['owner', 'manager', 'cashier']).default('cashier'),
  permissions: z.record(z.boolean()).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['owner', 'manager', 'cashier']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'PIN must be 4-8 digits')
    .nullable()
    .optional(),
  permissions: z.record(z.boolean()).optional(),
});

function serialize(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.is_active,
    hasPin: Boolean(u.pin_hash),
    totpEnabled: Boolean(u.totp_enabled),
    perms: resolvePerms(u.role, u.permissions),
    overrides: u.permissions ?? {},
    createdAt: u.created_at,
  };
}

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      'SELECT id, name, email, role, is_active, pin_hash, totp_enabled, permissions, created_at FROM users ORDER BY created_at'
    );
    res.json(rows.map(serialize));
  })
);

staffRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const hash = await bcrypt.hash(b.password, 10);
    try {
      const { rows } = await req.q(
        `INSERT INTO users (tenant_id, name, email, password_hash, role, permissions)
         VALUES ($1,$2,lower($3),$4,$5,$6)
         RETURNING id`,
        [req.auth.tid, b.name, b.email, hash, b.role, b.permissions ?? null]
      );
      await audit(req, 'staff.created', 'user', rows[0].id, { name: b.name, role: b.role });
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'A user with that email already exists');
      throw err;
    }
  })
);

staffRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = patchSchema.parse(req.body);
    if (req.params.id === req.auth.userId && (b.isActive === false || (b.role && b.role !== 'owner'))) {
      throw new ApiError(400, 'You cannot demote or deactivate your own account');
    }
    const upd = toUpdate(b, { name: 'name', role: 'role', isActive: 'is_active' }) || {
      assignments: [],
      values: [],
    };
    if (b.password) {
      upd.values.push(await bcrypt.hash(b.password, 10));
      upd.assignments.push(`password_hash = $${upd.values.length}`);
    }
    if (b.pin !== undefined) {
      if (b.pin === null) {
        upd.assignments.push('pin_hash = NULL');
      } else {
        upd.values.push(await bcrypt.hash(b.pin, 10));
        upd.assignments.push(`pin_hash = $${upd.values.length}`);
      }
    }
    if (b.permissions !== undefined) {
      // Merge over stored overrides so partial payloads behave predictably.
      upd.values.push(JSON.stringify(b.permissions));
      upd.assignments.push(`permissions = COALESCE(permissions, '{}'::jsonb) || $${upd.values.length}::jsonb`);
    }
    if (!upd.assignments.length) throw new ApiError(400, 'Nothing to update');
    const { rowCount } = await req.q(
      `UPDATE users SET ${upd.assignments.join(', ')} WHERE id = $${upd.values.length + 1}`,
      [...upd.values, req.params.id]
    );
    if (!rowCount) throw new ApiError(404, 'Staff member not found');
    await audit(req, 'staff.updated', 'user', req.params.id, { fields: Object.keys(b) });
    res.json({ ok: true });
  })
);
