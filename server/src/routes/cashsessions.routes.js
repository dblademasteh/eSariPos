import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { audit } from '../lib/audit.js';

export const cashSessionsRouter = Router();

const nullifyEmpty = (v) => (v === '' ? null : v);

async function loadSession(req, id) {
  const { rows } = await req.q(
    `SELECT s.*, ou.name AS opened_by_name, cu.name AS closed_by_name
     FROM cash_sessions s
     LEFT JOIN users ou ON ou.id = s.opened_by
     LEFT JOIN users cu ON cu.id = s.closed_by
     WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Session not found');
  return rows[0];
}

async function buildReport(req, session) {
  const end = session.closed_at ?? new Date();
  const totals = (
    await req.q(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(o.total), 0) AS gross,
              COALESCE(SUM(o.refunded_total), 0) AS refunded,
              COALESCE(SUM(o.change_due), 0) AS change_given
       FROM orders o WHERE o.session_id = $1 AND o.status <> 'cancelled'`,
      [session.id]
    )
  ).rows[0];
  const byMethod = (
    await req.q(
      `SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.session_id = $1 AND o.status <> 'cancelled'
       GROUP BY p.method ORDER BY p.method`,
      [session.id]
    )
  ).rows;
  const events = (
    await req.q(
      `SELECT e.type, e.amount, e.note, e.created_at, u.name AS by
       FROM cash_session_events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.session_id = $1 ORDER BY e.created_at`,
      [session.id]
    )
  ).rows;

  const methodTotals = Object.fromEntries(
    ['cash', 'card', 'card_terminal', 'mobile', 'gift_card', 'other'].map((m) => [
      m,
      Number(byMethod.find((r) => r.method === m)?.amount ?? 0),
    ])
  );
  const drops = events.filter((e) => e.type === 'drop').reduce((s, e) => s + Number(e.amount), 0);
  const payouts = events.filter((e) => e.type === 'payout').reduce((s, e) => s + Number(e.amount), 0);

  // Cash that should be in the drawer: tendered cash minus change handed back.
  const cashTendered = methodTotals.cash;
  const cashKept = cashTendered - Number(totals.change_given);
  const expected =
    Number(session.opening_float) + cashKept - drops - payouts;

  return {
    sessionId: session.id,
    locationId: session.location_id ?? null,
    status: session.status,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    windowEnd: end,
    openedBy: session.opened_by_name,
    closedBy: session.closed_by_name,
    openingFloat: Number(session.opening_float),
    ordersCount: Number(totals.orders),
    grossSales: Number(totals.gross),
    refunds: Number(totals.refunded),
    netSales: Number(totals.gross) - Number(totals.refunded),
    byMethod: methodTotals,
    cashTendered,
    cashKept: Math.round(cashKept * 100) / 100,
    drops: Math.round(drops * 100) / 100,
    payouts: Math.round(payouts * 100) / 100,
    expectedCash: Math.round(expected * 100) / 100,
    countedCash: session.counted_cash == null ? null : Number(session.counted_cash),
    variance: session.variance == null ? null : Number(session.variance),
    events: events.map((e) => ({
      type: e.type,
      amount: Number(e.amount),
      note: e.note ?? null,
      by: e.by,
      createdAt: e.created_at,
    })),
    closingNote: session.closing_note ?? null,
  };
}

cashSessionsRouter.post(
  '/open',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      openingFloat: z.number().min(0).max(1_000_000).default(0),
      locationId: z.string().uuid().nullable().optional(),
      note: z.string().trim().max(300).optional().nullable().transform(nullifyEmpty),
    });
    const b = schema.parse(req.body ?? {});
    try {
      const { rows } = await req.q(
        `INSERT INTO cash_sessions (tenant_id, location_id, opened_by, opening_float)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [req.auth.tid, b.locationId ?? null, req.auth.userId, b.openingFloat]
      );
      await audit(req, 'session.opened', 'cash_session', rows[0].id, { float: b.openingFloat });
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'You already have an open drawer');
      throw err;
    }
  })
);

cashSessionsRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT s.*, ou.name AS opened_by_name
       FROM cash_sessions s LEFT JOIN users ou ON ou.id = s.opened_by
       WHERE s.opened_by = $1 AND s.status = 'open' LIMIT 1`,
      [req.auth.userId]
    );
    if (!rows[0]) return res.json({ session: null });
    res.json({ session: await buildReport(req, rows[0]) });
  })
);

cashSessionsRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const isManager = ['owner', 'manager'].includes(req.auth.role);
    const clauses = ["s.status = 'closed'"];
    const params = [];
    if (!isManager || req.query.all !== 'true') {
      params.push(req.auth.userId);
      clauses.push(`s.opened_by = $${params.length}`);
    }
    params.push(Math.min(Number(req.query.limit) || 20, 100));
    const { rows } = await req.q(
      `SELECT s.id, s.opened_at, s.closed_at, s.opening_float, s.expected_cash,
              s.counted_cash, s.variance, ou.name AS opened_by_name
       FROM cash_sessions s LEFT JOIN users ou ON ou.id = s.opened_by
       WHERE ${clauses.join(' AND ')}
       ORDER BY s.closed_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(
      rows.map((s) => ({
        id: s.id,
        openedAt: s.opened_at,
        closedAt: s.closed_at,
        openingFloat: Number(s.opening_float),
        expectedCash: s.expected_cash == null ? null : Number(s.expected_cash),
        countedCash: s.counted_cash == null ? null : Number(s.counted_cash),
        variance: s.variance == null ? null : Number(s.variance),
        openedBy: s.opened_by_name,
      }))
    );
  })
);

cashSessionsRouter.get(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const session = await loadSession(req, req.params.id);
    res.json(await buildReport(req, session));
  })
);

cashSessionsRouter.post(
  '/:id/events',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      type: z.enum(['drop', 'payout']),
      amount: z.number().positive().max(1_000_000),
      note: z.string().trim().max(200).optional().nullable().transform(nullifyEmpty),
    });
    const b = schema.parse(req.body);
    const session = await loadSession(req, req.params.id);
    if (session.status !== 'open') throw new ApiError(409, 'This drawer is closed');
    if (session.opened_by !== req.auth.userId && !['owner', 'manager'].includes(req.auth.role)) {
      throw new ApiError(403, 'Not your drawer');
    }
    await req.q(
      `INSERT INTO cash_session_events (tenant_id, session_id, type, amount, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.auth.tid, session.id, b.type, b.amount, b.note, req.auth.userId]
    );
    await audit(req, `session.${b.type}`, 'cash_session', session.id, { amount: b.amount });
    res.json(await buildReport(req, session));
  })
);

cashSessionsRouter.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      countedCash: z.number().min(0).max(10_000_000),
      note: z.string().trim().max(300).optional().nullable().transform(nullifyEmpty),
    });
    const b = schema.parse(req.body ?? {});
    const session = await loadSession(req, req.params.id);
    if (session.status !== 'open') throw new ApiError(409, 'This drawer is already closed');
    if (session.opened_by !== req.auth.userId && !['owner', 'manager'].includes(req.auth.role)) {
      throw new ApiError(403, 'Not your drawer');
    }

    const reportBeforeClose = await buildReport(req, session);
    const variance =
      Math.round((b.countedCash - reportBeforeClose.expectedCash) * 100) / 100;

    await req.q(
      `UPDATE cash_sessions SET status = 'closed', closed_by = $1, closed_at = now(),
         counted_cash = $2, expected_cash = $3, variance = $4, closing_note = $5
       WHERE id = $6`,
      [
        req.auth.userId,
        b.countedCash,
        reportBeforeClose.expectedCash,
        variance,
        b.note ?? null,
        session.id,
      ]
    );
    await audit(req, 'session.closed', 'cash_session', session.id, { variance });

    const closed = await loadSession(req, session.id);
    const zReport = await buildReport(req, closed);
    res.json({ zReport });
  })
);
