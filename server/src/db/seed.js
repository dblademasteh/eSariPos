import bcrypt from 'bcryptjs';
import pg from 'pg';
import { env } from '../env.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  ['Coffee', '#0d9488'],
  ['Bakery', '#f59e0b'],
  ['Retail', '#6366f1'],
];

const PRODUCTS = [
  ['Espresso', '☕️', 'Coffee', 3.0, 0.55, 200],
  ['Americano', '🥤', 'Coffee', 3.5, 0.6, 180],
  ['Flat White', '☕️', 'Coffee', 4.25, 0.9, 150],
  ['Cappuccino', '☕️', 'Coffee', 4.25, 0.9, 140],
  ['Caffe Latte', '☕️', 'Coffee', 4.5, 1.0, 160],
  ['Mocha', '🍫', 'Coffee', 4.75, 1.2, 90],
  ['Cold Brew', '🧊', 'Coffee', 4.5, 0.8, 70],
  ['Chai Latte', '🍵', 'Coffee', 4.75, 1.1, 60],
  ['Matcha Latte', '🍵', 'Coffee', 5.0, 1.4, 40],
  ['Butter Croissant', '🥐', 'Bakery', 3.75, 1.2, 30],
  ['Blueberry Muffin', '🧁', 'Bakery', 3.5, 1.1, 24],
  ['Banana Bread', '🍞', 'Bakery', 3.25, 0.95, 18],
  ['Cinnamon Roll', '🌀', 'Bakery', 4.0, 1.3, 12],
  ['Chocolate Chip Cookie', '🍪', 'Bakery', 2.75, 0.7, 36],
  ['Espresso Beans 250g', '🫘', 'Retail', 14.0, 6.5, 15],
  ['Ceramic Mug', '🍶', 'Retail', 12.0, 4.0, 10],
  ['Tote Bag', '👜', 'Retail', 18.0, 7.0, 8],
];

const CUSTOMERS = [
  ['Ava Thompson', '555-0101', 'ava@example.com', 'Oat milk latte, extra hot'],
  ['Liam Chen', '555-0102', 'liam@example.com', null],
  ['Sofia Reyes', '555-0103', null, 'Runs the bookshop next door'],
  ['Noah Patel', '555-0104', 'noah@example.com', null],
];

const STAFF = [
  ['Alex Morgan', 'demo@novapos.dev', 'owner'],
  ['Sam Lee', 'manager@novapos.dev', 'manager'],
  ['Casey Kim', 'cashier@novapos.dev', 'cashier'],
];

async function main() {
  const force = process.argv.includes('--force');
  const client = new pg.Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();

  const existing = await client.query("SELECT id FROM tenants WHERE slug = 'demo'");
  if (existing.rows.length && !force) {
    console.log('Demo tenant already exists - nothing to do (use --force to seed again)');
    await client.end();
    return;
  }
  if (existing.rows.length && force) {
    await client.query('DELETE FROM tenants WHERE slug = $1', ['demo']);
    await client.query("DELETE FROM users WHERE email = 'demo@novapos.dev'");
    console.log('Removed previous demo data');
  }

  const rng = mulberry32(42);
  await client.query('BEGIN');

  try {
    const tenant = (
      await client.query(
        `INSERT INTO tenants (slug, name, currency, tax_rate, address, phone, receipt_footer)
         VALUES ('demo','Demo Coffee Co.','USD',8.50,'128 Brew Street, Portland OR','+1 555 010 0000','Thanks for stopping by! See you tomorrow.') 
         RETURNING id`,
        []
      )
    ).rows[0];
    const tid = tenant.id;

    const hash = await bcrypt.hash('demo1234', 10);
    const userIds = {};
    for (const [name, email, role] of STAFF) {
      const row = (
        await client.query(
          `INSERT INTO users (tenant_id, name, email, password_hash, role)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [tid, name, email.toLowerCase(), hash, role]
        )
      ).rows[0];
      userIds[role] = row.id;
    }

    const catIds = {};
    for (let i = 0; i < CATEGORIES.length; i++) {
      const [name, color] = CATEGORIES[i];
      const row = (
        await client.query(
          'INSERT INTO categories (tenant_id, name, color, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
          [tid, name, color, i]
        )
      ).rows[0];
      catIds[name] = row.id;
    }

    const productIds = [];
    for (const [name, emoji, category, price, cost, stock] of PRODUCTS) {
      const row = (
        await client.query(
          `INSERT INTO products (tenant_id, category_id, sku, name, emoji, price, cost, stock, low_stock_threshold)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, price`,
          [
            tid,
            catIds[category],
            'SKU-' + Math.floor(rng() * 90000 + 10000),
            name,
            emoji,
            price,
            cost,
            stock,
            name === 'Cinnamon Roll' ? 14 : 6,
          ]
        )
      ).rows[0];
      productIds.push({ id: row.id, price: row.price, name });
      await client.query(
        `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, created_by)
         VALUES ($1,$2,$3,'initial',$4)`,
        [tid, row.id, stock, userIds.owner]
      );
    }

    const customerIds = [];
    for (const [name, phone, email, note] of CUSTOMERS) {
      const row = (
        await client.query(
          'INSERT INTO customers (tenant_id, name, phone, email, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [tid, name, phone, email, note]
        )
      ).rows[0];
      customerIds.push(row.id);
    }

    let orderCount = 0;
    for (let i = 0; i < 70; i++) {
      const daysAgo = Math.floor(rng() * 7);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - daysAgo);
      createdAt.setHours(8 + Math.floor(rng() * 13), Math.floor(rng() * 60), 0, 0);

      const itemCount = 1 + Math.floor(rng() * 3);
      const picked = new Set();
      const lines = [];
      for (let j = 0; j < itemCount; j++) {
        let idx = Math.floor(rng() * productIds.length);
        while (picked.has(idx)) idx = (idx + 1) % productIds.length;
        picked.add(idx);
        lines.push({ p: productIds[idx], qty: 1 + Math.floor(rng() * 2) });
      }

      let subtotalC = 0;
      for (const l of lines) subtotalC += Math.round(Number(l.p.price) * 100) * l.qty;
      const discountC = rng() < 0.08 ? Math.round(subtotalC * 0.1) : 0;
      const taxableC = subtotalC - discountC;
      const taxC = Math.round(taxableC * 0.085);
      const totalC = taxableC + taxC;

      const isCash = rng() < 0.55;
      let paidC = totalC;
      if (isCash) {
        paidC = Math.ceil(totalC / 500) * 500;
        if (paidC < totalC) paidC += 500;
        if (paidC === totalC) paidC = totalC;
      }

      const cashier = rng() < 0.5 ? userIds.cashier : userIds.manager;
      const order = (
        await client.query(
          `INSERT INTO orders (tenant_id, customer_id, status, subtotal, discount, tax_total, total,
                               amount_paid, change_due, created_by, created_at)
           VALUES ($1,$2,'completed',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            tid,
            rng() < 0.35 ? customerIds[Math.floor(rng() * customerIds.length)] : null,
            subtotalC / 100,
            discountC / 100,
            taxC / 100,
            totalC / 100,
            paidC / 100,
            (paidC - totalC) / 100,
            cashier,
            createdAt,
          ]
        )
      ).rows[0];

      for (const l of lines) {
        const lineC = Math.round(Number(l.p.price) * 100) * l.qty;
        await client.query(
          `INSERT INTO order_items (order_id, tenant_id, product_id, product_name, unit_price, quantity, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [order.id, tid, l.p.id, l.p.name, l.p.price, l.qty, lineC / 100]
        );
        await client.query(
          `INSERT INTO stock_movements (tenant_id, product_id, delta, reason, order_id, created_by, created_at)
           VALUES ($1,$2,$3,'sale',$4,$5,$6)`,
          [tid, l.p.id, -l.qty, order.id, cashier, createdAt]
        );
      }

      await client.query(
        `INSERT INTO payments (order_id, tenant_id, method, amount, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, tid, isCash ? 'cash' : 'card', paidC / 100, createdAt]
      );
      orderCount++;
    }

    await client.query('COMMIT');
    console.log(`Seeded demo tenant: 3 staff accounts, ${PRODUCTS.length} products, ${orderCount} historic orders`);
    console.log('Sign in with business ID "demo" + demo@novapos.dev / demo1234');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
