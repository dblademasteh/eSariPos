import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/api.js';
import { requirePerm } from '../middleware/auth.js';
import { computeDailySummary } from '../lib/digest.js';

export const reportsRouter = Router();

reportsRouter.use(requirePerm('reports'));

const tzSchema = z
  .string()
  .max(64)
  .regex(/^[\w\-+/]+$/, 'Invalid timezone')
  .default('UTC');

reportsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      tz: tzSchema,
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    const { tz, from, to } = schema.parse(req.query);

    // Explicit range wins; otherwise the calendar day so far in `tz`.
    let spanSql;
    let params;
    if (from && to) {
      params = [new Date(from), new Date(to)];
      spanSql = `o.created_at >= $1 AND o.created_at < $2`;
      var itemsSpanSql = spanSql;
    } else {
      params = [tz];
      spanSql = `o.created_at >= ((SELECT date_trunc('day', now() AT TIME ZONE $1)) AT TIME ZONE $1)
             AND o.created_at < ((SELECT date_trunc('day', now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1)`;
      itemsSpanSql = spanSql;
    }

    const { rows } = await req.q(
      `SELECT
        COALESCE((SELECT SUM(GREATEST(o.total - o.refunded_total, 0)) FROM orders o
         WHERE o.status IN ('completed','partially_refunded','refunded') AND ${spanSql}), 0) AS revenue,
        (SELECT COUNT(*) FROM orders o
         WHERE o.status IN ('completed','partially_refunded','refunded') AND ${spanSql}) AS orders_count,
        COALESCE((SELECT SUM(oi.quantity - oi.refunded_qty) FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN ('completed','partially_refunded','refunded') AND ${itemsSpanSql}), 0) AS items_sold`,
      params
    );
    const revenue = Number(rows[0].revenue);
    const ordersCount = Number(rows[0].orders_count);
    res.json({
      revenue,
      ordersCount,
      itemsSold: Number(rows[0].items_sold),
      avgTicket: ordersCount ? Math.round((revenue / ordersCount) * 100) / 100 : 0,
    });
  })
);

// Tax collected within a range, net of refunds. The tenant has one rate today;
// results are grouped by rate so multiple jurisdictions can slot in later.
reportsRouter.get(
  '/tax',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    });
    const { from, to } = schema.parse(req.query);
    const { rows } = await req.q(
      `SELECT t.tax_rate AS rate, t.currency,
              COUNT(o.id) FILTER (WHERE o.id IS NOT NULL) AS orders,
              COALESCE(SUM(o.subtotal), 0) AS taxable_sales,
              COALESCE(SUM(o.discount), 0) AS discounts,
              COALESCE(SUM(o.tax_total), 0) AS tax_charged,
              COALESCE(SUM(o.refunded_total), 0) AS refunded_incl_tax,
              GREATEST(COALESCE(SUM(o.total - o.refunded_total), 0), 0) AS net_sales
       FROM tenants t
       LEFT JOIN orders o ON o.tenant_id = t.id
         AND o.status IN ('completed','partially_refunded','refunded')
         AND o.created_at >= $1 AND o.created_at < $2
       WHERE t.id = $3
       GROUP BY t.tax_rate, t.currency`,
      [new Date(from), new Date(to), req.auth.tid]
    );
    const row = rows[0] ?? {};
    const rate = Number(row.rate ?? 0);
    const netSales = Number(row.net_sales ?? 0);
    const taxCharged = Number(row.tax_charged ?? 0);
    const refundedInclTax = Number(row.refunded_incl_tax ?? 0);
    // Refund amounts include their pro-rata tax/service share; report the
    // estimated tax portion of refunds at the same statutory rate.
    const refundShareOfSale = netSales > 0 ? Math.min(refundedInclTax / netSales, 1) : 0;
    const netTax = Math.max(taxCharged - taxCharged * refundShareOfSale, 0);
    res.json({
      currency: row.currency ?? 'USD',
      rates: [
        {
          rate,
          orders: Number(row.orders ?? 0),
          taxableSales: Math.round(Number(row.taxable_sales ?? 0) * 100) / 100,
          discounts: Math.round(Number(row.discounts ?? 0) * 100) / 100,
          taxCharged,
          netSales,
          estimatedNetTax: Math.round(netTax * 100) / 100,
        },
      ],
      totals: {
        netSales,
        estimatedNetTax: Math.round(netTax * 100) / 100,
      },
    });
  })
);

// Per-product profitability: net quantities/revenue vs stored unit cost.
reportsRouter.get(
  '/profitability',
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const { rows } = await req.q(
      `WITH sold AS (
         SELECT oi.product_id,
                SUM(oi.quantity - oi.refunded_qty) AS qty,
                SUM(oi.line_total * (oi.quantity - oi.refunded_qty)::numeric / NULLIF(oi.quantity, 0)) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status IN ('completed','partially_refunded','refunded')
           AND o.created_at >= now() - ($1::int * interval '1 day')
           AND oi.product_id IS NOT NULL
         GROUP BY oi.product_id
         HAVING SUM(oi.quantity - oi.refunded_qty) > 0
       )
       SELECT p.id, p.name, p.emoji, p.cost, s.qty, s.revenue,
              (s.qty * p.cost) AS cogs
       FROM sold s JOIN products p ON p.id = s.product_id
       ORDER BY (s.revenue - s.qty * p.cost) DESC
       LIMIT $2`,
      [days, limit]
    );
    res.json(
      rows.map((r) => {
        const qty = Number(r.qty);
        const revenue = Math.round(Number(r.revenue) * 100) / 100;
        const cogs = Math.round(Number(r.cogs) * 100) / 100;
        const profit = Math.round((revenue - cogs) * 100) / 100;
        return {
          productId: r.id,
          name: r.name,
          emoji: r.emoji,
          qty: Math.round(qty * 1000) / 1000,
          revenue,
          unitCost: Number(r.cost ?? 0),
          cogs,
          profit,
          marginPct: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
        };
      })
    );
  })
);

// Accounting export rows (QuickBooks/Xero-friendly flat journal summary).
reportsRouter.get(
  '/accounting-export',
  asyncHandler(async (req, res) => {
    const schema = z.object({ from: z.string().datetime(), to: z.string().datetime() });
    const { from, to } = schema.parse(req.query);
    const { rows } = await req.q(
      `SELECT (o.created_at AT TIME ZONE 'UTC')::date AS day,
              COALESCE(SUM(o.subtotal), 0) AS gross_sales,
              COALESCE(SUM(o.discount), 0) AS discounts_given,
              COALESCE(SUM(o.surcharge), 0) AS service_charges,
              COALESCE(SUM(o.tip), 0) AS tips,
              COALESCE(SUM(o.tax_total), 0) AS tax_collected,
              COALESCE(SUM(GREATEST(o.total - o.refunded_total, 0)), 0) AS net_sales,
              COALESCE(SUM(o.refunded_total), 0) AS refunds,
              COUNT(*) AS order_count
       FROM orders o
       WHERE o.tenant_id = $3
         AND o.status IN ('completed','partially_refunded','refunded')
         AND o.created_at >= $1 AND o.created_at < $2
       GROUP BY 1 ORDER BY 1`,
      [new Date(from), new Date(to), req.auth.tid]
    );
    res.json(
      rows.map((r) => ({
        day: r.day,
        grossSales: Number(r.gross_sales),
        discountsGiven: Number(r.discounts_given),
        serviceCharges: Number(r.service_charges),
        tips: Number(r.tips),
        taxCollected: Number(r.tax_collected),
        refunds: Number(r.refunds),
        netSales: Number(r.net_sales),
        orderCount: Number(r.order_count),
      }))
    );
  })
);

// One-day digest payload (shared with the scheduled email job).
reportsRouter.get(
  '/daily-summary',
  asyncHandler(async (req, res) => {
    const tz = tzSchema.parse(req.query.tz);
    const daysAgo = Math.min(Math.max(Number(req.query.daysAgo) || 1, 0), 30);
    const summary = await computeDailySummary({ query: (t, p) => req.q(t, p) }, req.auth.tid, tz, daysAgo);
    res.json(summary);
  })
);

reportsRouter.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const parsed = tzSchema.parse(req.query.tz);
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const { rows } = await req.q(
      `SELECT d::date AS day,
              COALESCE(SUM(GREATEST(o.total - o.refunded_total, 0)), 0) AS revenue,
              COUNT(o.id) AS orders
       FROM generate_series(
         (now() AT TIME ZONE $1)::date - ($2::int - 1),
         (now() AT TIME ZONE $1)::date,
         interval '1 day'
       ) d
       LEFT JOIN orders o
         ON (o.created_at AT TIME ZONE $1)::date = d::date
        AND o.status IN ('completed','partially_refunded','refunded')
       GROUP BY d ORDER BY d`,
      [parsed, days]
    );
    res.json(rows.map((r) => ({ day: r.day, revenue: Number(r.revenue), orders: Number(r.orders) })));
  })
);

reportsRouter.get(
  '/top-products',
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 25);
    const { rows } = await req.q(
      `SELECT oi.product_name AS name,
              SUM(oi.quantity - oi.refunded_qty)::int AS qty,
              SUM(oi.line_total * (oi.quantity - oi.refunded_qty)::numeric / oi.quantity) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('completed','partially_refunded','refunded')
         AND o.created_at >= now() - ($1::int * interval '1 day')
       GROUP BY 1
       HAVING SUM(oi.quantity - oi.refunded_qty) > 0
       ORDER BY qty DESC LIMIT $2`,
      [days, limit]
    );
    res.json(rows.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })));
  })
);

reportsRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const { rows } = await req.q(
      `SELECT id, name, emoji, stock, low_stock_threshold
       FROM products
       WHERE is_active AND stock <= low_stock_threshold
       ORDER BY stock ASC LIMIT 25`
    );
    res.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        stock: p.stock,
        lowStockThreshold: p.low_stock_threshold,
      }))
    );
  })
);
