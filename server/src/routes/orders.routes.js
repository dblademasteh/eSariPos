import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';
import { cents, fromCents, applyCashRounding } from '../lib/money.js';
import { consumptionForLines, restockForLines } from '../lib/bom.js';
import { readPoolStock, adjustPoolStock, resolveOrderLocation } from '../lib/stock.js';
import { authorizeTerminal } from '../lib/psp.js';
import { audit } from '../lib/audit.js';

export const ordersRouter = Router();

const nullifyEmpty = (v) => (v === '' ? null : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const qtySchema = z
  .number()
  .min(0.001)
  .max(9999)
  .refine((v) => Math.round(v * 1000) === v * 1000, 'Max 3 decimal places');

const PAYMENT_METHODS = ['cash', 'card', 'card_terminal', 'mobile', 'gift_card', 'store_credit', 'other',
  'gcash', 'maya', 'qr_ph', 'instapay', 'pesonet'];

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: qtySchema,
      })
    )
    .min(1)
    .max(200),
  customerId: z.string().uuid().optional().nullable().transform(nullifyEmpty),
  locationId: z.string().uuid().optional().nullable().transform(nullifyEmpty),
  couponCode: z.string().trim().max(40).optional().nullable().transform(nullifyEmpty),
  redeemPoints: z.number().int().min(0).max(1_000_000).default(0),
  discount: z.number().min(0).max(10_000_000).default(0),
  discountType: z.enum(['regular', 'senior', 'pwd', 'percentage', 'employee']).default('regular'),
  beneficiaryName: z.string().trim().max(100).optional().nullable().transform(nullifyEmpty),
  beneficiaryIdNumber: z.string().trim().max(50).optional().nullable().transform(nullifyEmpty),
  beneficiaryIdType: z.enum(['senior_id', 'pwd_id', 'postal', 'other']).optional().nullable().transform(nullifyEmpty),
  note: z.string().trim().max(500).optional().nullable().transform(nullifyEmpty),
  tip: z.number().min(0).max(10_000).default(0),
  fulfill: z.enum(['now', 'layaway']).default('now'),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.number().positive().max(10_000_000),
        reference: z.string().trim().max(120).optional().nullable().transform(nullifyEmpty),
      })
    )
    .min(1)
    .max(5),
  idempotencyKey: z.string().uuid().optional().nullable().transform(nullifyEmpty),
});

const settleSchema = z.object({
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.number().positive().max(10_000_000),
        reference: z.string().trim().max(120).optional().nullable().transform(nullifyEmpty),
      })
    )
    .min(1)
    .max(5),
});

async function loadTenantSettings(req) {
  const { rows } = await req.q(
    'SELECT tax_rate, surcharge_pct, cash_rounding, loyalty_earn_per_unit, loyalty_point_cents, tin, bir_accreditation_no, machine_serial_no FROM tenants WHERE id = $1',
    [req.auth.tid]
  );
  const t = rows[0] ?? {};
  return {
    taxRate: Number(t.tax_rate ?? 0),
    surchargePct: Number(t.surcharge_pct ?? 0),
    cashRounding: t.cash_rounding ?? 'none',
    loyaltyEarnPerUnit: Math.max(Number(t.loyalty_earn_per_unit ?? 1), 0),
    loyaltyPointCents: Math.max(Number(t.loyalty_point_cents ?? 1), 1),
    tin: t.tin ?? null,
    birAccreditationNo: t.bir_accreditation_no ?? null,
    machineSerialNo: t.machine_serial_no ?? null,
  };
}

function priceOrder(body, settings) {
  let subtotalC = 0;
  for (const l of body.lines) subtotalC += cents(l.p.price) * l.quantity;

  const isScPwd = body.discountType === 'senior' || body.discountType === 'pwd';

  let discountC;
  if (isScPwd) {
    // SC/PWD: 20% discount, server-enforced, VAT-exempt on discounted portion
    discountC = Math.round(subtotalC * 20 / 100);
  } else if (body.discountType === 'percentage') {
    const pct = Math.min(Math.max(Number(body.discount ?? 0), 0), 100);
    discountC = Math.round(subtotalC * pct / 100);
  } else {
    discountC = Math.min(cents(body.discount ?? 0), subtotalC);
  }

  let taxC;
  if (isScPwd) {
    // SC/PWD: tax only the non-discounted portion (discounted portion is VAT-exempt)
    const taxableC = subtotalC - discountC;
    taxC = Math.round((taxableC * settings.taxRate) / 100);
  } else {
    const taxableC = subtotalC - discountC;
    taxC = Math.round((taxableC * settings.taxRate) / 100);
  }
  const taxableC = subtotalC - discountC;
  const surchargeC = Math.round((taxableC * settings.surchargePct) / 100);
  const tipC = cents(body.tip ?? 0);

  const grossC = taxableC + taxC + surchargeC + tipC;
  const hasCash = body.payments.some((p) => p.method === 'cash');
  const { totalC, adjustmentC } = hasCash
    ? applyCashRounding(grossC, settings.cashRounding)
    : { totalC: grossC, adjustmentC: 0 };

  return { subtotalC, discountC, taxC, surchargeC, tipC, totalC, adjustmentC };
}

// Validates and executes every tender. Gift cards are locked, debited and
// journaled here; store credit debits the attached customer; terminal payments
// go through the PSP adapter. Must run inside the request transaction AFTER
// the order row exists (needed for gift-card journaling).
async function takePayments(req, { payments, orderId, customer = null }) {
  for (const pay of payments) {
    if (pay.method === 'gift_card') {
      const code = String(pay.reference || '').trim();
      if (!code) throw new ApiError(400, 'Gift card payments need the card code as reference');
      const card = (
        await req.q(
          'SELECT id, balance, is_active FROM gift_cards WHERE code = $1 FOR UPDATE',
          [code]
        )
      ).rows[0];
      if (!card || !card.is_active) throw new ApiError(400, `Gift card "${code}" not found or inactive`);
      const amountC = cents(pay.amount);
      if (cents(card.balance) < amountC) {
        throw new ApiError(400, `Gift card "${code}" has insufficient balance`);
      }
      await req.q(
        'UPDATE gift_cards SET balance = balance - $1 WHERE id = $2',
        [fromCents(amountC), card.id]
      );
      const balanceAfter = cents(card.balance) - amountC;
      await req.q(
        `INSERT INTO gift_card_transactions (tenant_id, card_id, delta, balance_after, order_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.auth.tid, card.id, fromCents(-amountC), fromCents(balanceAfter), orderId, req.auth.userId]
      );
    } else if (pay.method === 'store_credit') {
      // Caller holds a FOR UPDATE lock on the customer row.
      const amountC = cents(pay.amount);
      if (!customer) throw new ApiError(400, 'Store credit payments need a customer on the sale');
      if (Number(customer.store_credit) * 100 < amountC) {
        throw new ApiError(400, `Customer only has ${customer.store_credit} in store credit`);
      }
      await req.q(
        'UPDATE customers SET store_credit = store_credit - $1 WHERE id = $2',
        [fromCents(amountC), customer.id]
      );
    } else if (pay.method === 'card_terminal') {
      const auth = await authorizeTerminal({ amountCents: cents(pay.amount), reference: pay.reference });
      if (!auth.ok) throw new ApiError(400, auth.error);
    }
    await req.q(
      `INSERT INTO payments (order_id, tenant_id, method, amount, reference)
       VALUES ($1,$2,$3,$4,$5)`,
      [orderId, req.auth.tid, pay.method, pay.amount, pay.reference]
    );
  }
}

async function hydrateOrder(req, orderRow) {
  const full = (
    await req.q(
      `SELECT o.*, c.name AS customer_name, u.name AS cashier_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [orderRow.id]
    )
  ).rows[0];
  const items = (
    await req.q('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [orderRow.id])
  ).rows;
  const payments = (
    await req.q('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [
      orderRow.id,
    ])
  ).rows;
  return {
    id: full.id,
    orderNo: Number(full.order_no),
    status: full.status,
    customerId: full.customer_id,
    customerName: full.customer_name ?? null,
    cashierName: full.cashier_name ?? null,
    note: full.note ?? null,
    subtotal: Number(full.subtotal),
    discount: Number(full.discount),
    discountType: full.discount_type ?? 'regular',
    beneficiaryName: full.beneficiary_name ?? null,
    beneficiaryIdNumber: full.beneficiary_id_number ?? null,
    beneficiaryIdType: full.beneficiary_id_type ?? null,
    taxTotal: Number(full.tax_total),
    surcharge: Number(full.surcharge ?? 0),
    tip: Number(full.tip ?? 0),
    roundingAdjustment: Number(full.rounding_adjustment ?? 0),
    total: Number(full.total),
    amountPaid: full.amount_paid == null ? null : Number(full.amount_paid),
    changeDue: full.change_due == null ? null : Number(full.change_due),
    refundedTotal: Number(full.refunded_total ?? 0),
    locationId: full.location_id ?? null,
    sessionId: full.session_id ?? null,
    couponCode: full.coupon_code ?? null,
    pointsRedeemed: Number(full.points_redeemed ?? 0),
    pointsEarned: Number(full.points_earned ?? 0),
    createdAt: full.created_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      refundedQty: i.refunded_qty ?? 0,
      lineTotal: Number(i.line_total),
    })),
    payments: payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      reference: p.reference ?? null,
    })),
  };
}

ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to, status = '', limit = '100', customerId = '' } = req.query;
    const clauses = [];
    const params = [];
    if (from) {
      params.push(new Date(String(from)));
      clauses.push(`o.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(new Date(String(to)));
      clauses.push(`o.created_at < $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(String(status));
      clauses.push(`o.status = $${params.length}`);
    }
    if (customerId) {
      params.push(String(customerId));
      clauses.push(`o.customer_id = $${params.length}::uuid`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 100, 500));
    const { rows } = await req.q(
      `SELECT o.order_no, o.id, o.status, o.total, o.amount_paid, o.created_at,
              c.name AS customer_name,
              (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT string_agg(DISTINCT p.method, ',') FROM payments p WHERE p.order_id = o.id) AS methods
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        orderNo: Number(r.order_no),
        status: r.status,
        total: Number(r.total),
        amountPaid: r.amount_paid == null ? null : Number(r.amount_paid),
        createdAt: r.created_at,
        customerName: r.customer_name ?? null,
        itemCount: Number(r.item_count),
        methods: r.methods ? r.methods.split(',') : [],
      }))
    );
  })
);

ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'Order not found');
    res.json(await hydrateOrder(req, rows[0]));
  })
);

ordersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = orderSchema.parse(req.body);
    const locationId = await resolveOrderLocation(req, body.locationId);

    // Discounting is a grantable capability, not a given.
    if (cents(body.discount ?? 0) > 0 && !req.auth.perms.includes('discounts')) {
      throw new ApiError(403, 'You do not have permission to apply discounts');
    }

    if (body.idempotencyKey) {
      const existing = await req.q(
        'SELECT * FROM orders WHERE idempotency_key = $1 AND tenant_id = $2',
        [body.idempotencyKey, req.auth.tid]
      );
      if (existing.rows[0]) {
        return res.json({ order: await hydrateOrder(req, existing.rows[0]), existing: true });
      }
    }

    // Lock the customer early when one is attached - loyalty redemption,
    // store-credit tender and earned-point writes all serialize on this row.
    let customer = null;
    if (body.customerId) {
      customer = (
        await req.q(
          'SELECT id, name, email, loyalty_points, store_credit FROM customers WHERE id = $1 FOR UPDATE',
          [body.customerId]
        )
      ).rows[0];
      if (!customer) throw new ApiError(400, 'Customer not found');
    }

    // Coupon validation (row locked so concurrent checkouts cannot overspend uses).
    let coupon = null;
    if (body.couponCode) {
      coupon = (
        await req.q(
          'SELECT * FROM coupons WHERE code = $1 FOR UPDATE',
          [String(body.couponCode).trim()]
        )
      ).rows[0];
      const now = new Date();
      if (!coupon || !coupon.is_active) throw new ApiError(400, 'Coupon not found');
      if (coupon.starts_at && now < new Date(coupon.starts_at)) throw new ApiError(400, 'Coupon is not active yet');
      if (coupon.ends_at && now > new Date(coupon.ends_at)) throw new ApiError(400, 'Coupon has expired');
      if (coupon.max_uses != null && coupon.times_used >= coupon.max_uses) throw new ApiError(400, 'Coupon usage limit reached');
    }

    const productIds = [...new Set(body.items.map((i) => i.productId))];
    // Lock the sold products, then lock whatever their recipes consume.
    const { rows: prods } = await req.q(
      `SELECT id, name, price, stock FROM products
       WHERE id = ANY($1::uuid[]) AND is_active
       ORDER BY id
       FOR UPDATE`,
      [productIds]
    );
    const { rows: componentIds } = await req.q(
      'SELECT DISTINCT component_id AS id FROM recipe_lines WHERE product_id = ANY($1::uuid[]) ORDER BY id',
      [productIds]
    );
    let allProds = [...prods];
    if (componentIds.length) {
      const compOnly = componentIds.map((c) => c.id).filter((id) => !prods.some((p) => p.id === id));
      if (compOnly.length) {
        const { rows: comps } = await req.q(
          `SELECT id, name, price, stock FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
          [compOnly]
        );
        allProds = allProds.concat(comps);
      }
    }
    const byId = new Map(allProds.map((p) => [p.id, p]));

    const needs = await consumptionForLines(req, body.items);
    for (const item of body.items) {
      if (!byId.get(item.productId)) throw new ApiError(400, 'One of the items is unavailable');
    }
    const shortages = [];
    for (const [productId, qty] of needs) {
      const p = byId.get(productId);
      if (!p) continue;
      const available = await readPoolStock(req, locationId, productId);
      if (available < qty - 1e-9) shortages.push(`${p.name} (${r3(available)} left)`);
    }
    if (shortages.length) {
      throw new ApiError(409, `Not enough stock for: ${shortages.join(', ')}`);
    }

    const settings = await loadTenantSettings(req);
    const lines = body.items.map((item) => ({ p: byId.get(item.productId), quantity: item.quantity }));

    // ---- combined pre-tax discounts: manual + coupon % + loyalty redemption ----
    let subtotalC = 0;
    for (const l of lines) subtotalC += cents(l.p.price) * l.quantity;

    const isScPwd = body.discountType === 'senior' || body.discountType === 'pwd';
    let discountC;
    if (isScPwd) {
      // SC/PWD: 20% discount, server-enforced, no client override
      discountC = Math.round(subtotalC * 20 / 100);
    } else if (body.discountType === 'percentage') {
      const pct = Math.min(Math.max(Number(body.discount ?? 0), 0), 100);
      discountC = Math.round(subtotalC * pct / 100);
    } else {
      discountC = Math.min(cents(body.discount ?? 0), subtotalC);
    }
    let couponDiscountC = 0;
    if (coupon) {
      const afterManual = Math.max(subtotalC - discountC, 0);
      couponDiscountC = Math.min(
        Math.round((afterManual * Number(coupon.percent_off)) / 100),
        afterManual
      );
      discountC = Math.min(discountC + couponDiscountC, subtotalC);
    }

    let pointsToBurn = Math.max(Math.floor(Number(body.redeemPoints) || 0), 0);
    if (pointsToBurn > 0 && !customer) {
      throw new ApiError(400, 'Loyalty redemption needs a customer on the sale');
    }
    if (pointsToBurn > 0) {
      pointsToBurn = Math.min(pointsToBurn, customer.loyalty_points);
      const remainingAfterCoupons = Math.max(subtotalC - discountC, 0);
      const maxAffordable = Math.floor(remainingAfterCoupons / Math.max(settings.loyaltyPointCents, 1));
      pointsToBurn = Math.max(Math.min(pointsToBurn, maxAffordable), 0);
      discountC = Math.min(discountC + pointsToBurn * Math.max(settings.loyaltyPointCents, 1), subtotalC);
    }

    // priceOrder derives tax/surcharge/tip/rounding from the effective discount.
    const priced = priceOrder({ ...body, lines, discount: fromCents(discountC) }, settings);

    // ---- store credit tender ----
    const storeCreditTendered = body.payments
      .filter((p) => p.method === 'store_credit')
      .reduce((s, p) => s + cents(p.amount), 0);
    if (storeCreditTendered > 0 && !customer) {
      throw new ApiError(400, 'Store credit payments need a customer on the sale');
    }
    if (storeCreditTendered > 0 && Number(customer.store_credit) * 100 < storeCreditTendered) {
      throw new ApiError(400, `Customer only has ${customer.store_credit} in store credit`);
    }

    const paidC = body.payments.reduce((s, p) => s + cents(p.amount), 0);

    let status = 'completed';
    if (body.fulfill === 'layaway') {
      if (body.payments.some((p) => p.method === 'gift_card' || p.method === 'card_terminal')) {
        throw new ApiError(400, 'Deposits cannot be taken by gift card or terminal');
      }
      if (paidC <= 0 || paidC >= priced.totalC) {
        throw new ApiError(400, 'A layaway needs a deposit that is less than the order total');
      }
      status = 'layaway';
    } else {
      if (paidC < priced.totalC) {
        throw new ApiError(400, 'Payments do not cover the order total');
      }
      const changeC = paidC - priced.totalC;
      if (changeC > 0 && !body.payments.some((p) => p.method === 'cash')) {
        throw new ApiError(400, 'Overpayment is only allowed with a cash payment');
      }
    }

    const openSession = (
      await req.q(
        "SELECT id FROM cash_sessions WHERE opened_by = $1 AND status = 'open' LIMIT 1",
        [req.auth.userId]
      )
    ).rows[0];

    let order;
    try {
      const pointsEarned =
        status === 'completed'
          ? Math.floor(priced.totalC / 100) * settings.loyaltyEarnPerUnit
          : 0;
      order = (
        await req.q(
          `INSERT INTO orders
             (tenant_id, customer_id, location_id, session_id, subtotal, discount, discount_type,
              beneficiary_name, beneficiary_id_number, beneficiary_id_type,
              tax_total, surcharge, tip, rounding_adjustment, total, status, amount_paid, change_due,
              note, idempotency_key, created_by, coupon_code, points_redeemed, points_earned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING *`,
          [
            req.auth.tid,
            body.customerId,
            locationId,
            openSession?.id ?? null,
            fromCents(priced.subtotalC),
            fromCents(discountC),
            body.discountType ?? 'regular',
            body.beneficiaryName ?? null,
            body.beneficiaryIdNumber ?? null,
            body.beneficiaryIdType ?? null,
            fromCents(priced.taxC),
            fromCents(priced.surchargeC),
            fromCents(priced.tipC),
            fromCents(priced.adjustmentC),
            fromCents(priced.totalC),
            status,
            fromCents(paidC),
            status === 'completed' ? fromCents(paidC - priced.totalC) : null,
            body.note,
            body.idempotencyKey,
            req.auth.userId,
            coupon?.code ?? null,
            pointsToBurn,
            pointsEarned,
          ]
        )
      ).rows[0];
    } catch (err) {
      if (err.code === '23505' && body.idempotencyKey) {
        const existing = await req.q(
          'SELECT * FROM orders WHERE idempotency_key = $1 AND tenant_id = $2',
          [body.idempotencyKey, req.auth.tid]
        );
        if (existing.rows[0]) {
          return res.json({ order: await hydrateOrder(req, existing.rows[0]), existing: true });
        }
      }
      throw err;
    }

    for (const l of lines) {
      await req.q(
        `INSERT INTO order_items (order_id, tenant_id, product_id, product_name, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, req.auth.tid, l.p.id, l.p.name, l.p.price, l.quantity, fromCents(cents(l.p.price) * l.quantity)]
      );
    }

    // Composite products deduct their components; plain products deduct
    // themselves - exactly the quantities verified above, from the register's
    // own stock pool.
    if (status !== 'cancelled') {
      for (const [productId, qty] of needs) {
        const p = byId.get(productId);
        if (!p) continue;
        await adjustPoolStock(req, locationId, productId, -qty);
        await req.q(
          `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, order_id, created_by)
           VALUES ($1,$2,$3,'sale',$4,$5)`,
          [req.auth.tid, productId, -qty, order.id, req.auth.userId]
        );
      }
    }

    await takePayments(req, { payments: body.payments, orderId: order.id, customer });

    // ---- loyalty / coupon bookkeeping ----
    if (customer && pointsToBurn > 0) {
      await req.q(
        'UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id = $2',
        [pointsToBurn, customer.id]
      );
    }
    if (order.points_earned > 0 && customer) {
      await req.q(
        'UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2',
        [order.points_earned, customer.id]
      );
    }
    if (coupon) {
      await req.q('UPDATE coupons SET times_used = times_used + 1 WHERE id = $1', [coupon.id]);
    }

    // Email receipt stub - dry-run logs until SMTP_URL is configured.
    if (status === 'completed' && customer?.email) {
      const { sendMail } = await import('../lib/mailer.js');
      void sendMail({
        to: customer.email,
        subject: `Your receipt #${order.order_no} · eSariPOS`,
        text: `Thanks for your visit! Order #${order.order_no} total ${fromCents(priced.totalC)}.`,
      }).catch(() => {});
    }

    // Outbound integrations (webhooks + e-commerce channels) never block checkout.
    if (status === 'completed') {
      const hydratedForHooks = await hydrateOrder(req, order);
      import('../lib/webhooks.js').then(({ deliverWebhookEvent }) =>
        deliverWebhookEvent(req.auth.tid, 'order.created', { order: hydratedForHooks })
      );
      import('../lib/channels.js').then(({ pushOrderToChannels }) =>
        pushOrderToChannels(hydratedForHooks)
      );
    }

    res.status(201).json({ order: await hydrateOrder(req, order), existing: false });
  })
);

// Settle a layaway: add tenders until the balance is covered. Cash rounding is
// recomputed once here across ALL tenders (old + new) so the completed order
// carries exactly one rounding adjustment.
ordersRouter.post(
  '/:id/settle',
  asyncHandler(async (req, res) => {
    const { payments } = settleSchema.parse(req.body);
    const order = (
      await req.q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
    ).rows[0];
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status !== 'layaway') throw new ApiError(409, 'Only layaway orders can be settled');

    const settings = await loadTenantSettings(req);
    const grossC =
      cents(order.subtotal) -
      cents(order.discount) +
      cents(order.tax_total) +
      cents(order.surcharge ?? 0) +
      cents(order.tip ?? 0);
    const { rows: existingPayments } = await req.q(
      'SELECT method FROM payments WHERE order_id = $1',
      [order.id]
    );
    const hasCash =
      existingPayments.some((p) => p.method === 'cash') ||
      payments.some((p) => p.method === 'cash');
    const { totalC: finalTotalC, adjustmentC } = hasCash
      ? applyCashRounding(grossC, settings.cashRounding)
      : { totalC: grossC, adjustmentC: 0 };

    await req.q(
      'UPDATE orders SET rounding_adjustment = $1, total = $2 WHERE id = $3',
      [fromCents(adjustmentC), fromCents(finalTotalC), order.id]
    );

    const balanceC = finalTotalC - cents(order.amount_paid ?? 0);
    const paidC = payments.reduce((s, p) => s + cents(p.amount), 0);
    if (paidC < balanceC) {
      throw new ApiError(400, `Still ${fromCents(balanceC - paidC)} short of the balance`);
    }
    const changeC = paidC - balanceC;
    if (changeC > 0 && !payments.some((p) => p.method === 'cash')) {
      throw new ApiError(400, 'Overpayment is only allowed with a cash payment');
    }

    let settleCustomer = null;
    if (order.customer_id) {
      settleCustomer = (
        await req.q('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [order.customer_id])
      ).rows[0];
    }

    await takePayments(req, { payments, orderId: order.id, customer: settleCustomer });

    const settings2 = settings;
    const earned =
      Math.floor(finalTotalC / 100) * Math.max(settings2.loyaltyEarnPerUnit, 0);
    await req.q(
      `UPDATE orders SET status = 'completed',
         amount_paid = amount_paid + $1,
         change_due = $2,
         points_earned = $4
       WHERE id = $3`,
      [fromCents(paidC), fromCents(changeC), order.id, earned]
    );
    if (settleCustomer && earned > 0) {
      await req.q(
        'UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2',
        [earned, settleCustomer.id]
      );
    }

    const updated = (await req.q('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
    res.json({ order: await hydrateOrder(req, updated) });
  })
);

// Cancel an uncollected layaway: restock everything and journal the deposit return.
ordersRouter.post(
  '/:id/cancel',
  requirePerm('refunds'),
  asyncHandler(async (req, res) => {
    const order = (
      await req.q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
    ).rows[0];
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status !== 'layaway') throw new ApiError(409, 'Only layaway orders can be cancelled');

    const { rows: cancelItems } = await req.q(
      'SELECT product_id, quantity - refunded_qty AS open_qty FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL',
      [order.id]
    );
    await restockForLines(
      req,
      cancelItems.map((i) => ({ productId: i.product_id, quantity: Number(i.open_qty) })),
      { reason: 'cancel', orderId: order.id, tid: req.auth.tid, userId: req.auth.userId, locationId: order.location_id ?? null }
    );

    // Store-credit deposits go back onto the customer's balance.
    if (order.customer_id) {
      const scPaid = (
        await req.q(
          `SELECT COALESCE(SUM(amount),0) AS total FROM payments
           WHERE order_id = $1 AND method = 'store_credit'`,
          [order.id]
        )
      ).rows[0].total;
      if (Number(scPaid) > 0) {
        await req.q(
          'UPDATE customers SET store_credit = store_credit + $1 WHERE id = $2',
          [Number(scPaid), order.customer_id]
        );
      }
    }

    const depositC = cents(order.amount_paid ?? 0);
    if (depositC > 0) {
      await req.q(
        `INSERT INTO refunds (tenant_id, order_id, amount, restocked, note, created_by)
         VALUES ($1,$2,$3,false,'Deposit returned at layaway cancellation',$4)`,
        [req.auth.tid, order.id, fromCents(depositC), req.auth.userId]
      );
    }

    await req.q("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
    const updated = (await req.q('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
    res.json({ order: await hydrateOrder(req, updated) });
  })
);

// Refund whole order (legacy) or specific lines/quantities.
// Body: { lines: [{ itemId, quantity }], restock, note } - omitting lines
// refunds everything still refundable.
ordersRouter.post(
  '/:id/refund',
  requirePerm('refunds'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      lines: z
        .array(
          z.object({
            itemId: z.string().uuid(),
            quantity: qtySchema,
          })
        )
        .max(200)
        .optional(),
      restock: z.boolean().default(true),
      note: z.string().trim().max(300).optional().nullable().transform(nullifyEmpty),
    });
    const body = schema.parse(req.body ?? {});

    const order = (
      await req.q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
    ).rows[0];
    if (!order) throw new ApiError(404, 'Order not found');
    if (['refunded', 'layaway', 'cancelled'].includes(order.status)) {
      throw new ApiError(409, `Cannot refund an order that is ${order.status}`);
    }

    const items = (
      await req.q('SELECT * FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL', [
        order.id,
      ])
    ).rows;
    const subtotalC = cents(order.subtotal);
    const markupC = cents(order.tax_total) + cents(order.surcharge ?? 0);
    const discountC = cents(order.discount);
    const remainingC = cents(order.total) - cents(order.refunded_total ?? 0);

    let refundedNetC = 0;
    let refundAmountC = 0;

    if (body.lines?.length) {
      const byItemId = new Map(items.map((i) => [i.id, i]));
      for (const line of body.lines) {
        const item = byItemId.get(line.itemId);
        if (!item) throw new ApiError(400, 'Refund line does not belong to this order');
        const refundable = r3(Number(item.quantity) - Number(item.refunded_qty));
        if (line.quantity > refundable + 1e-9) {
          throw new ApiError(
            400,
            `Only ${refundable} × ${item.product_name} can still be refunded`
          );
        }
        const lineNetC = Math.round(cents(item.unit_price) * line.quantity);
        refundedNetC += lineNetC;
      }
      if (subtotalC > 0 && refundedNetC > 0) {
        const share = refundedNetC / subtotalC;
        const discountShare = Math.min(Math.round(discountC * share), discountC);
        const markupShare = Math.min(Math.round(markupC * share), markupC);
        refundAmountC = refundedNetC - discountShare + markupShare;
      }
      refundAmountC = Math.max(Math.min(refundAmountC, remainingC), 1);

      for (const line of body.lines) {
        const item = byItemId.get(line.itemId);
        await req.q(
          'UPDATE order_items SET refunded_qty = refunded_qty + $1 WHERE id = $2',
          [line.quantity, item.id]
        );
        if (body.restock) {
          // Restores components for composite items, the product itself otherwise.
          await restockForLines(
            req,
            [{ productId: item.product_id, quantity: line.quantity }],
            { reason: 'refund', orderId: order.id, tid: req.auth.tid, userId: req.auth.userId, locationId: order.location_id ?? null }
          );
        }
      }
    } else {
      for (const item of items) {
        const qty = r3(Number(item.quantity) - Number(item.refunded_qty));
        if (qty <= 1e-9) continue;
        refundedNetC += Math.round(cents(item.unit_price) * qty);
        await req.q('UPDATE order_items SET refunded_qty = quantity WHERE id = $1', [item.id]);
        if (body.restock) {
          await restockForLines(
            req,
            [{ productId: item.product_id, quantity: qty }],
            { reason: 'refund', orderId: order.id, tid: req.auth.tid, userId: req.auth.userId, locationId: order.location_id ?? null }
          );
        }
      }
      refundAmountC = Math.max(remainingC, 0);
    }

    if (refundAmountC <= 0) throw new ApiError(409, 'Nothing left to refund on this order');

    // Store-credit tenders are returned to the customer's balance, pro-rata.
    let scReturned = 0;
    if (order.customer_id) {
      const scPaid = Number(
        (
          await req.q(
            `SELECT COALESCE(SUM(amount),0) AS total FROM payments
             WHERE order_id = $1 AND method = 'store_credit'`,
            [order.id]
          )
        ).rows[0].total
      );
      if (scPaid > 0 && cents(order.total) > 0) {
        scReturned = Math.round(scPaid * (refundAmountC / cents(order.total)) * 100) / 100;
        if (scReturned > 0) {
          await req.q(
            'UPDATE customers SET store_credit = store_credit + $1 WHERE id = $2',
            [scReturned, order.customer_id]
          );
        }
      }
    }

    // Reverse earned loyalty points in proportion to the refunded amount.
    if (order.customer_id && Number(order.points_earned ?? 0) > 0 && cents(order.total) > 0) {
      const reversal = Math.min(
        Math.floor(Number(order.points_earned) * (refundAmountC / cents(order.total))),
        Number(order.points_earned)
      );
      if (reversal > 0) {
        await req.q(
          'UPDATE customers SET loyalty_points = GREATEST(loyalty_points - $1, 0) WHERE id = $2',
          [reversal, order.customer_id]
        );
        await req.q(
          'UPDATE orders SET points_earned = GREATEST(points_earned - $1, 0) WHERE id = $2',
          [reversal, order.id]
        );
      }
    }

    await req.q(
      `INSERT INTO refunds (tenant_id, order_id, amount, restocked, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.auth.tid, order.id, fromCents(refundAmountC), body.restock, body.note, req.auth.userId]
    );
    await req.q(
      'UPDATE orders SET refunded_total = refunded_total + $1 WHERE id = $2',
      [fromCents(refundAmountC), order.id]
    );
    await audit(req, 'order.refunded', 'order', order.id, {
      amount: fromCents(refundAmountC),
      restocked: body.restock,
      lines: body.lines?.length ?? 'all',
    });

    // Flip status once every line is fully refunded.
    const { rows: afterItems } = await req.q(
      'SELECT COALESCE(SUM(quantity - refunded_qty), 0) AS open_qty FROM order_items WHERE order_id = $1',
      [order.id]
    );
    const openQty = Number(afterItems[0].open_qty);
    const newStatus = openQty <= 1e-9 ? 'refunded' : 'partially_refunded';
    await req.q('UPDATE orders SET status = $1 WHERE id = $2', [newStatus, order.id]);

    const updated = (await req.q('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
    res.json({
      order: await hydrateOrder(req, updated),
      refund: { amount: fromCents(refundAmountC), restocked: body.restock },
    });
  })
);
