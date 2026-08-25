# Offline Sale Queue

How NovaPOS keeps taking orders when the network drops, and how those orders
reach the server safely once it returns.

## Why

A register must survive Wi-Fi blips. If checkout fails because the API is
unreachable, the sale is saved locally in the browser (IndexedDB) and replayed
automatically later. Double-charging is impossible: every sale carries an
idempotency key, and the server enforces `UNIQUE (tenant_id, idempotency_key)`
on `orders` — replays return the original order instead of creating a new one.

## Files

| File | Role |
| --- | --- |
| `web/src/lib/offlineQueue.js` | IndexedDB store + flush engine + auto-flush listeners |
| `web/src/state/useOfflineQueue.js` | `useOfflineQueue()` / `useOnline()` React hooks |
| `web/src/pages/POS.jsx` | Enqueues sales on network failure; stable per-sale idempotency key |
| `web/src/components/Layout.jsx` | Header badge (`SyncBadge`): queue status, sync now, retry, discard |

## Flow

```
Charge clicked
  ├─ POST /api/orders succeeds ─────────────► receipt shown, done
  └─ fails with network error / 5xx / 429
        └─ payload saved to IndexedDB ──► toast "saved offline"
              ├─ connection returns (online event)      ─┐
              ├─ 30s auto-flush timer                    ├─► flushQueue()
              ├─ any successful online sale              │     FIFO replay,
              ├─ app load                                │     one by one
              └─ "Sync now" button                       ─┘
                    ├─ 2xx (or existing:true) ► remove from queue
                    ├─ 4xx (not 429)          ► mark FAILED, keep for review
                    └─ network/5xx/429        ► keep QUEUED, stop flushing
```

### Sale states

| State | Meaning | What happens |
| --- | --- | --- |
| `queued` | Waiting for connectivity | Replayed automatically (FIFO, oldest first) |
| `failed` | Server rejected the sale permanently | Never auto-retried. User can retry ↻ or discard ✕ from the header menu |

A rejection is "permanent" when the server answered 4xx (other than 429) —
e.g. stock was sold out while offline, or the cart no longer validates.
Retrying a failed sale re-sends the identical payload; if the problem persists
it simply flips back to `failed`.

## Idempotency contract

- The payment modal generates **one UUID when it opens** and reuses it for
  every submit attempt of that session (`POS.jsx`). Manual re-clicks after a
  timeout are therefore as safe as automatic replays.
- The queued record's `_id` in IndexedDB **is** the idempotency key.
- Verified behaviour: submitting the same key twice returns the same order
  twice; the second response carries `existing: true` and stock is decremented
  only once (`server/src/routes/orders.routes.js`, race-safe via the unique
  index and its 23505 fallback).

## Queued record shape

```js
{
  id: "<uuid = idempotencyKey>",
  payload: { items, discount, payments, idempotencyKey }, // exact POST body
  total: 12.5,          // display only
  itemCount: 3,         // display only
  createdAt: 1724567890123,
  attempts: 0,
  status: "queued",     // "queued" | "failed"
  lastError: null       // last error message, shown in the header dropdown
}
```

Store: IndexedDB database `novapos`, object store `queuedSales`,
keyPath `id`.

## UI behaviour (`Layout.jsx` → `SyncBadge`)

Hidden entirely when online with an empty queue. Otherwise a header button
shows:

- 📡 **Offline** — chip appears as soon as the browser reports offline, even
  with nothing queued, so cashiers know sales will be queued if they charge.
- ⏳ **n queued** — count badge; dropdown lists each sale with timestamp,
  amount, state badge and last error. Failed rows get retry ↻ / discard ✕;
  online + non-empty shows **Sync now**.

Toasts confirm outcomes: queued sales announce themselves when saved; synced
orders appear in Orders like any other sale (no separate receipt flow).

## Guarantees & edge cases

- **No double charges** — idempotency key deduped server-side, even across
  tabs, devices, and manual retries of the same modal session.
- **Partial flush** — replay stops at the first still-unreachable sale but
  keeps draining earlier ones that succeed.
- **Signed out mid-queue** — flushing pauses while no auth token exists
  (`novapos.auth` missing); the queue survives and resumes after login.
  Queues are per browser profile, not per user account.
- **IndexedDB unavailable** (rare private-mode browsers) — enqueue throws and
  the cashier sees the original network error; nothing is silently lost.
- **Stock is not reserved offline** — local stock counts stay untouched while
  offline; conflicts surface as `failed` sales at replay time.

## Testing manually

1. Open the register, fill a cart, collect payment.
2. DevTools → Network → **Offline**, complete the sale → toast "saved
   offline", header shows 📡 Offline / queue count.
3. Take one more sale while offline.
4. Switch back to **Online** → both orders replay into Orders within seconds;
   the badge disappears.
5. To see a `failed` sale: go offline, empty the product's stock via another
   tab (Products), then retry the queued sale → it flips to failed with the
   server's message.

## Known limitations / next steps

- Product catalog and customer lookup still require connectivity (offline
  catalog snapshot is a natural follow-up).
- No background sync worker; flushing runs only while a staffed tab is open.
- Queue is capped only by browser storage quotas — no tenant-side cap yet.
