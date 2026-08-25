import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const webhooksRouter = Router();

webhooksRouter.use(requireRole('owner'));

webhooksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT w.id, w.url, w.events, w.is_active, w.created_at,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status <> 'delivered') AS failures
       FROM webhooks w ORDER BY w.created_at DESC LIMIT 50`
    );
    res.json(
      rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        isActive: w.is_active,
        createdAt: w.created_at,
        deliveries: Number(w.deliveries),
        failures: Number(w.failures),
      }))
    );
  })
);

webhooksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        url: z.string().trim().url().max(500),
        events: z.array(z.enum(['order.created', 'order.refunded'])).min(1).default(['order.created']),
      })
      .parse(req.body);
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const { rows } = await req.q(
      `INSERT INTO webhooks (tenant_id, url, secret, events) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.auth.tid, b.url, secret, b.events]
    );
    await audit(req, 'webhook.created', 'webhook', rows[0].id, { url: b.url });
    // The signing secret is shown exactly once.
    res.status(201).json({ id: rows[0].id, secret });
  })
);

webhooksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = z.object({ isActive: z.boolean() }).parse(req.body);
    const { rowCount } = await req.q(
      'UPDATE webhooks SET is_active = $1 WHERE id = $2 AND tenant_id = $3',
      [b.isActive, req.params.id, req.auth.tid]
    );
    if (!rowCount) throw new ApiError(404, 'Webhook not found');
    res.json({ ok: true });
  })
);

// Recent delivery outcomes for troubleshooting.
webhooksRouter.get(
  '/:id/deliveries',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT event, status, response_code, created_at
       FROM webhook_deliveries WHERE webhook_id = $1
       ORDER BY created_at DESC LIMIT 25`,
      [req.params.id]
    );
    res.json(rows);
  })
);

void ApiError;
