import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';

export const timeclockRouter = Router();

timeclockRouter.post(
  '/clock-in',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ note: z.string().trim().max(200).optional().nullable() })
      .parse(req.body ?? {});
    try {
      const { rows } = await req.q(
        'INSERT INTO shifts (tenant_id, user_id, note) VALUES ($1,$2,$3) RETURNING id, clock_in',
        [req.auth.tid, req.auth.userId, b.note ?? null]
      );
      res.status(201).json({ id: rows[0].id, clockIn: rows[0].clock_in });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'You are already clocked in');
      throw err;
    }
  })
);

timeclockRouter.post(
  '/clock-out',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `UPDATE shifts SET clock_out = now()
       WHERE user_id = $1 AND clock_out IS NULL
       RETURNING id, clock_in, clock_out`,
      [req.auth.userId]
    );
    if (!rows[0]) throw new ApiError(409, 'You are not clocked in');
    res.json({ id: rows[0].id, clockIn: rows[0].clock_in, clockOut: rows[0].clock_out });
  })
);

timeclockRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const open = (
      await req.q(
        'SELECT id, clock_in FROM shifts WHERE user_id = $1 AND clock_out IS NULL LIMIT 1',
        [req.auth.userId]
      )
    ).rows[0];
    const today = (
      await req.q(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out, now()) - clock_in))), 0) AS secs
         FROM shifts
         WHERE user_id = $1 AND clock_in >= date_trunc('day', now())`,
        [req.auth.userId]
      )
    ).rows[0];
    res.json({
      openShift: open ? { id: open.id, clockIn: open.clock_in } : null,
      todaySeconds: Number(today.secs),
    });
  })
);

// Hours report. Managers/owners see everyone; other roles only themselves.
timeclockRouter.get(
  '/report',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    const b = schema.parse(req.query);
    const canSeeAll = ['owner', 'manager'].includes(req.auth.role);

    const clauses = ['s.clock_out IS NOT NULL'];
    const params = [];
    if (!canSeeAll) {
      params.push(req.auth.userId);
      clauses.push(`s.user_id = $${params.length}`);
    }
    params.push(b.from ? new Date(b.from) : new Date(Date.now() - 30 * 86400_000));
    clauses.push(`s.clock_in >= $${params.length}`);
    if (b.to) {
      params.push(new Date(b.to));
      clauses.push(`s.clock_in < $${params.length}`);
    }
    params.push(Math.min(Number(req.query.limit) || 200, 500));

    const { rows } = await req.q(
      `SELECT s.id, s.user_id, u.name AS staff_name, s.clock_in, s.clock_out,
              EXTRACT(EPOCH FROM (s.clock_out - s.clock_in)) AS seconds, s.note
       FROM shifts s LEFT JOIN users u ON u.id = s.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY s.clock_in DESC
       LIMIT $${params.length}`,
      params
    );

    const byStaff = new Map();
    for (const row of rows) {
      const key = row.user_id ?? '?';
      if (!byStaff.has(key)) byStaff.set(key, { userId: row.user_id, name: row.staff_name ?? '(removed)', shifts: 0, seconds: 0 });
      const agg = byStaff.get(key);
      agg.shifts += 1;
      agg.seconds += Number(row.seconds);
    }

    res.json({
      totals: [...byStaff.values()].map((a) => ({
        ...a,
        seconds: Math.round(a.seconds),
        hours: Math.round((a.seconds / 3600) * 100) / 100,
      })),
      shifts: rows.map((r) => ({
        id: r.id,
        staffName: r.staff_name ?? '(removed)',
        clockIn: r.clock_in,
        clockOut: r.clock_out,
        hours: Math.round((Number(r.seconds) / 3600) * 100) / 100,
        note: r.note ?? null,
      })),
    });
  })
);
