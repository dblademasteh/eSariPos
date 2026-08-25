import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';
import { cents, fromCents } from '../lib/money.js';

export const giftCardsRouter = Router();

giftCardsRouter.use(requirePerm('giftcards'));

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[\w-]+$/, 'Use letters, numbers, dashes or underscores')
    .transform((v) => v.toUpperCase())
    .optional(),
  initialBalance: z.number().min(0).max(10_000_000).default(0),
});

const patchSchema = z.object({
  addBalance: z.number().min(0).max(10_000_000).optional(),
  isActive: z.boolean().optional(),
  note: z.string().trim().max(300).optional().nullable(),
});

function randomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `GC-${out}`;
}

giftCardsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '', includeInactive = 'false' } = req.query;
    const clauses = [];
    const params = [];
    if (includeInactive !== 'true') clauses.push('g.is_active');
    if (search) {
      params.push(`%${String(search).toUpperCase()}%`);
      clauses.push(`g.code LIKE $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await req.q(
      `SELECT g.*, u.name AS created_by_name
       FROM gift_cards g
       LEFT JOIN users u ON u.id = g.created_by
       ${where}
       ORDER BY g.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(
      rows.map((g) => ({
        id: g.id,
        code: g.code,
        balance: Number(g.balance),
        isActive: g.is_active,
        createdBy: g.created_by_name ?? null,
        createdAt: g.created_at,
      }))
    );
  })
);

giftCardsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    const code = b.code ?? randomCode();
    try {
      const { rows } = await req.q(
        `INSERT INTO gift_cards (tenant_id, code, balance, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.auth.tid, code, fromCents(cents(b.initialBalance)), req.auth.userId]
      );
      if (cents(b.initialBalance) > 0) {
        await req.q(
          `INSERT INTO gift_card_transactions (tenant_id, card_id, delta, balance_after, note, created_by)
           VALUES ($1,$2,$3,$3,'issued',$4)`,
          [req.auth.tid, rows[0].id, fromCents(cents(b.initialBalance)), req.auth.userId]
        );
      }
      res.status(201).json({ id: rows[0].id, code: rows[0].code, balance: Number(rows[0].balance) });
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, 'That gift card code already exists');
      throw err;
    }
  })
);

giftCardsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const b = patchSchema.parse(req.body);
    if (b.addBalance === undefined && b.isActive === undefined && !b.note) {
      throw new ApiError(400, 'Nothing to update');
    }

    const card = (
      await req.q('SELECT * FROM gift_cards WHERE id = $1 FOR UPDATE', [req.params.id])
    ).rows[0];
    if (!card) throw new ApiError(404, 'Gift card not found');

    if (b.addBalance !== undefined && cents(b.addBalance) > 0) {
      await req.q(
        'UPDATE gift_cards SET balance = balance + $1 WHERE id = $2 RETURNING *',
        [b.addBalance, card.id]
      );
      const after = (
        await req.q('SELECT balance FROM gift_cards WHERE id = $1', [card.id])
      ).rows[0].balance;
      await req.q(
        `INSERT INTO gift_card_transactions (tenant_id, card_id, delta, balance_after, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.auth.tid, card.id, b.addBalance, after, b.note ?? 'reload', req.auth.userId]
      );
    }
    if (b.isActive !== undefined) {
      await req.q('UPDATE gift_cards SET is_active = $1 WHERE id = $2', [b.isActive, card.id]);
    }

    const updated = (await req.q('SELECT * FROM gift_cards WHERE id = $1', [card.id])).rows[0];
    res.json({
      id: updated.id,
      code: updated.code,
      balance: Number(updated.balance),
      isActive: updated.is_active,
    });
  })
);

giftCardsRouter.get(
  '/:id/transactions',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT t.delta, t.balance_after, t.note, t.created_at, o.order_no
       FROM gift_card_transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.card_id = $1
       ORDER BY t.created_at DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json(
      rows.map((r) => ({
        delta: Number(r.delta),
        balanceAfter: Number(r.balance_after),
        note: r.note ?? null,
        orderNo: r.order_no ? Number(r.order_no) : null,
        createdAt: r.created_at,
      }))
    );
  })
);
