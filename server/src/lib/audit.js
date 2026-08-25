// Best-effort audit trail for admin/user actions. Never blocks the caller.
export async function audit(req, action, entity, entityId, meta = {}) {
  try {
    await req.q(
      `INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.auth.tid,
        req.auth.userId,
        action,
        entity ?? null,
        entityId ? String(entityId) : null,
        JSON.stringify(meta),
      ]
    );
  } catch {
    // auditing must never break the request
  }
}
