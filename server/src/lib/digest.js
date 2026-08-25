import { adminPool } from '../db/pool.js';
import { sendMail } from './mailer.js';

// Builds the daily-summary payload via any { query } executor (a pool for the
// scheduler, a request handle for the reports route), always filtering by
// tenant explicitly.
export async function computeDailySummary(poolish, tenantId, tz, daysAgo) {
  const { rows } = await poolish.query(
    `WITH span AS (
       SELECT (date_trunc('day', now() AT TIME ZONE $1) - ($2::int * interval '1 day')) AS day_start
     )
     SELECT
       (SELECT COUNT(*) FROM orders o, span
        WHERE o.tenant_id = $3
          AND o.status IN ('completed','partially_refunded','refunded')
          AND o.created_at >= span.day_start AT TIME ZONE $1
          AND o.created_at < (span.day_start + interval '1 day') AT TIME ZONE $1) AS orders_count,
       COALESCE((SELECT SUM(GREATEST(o.total - o.refunded_total, 0)) FROM orders o, span
        WHERE o.tenant_id = $3
          AND o.status IN ('completed','partially_refunded','refunded')
          AND o.created_at >= span.day_start AT TIME ZONE $1
          AND o.created_at < (span.day_start + interval '1 day') AT TIME ZONE $1), 0) AS revenue,
       (SELECT oi.product_name FROM order_items oi
        JOIN orders o ON o.id = oi.order_id, span
        WHERE o.tenant_id = $3
          AND o.status IN ('completed','partially_refunded','refunded')
          AND o.created_at >= span.day_start AT TIME ZONE $1
          AND o.created_at < (span.day_start + interval '1 day') AT TIME ZONE $1
        GROUP BY oi.product_name ORDER BY SUM(oi.quantity - oi.refunded_qty) DESC LIMIT 1) AS top_product,
       (SELECT count(*) FROM products p WHERE p.tenant_id = $3 AND p.is_active AND p.stock <= p.low_stock_threshold) AS low_stock_count`,
    [tz, daysAgo, tenantId]
  );
  return {
    daysAgo,
    ordersCount: Number(rows[0].orders_count),
    revenue: Number(rows[0].revenue),
    topProduct: rows[0].top_product ?? null,
    lowStockCount: Number(rows[0].low_stock_count),
  };
}

function renderText(summary, slug) {
  return [
    `eSariPOS daily summary · ${slug} (${summary.daysAgo === 1 ? 'yesterday' : `${summary.daysAgo} days ago`})`,
    ``,
    `Orders:      ${summary.ordersCount}`,
    `Net revenue: ${summary.revenue.toFixed(2)}`,
    `Top seller:  ${summary.topProduct ?? '—'}`,
    `Low stock items: ${summary.lowStockCount}`,
  ].join('\n');
}

// Runs once shortly after 06:00 server time each day (checked every 30 min).
// Delivery goes through lib/mailer.js - a dry-run log until SMTP is wired up.
let started = false;

export function startDigestScheduler() {
  if (started) return;
  started = true;

  async function runDue() {
    const tenants = await adminPool.query(
      `SELECT DISTINCT t.id, t.slug, t.timezone
       FROM tenants t JOIN users u ON u.tenant_id = t.id AND u.role = 'owner' AND u.is_active`
    );
    for (const tenant of tenants.rows) {
      try {
        const tz = tenant.timezone || 'UTC';
        // Check if it's past 06:00 in the tenant's timezone
        const hourInTz = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
        if (Number(hourInTz) < 6) continue;
        const already = await adminPool.query(
          `SELECT 1 FROM audit_log
           WHERE tenant_id = $1 AND action = 'digest.sent'
             AND created_at >= date_trunc('day', now() AT TIME ZONE $2) LIMIT 1`,
          [tenant.id, tz]
        );
        if (already.rowCount) continue;

        const summary = await computeDailySummary(adminPool, tenant.id, tz, 1);
        const owners = await adminPool.query(
          `SELECT email FROM users WHERE tenant_id = $1 AND role = 'owner' AND is_active`,
          [tenant.id]
        );
        const to = owners.rows.map((r) => r.email).join(',');
        if (!to) continue;
        await sendMail({
          to,
          subject: `eSariPOS daily summary · ${tenant.slug}`,
          text: renderText(summary, tenant.slug),
        });
        await adminPool.query(
          `INSERT INTO audit_log (tenant_id, user_id, action, entity, meta)
           VALUES ($1, NULL, 'digest.sent', 'tenant', $2)`,
          [tenant.id, JSON.stringify(summary)]
        );
        console.log(`[digest] sent for ${tenant.slug}`);
      } catch (err) {
        console.error(`[digest] failed for ${tenant.slug}:`, err.message);
      }
    }
  }

  runDue().catch(() => {});
  setInterval(() => runDue().catch((err) => console.error('[digest]', err.message)), 30 * 60_000);
}
