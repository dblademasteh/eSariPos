import { api } from '../api/client.js';

const DB_NAME = 'novapos';
const STORE = 'queuedSales';


let dbPromise = null;
let flushing = false;
let autoFlushStarted = false;
const listeners = new Set();

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function notify() {
  for (const listener of [...listeners]) listener();
}

export function subscribeQueue(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function listQueued() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const [rows] = await Promise.all([
      requestDone(tx.objectStore(STORE).getAll()),
      txDone(tx),
    ]);
    return (rows ?? []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function putSale(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  notify();
}

export async function removeSale(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  notify();
}

export async function enqueueSale(payload, meta = {}) {
  const record = {
    id: payload.idempotencyKey,
    payload,
    total: meta.total ?? null,
    itemCount: meta.itemCount ?? payload.items?.length ?? 0,
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
    lastError: null,
  };
  await putSale(record);
  return record;
}

export async function discardSale(id) {
  await removeSale(id);
}

export async function retrySale(id) {
  const record = (await listQueued()).find((r) => r.id === id);
  if (!record) return;
  await putSale({ ...record, status: 'queued', lastError: null });
  flushQueue().catch(() => {});
}

export function flushQueue() {
  if (flushing) return Promise.resolve({ synced: 0 });
  flushing = true;
    async function run() {
      let synced = 0;
      for (;;) {
        const next = (await listQueued()).find((r) => r.status !== 'failed');
        if (!next) break;
      try {
        await api('/orders', { method: 'POST', body: next.payload });
        await removeSale(next.id);
        synced += 1;
      } catch (err) {
        next.attempts += 1;
        next.lastError = err.message;
        // 4xx (other than 429) means the sale itself is rejected — e.g. stock
        // gone while offline. Keep it for the user to resolve; never retry.
        const permanent = err.status >= 400 && err.status < 500 && err.status !== 429;
        await putSale({
          ...next,
          status: permanent ? 'failed' : 'queued',
        });
        if (!permanent) break;
      }
    }
    return { synced };
  }
  return run().finally(() => {
    flushing = false;
  });
}

export function startAutoFlush() {
  if (autoFlushStarted) return;
  autoFlushStarted = true;
  window.addEventListener('online', () => flushQueue().catch(() => {}));
  setInterval(() => flushQueue().catch(() => {}), 30_000);
  flushQueue().catch(() => {});
}
