import crypto from 'node:crypto';
import { adminPool } from '../db/pool.js';

// Outbound webhook delivery with HMAC-SHA256 signatures. Fire-and-forget by
// design: a slow/unreachable endpoint must never block checkout.
export async function deliverWebhookEvent(tenantId, event, payload) {
  const { rows } = await adminPool.query(
    'SELECT id, url, secret FROM webhooks WHERE tenant_id = $1 AND is_active AND $2 = ANY(events)',
    [tenantId, event]
  );
  for (const hook of rows) {
    void (async () => {
      const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });
      const sig = crypto
        .createHmac('sha256', hook.secret)
        .update(body)
        .digest('hex');
      let status = 'error';
      let responseCode = null;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-NovaPOS-Signature': `sha256=${sig}`,
            'X-NovaPOS-Event': event,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        status = res.ok ? 'delivered' : 'failed';
        responseCode = res.status;
      } catch (err) {
        status = err.name === 'TimeoutError' ? 'timeout' : 'error';
      }
      try {
        await adminPool.query(
          `INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, status, response_code, payload)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, hook.id, event, status, responseCode, JSON.stringify(payload)]
        );
      } catch {
        // delivery logging must never throw
      }
    })();
  }
}
