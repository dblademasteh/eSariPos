import { Router } from 'express';
import { asyncHandler } from '../lib/api.js';
import { requireRole } from '../middleware/auth.js';

export const auditRouter = Router();

// Owner-only: who did what, across every journaled admin/user action.
auditRouter.use(requireRole('owner'));

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const { action = '', entity = '', userId = '' } = req.query;
    if (action) {
      params.push(String(action));
      clauses.push(`a.action = $${params.length}`);
    }
    if (entity) {
      params.push(String(entity));
      clauses.push(`a.entity = $${params.length}`);
    }
    if (userId) {
      params.push(String(userId));
      clauses.push(`a.user_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(req.query.limit) || 200, 500));

    const { rows } = await req.q(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at,
              u.name AS staff_name, u.email AS staff_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    const actions = await req.q(
      'SELECT DISTINCT action FROM audit_log ORDER BY action'
    );
    res.json({
      actions: actions.rows.map((r) => r.action),
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        meta: r.meta ?? {},
        staffName: r.staff_name ?? '(removed)',
        staffEmail: r.staff_email ?? null,
        createdAt: r.created_at,
      })),
    });
  })
);
