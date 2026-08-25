# 🧾 NovaPOS — Multi-Tenant Point of Sale

A production-shaped, multi-tenant POS built from scratch:

| Layer     | Tech                                                              |
| --------- | ----------------------------------------------------------------- |
| Database  | PostgreSQL 16 with **Row-Level Security** tenant isolation        |
| API       | Node.js 20+, Express, `pg`, Zod validation, JWT auth               |
| Frontend  | React 18, Vite 5, Tailwind CSS v4, **daisyUI 5**                  |
| Infra     | Docker Compose (one command brings up Postgres on port **5433**)   |

## Quick start

```powershell
npm run setup          # installs root + server + web deps
docker compose up -d   # starts Postgres (db "pos", port 5433)
npm run db:migrate     # creates schema, RLS policies, restricted app role
npm run db:seed        # demo tenant: staff, 17 products, 70 historic orders
npm run dev            # runs API (:4000) + web dev server (:5173) together
```

Open http://localhost:5173

**Demo logins** (business ID `demo`, password `demo1234`):

| Account | Email                | Role    |
| ------- | -------------------- | ------- |
| Alex    | demo@novapos.dev     | owner   |
| Sam     | manager@novapos.dev  | manager |
| Casey   | cashier@novapos.dev  | cashier |

Or click **New business** on the login page to create a second tenant and watch the isolation.

## How the multi-tenancy works

Every business is a `tenants` row identified by a slug ("Business ID"). Every
tenant-owned row carries `tenant_id`. Isolation is enforced at **two layers**:

1. **Database (authoritative).** The app connects as a dedicated login role
   `pos_app`. On every request the API opens one transaction, sets
   `set_config('app.tenant_id', <tid>, true)` (transaction-local), and every
   table has a policy:
   ```sql
   USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
   WITH CHECK (...)
   ```
   An unset variable makes the predicate NULL ⇒ zero rows ⇒ fail closed.
   Even a buggy `WHERE` clause cannot leak another tenant's data.
2. **Application (defense in depth).** Handlers still scope queries by tenant
   where it reads naturally; JWT carries `{ sub, tid, role }`; roles gate
   mutations (owner > manager > cashier).

Money math is done in integer cents server-side (`lib/money.js`) — prices come
from the DB, never from the client. Orders support an idempotency key so a
double-tap on "Charge" can't double-charge. Stock changes go through row locks
(`SELECT … FOR UPDATE`) and are journaled in `stock_movements`.

## Project structure

```
novapos/
├── docker-compose.yml         Postgres 16 on :5433
├── server/
│   ├── sql/001_init.sql       schema + RLS policies + grants
│   └── src/
│       ├── index.js           Express wiring, SPA serving, error mapping
│       ├── middleware/        auth (JWT), tenant session, rate limit
│       ├── routes/            auth, products, categories, customers,
│       │                      orders, reports, staff, settings
│       └── db/                pools, migrate runner, seed
└── web/src/
    ├── pages/                 Login, Dashboard, POS, Products, Orders,
    │                          Customers, Staff, Settings
    └── components/            Layout, Receipt (print-ready), UI kit
```

## API sketch

| Endpoint                        | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `POST /api/auth/login`          | business ID + email + password → JWT       |
| `POST /api/auth/register`       | create tenant + owner (auto-login)         |
| `GET/PATCH /api/settings`       | store name, currency, tax rate, receipt    |
| CRUD `/api/products`            | incl. `POST /:id/adjust` stock journaling  |
| CRUD `/api/categories`          | color-coded register chips                 |
| CRUD `/api/customers`           | quick lookup by phone/name                 |
| `GET/POST /api/orders`          | checkout (server-priced, tips/surcharge/cash-rounding, split tender, idempotent) |
| `POST /api/orders/:id/settle`   | complete a layaway (balance + change)                    |
| `POST /api/orders/:id/cancel`   | cancel a layaway, restock, journal deposit return        |
| `POST /api/orders/:id/refund`   | manager+, whole-order or per-line partial refunds        |
| CRUD `/api/gift-cards`          | issue / reload / deactivate / history (manager+)         |
| CRUD `/api/suppliers`           | supplier directory (manager+)                            |
| `GET/POST /api/purchases`       | purchase orders, partial receiving, reorder suggestions  |
| `GET/POST /api/counts`          | cycle counts: snapshot, save, apply variances            |
| `POST /api/locations/transfers` | move stock between locations, journaled                  |
| `POST /api/cash-sessions/*`     | drawer open, drops/payouts, X-report, Z-report close-out |
| `POST /api/timeclock/*`         | clock in/out + hours report                              |
| `GET /api/audit`                | admin/user action journal (owner)                        |
| `GET /api/reports/*`            | summary, daily series, top sellers, low stock (refund-aware) |

## Deliberate design choices & what I'd do next

Choices made for you (worth knowing):

- **Shared schema + RLS**, not schema-per-tenant: cheapest to operate, one
  migration path, and RLS gives hard guarantees. Move hot tenants out only if
  you ever need per-tenant SLAs/compliance.
- **Two DB roles**: migrations/admin use `ADMIN_DATABASE_URL`; runtime uses
  least-privilege `pos_app` which physically cannot bypass RLS.
- **JWT in localStorage** for simplicity — fine behind HTTPS for a demo, but
  see below.

Recommended next steps, roughly in order of value:

1. **Sessions as httpOnly cookies** (+ CSRF strategy) instead of localStorage
   JWTs, with short-lived access tokens + refresh rotation.
2. **Offline-tolerant register**: queue sales in IndexedDB and replay with the
   existing idempotency keys when connectivity drops — POS must survive Wi-Fi
   blips.
3. **Hardware**: ESC/POS receipt printers, cash-drawer kick, barcode scanner
   HID (the search box already accepts scanner input via SKU/barcode + Enter).
4. **Payments**: Stripe Terminal / Adyen card-present integration so card
   payments settle for real instead of being recorded.
5. **Ops**: PITR backups, structured logging (pino), Sentry, CI that runs
   migrations against an ephemeral Postgres plus supertest API tests and a
   Playwright happy-path E2E.
6. **Product depth**: shift/cash-drawer sessions with Z-reports, purchase
   orders & suppliers, promotions/loyalty, line-item discounts, split tender
   UI, kitchen displays, per-store locations within a tenant.
