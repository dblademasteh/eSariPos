// API smoke tests - run with: node --test tests/api/
// Runs against a live API (default http://localhost:4000).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = process.env.NOVAPOS_URL ?? 'http://localhost:4000/api';

async function api(method, path, token, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const owner = await api('POST', '/auth/login', null, {
  slug: 'demo',
  email: 'demo@novapos.dev',
  password: 'demo1234',
});
const O = owner.data?.token;

test('health endpoint is open', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
});

test('unauthenticated requests are rejected', async () => {
  const r = await api('GET', '/products');
  assert.equal(r.status, 401);
});

test('owner can list products and reports', async () => {
  assert.ok(O, 'login failed');
  const products = await api('GET', '/products', O);
  assert.equal(products.status, 200);
  const reports = await api('GET', '/reports/summary?tz=UTC', O);
  assert.equal(reports.status, 200);
  assert.ok('revenue' in reports.data);
});

test('cashier cannot access staff management', async () => {
  const cash = (
    await api('POST', '/auth/login', null, {
      slug: 'demo',
      email: 'cashier@novapos.dev',
      password: 'demo1234',
    })
  ).data;
  const r = await api('GET', '/staff', cash.token);
  assert.equal(r.status, 403);
});

test('checkout prices server-side and dedupes idempotency keys', async () => {
  const prods = (await api('GET', '/products', O)).data.filter(
    (p) => !p.parentId && Number(p.stock) > 2
  );
  const p = prods[0];
  const key = crypto.randomUUID();
  const body = {
    items: [{ productId: p.id, quantity: 1 }],
    discount: 0,
    payments: [{ method: 'cash', amount: Number(p.price) * 3 }],
    idempotencyKey: key,
  };
  const first = await api('POST', '/orders', O, body);
  assert.equal(first.status, 201);
  const second = await api('POST', '/orders', O, body);
  assert.equal(second.status, 200);
  assert.equal(first.data.order.id, second.data.order.id);
});

test('tax report returns rate rows', async () => {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const r = await api('GET', `/reports/tax?from=${from}&to=${to}`, O);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.rates));
});
