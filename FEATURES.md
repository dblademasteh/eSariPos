# NovaPOS — Feature Backlog

Features planned for future implementation, grouped by area. Items marked ✅ are already in v1.

## 1. Payments & Checkout
- [ ] Card-present processing (Stripe Terminal / Adyen) with real settlement — *checkout path + PSP adapter stub exist (`lib/psp.js`, `card_terminal` method); needs STRIPE_API_KEY and a real integration*
- [x] Split-tender UI — unlimited mix of cash/card/terminal/mobile/gift card per sale ✅
- [x] Partial & line-item refunds with per-line qty selection, optional restock, `refunds` journal and pro-rata tax/service-share math ✅
- [x] Tips — % presets or custom, added pre-total, attributed to the ringing cashier ✅
- [x] Gift cards — issue/reload/deactivate admin page, redeem as a tender, full transaction journal ✅
- [x] Layaway / pay-later orders — deposit at checkout, settle or cancel (auto-restock) from Orders ✅
- [x] Surcharges & cash-rounding rules — configurable service charge % and nickel/dime/unit rounding when cash is tendered ✅

## 2. Register / Sales UX
- [x] Offline mode: IndexedDB sale queue + auto-replay (header badge shows queued/failed sales; idempotency keys prevent double-charging) ✅
- [x] Held / parked tickets — park unlimited carts per register, recall or discard (persisted locally) ✅
- [ ] Dedicated barcode-scanner HID mode (search box already accepts SKU/barcode + Enter ✅)
- [ ] Quick-sale buttons / favorites bar
- [ ] On-screen numeric keypad for touch terminals
- [ ] Multi-language & RTL support

## 3. Hardware
- [x] ESC/POS thermal receipt adapter — WebUSB channel with browser-print fallback (`lib/hardware.js`) ✅
- [x] Cash-drawer kick on completed cash sales via ESC/POS pulse (no-op without a claimed printer) ✅
- [x] Second customer-facing display — `/display` page mirrored live from the register over BroadcastChannel ✅
- [x] Shelf-tag / label sheets — printable grid with Code128 barcodes generated dependency-free ✅

## 4. Inventory & Suppliers
- [x] Purchase orders, supplier directory, receiving (partial receives, cost updates, restock journaling) ✅
- [x] Stock counts — cycle counts with snapshot, progress save, variance report and apply ✅
- [x] Recipes / BOM — one-level composites deduct ingredients at checkout, refunds/cancels restore them ✅
- [x] Product variants (parent/child groups on the register) — *ticket-level modifiers (size, milk type prompts) still open*
- [x] Unit-of-measure items (sold by weight/length, 3-decimal quantities, unit labels) ✅
- [x] Inter-location stock transfers (default pool + named locations; movement journal pairs) ✅
- [x] Reorder points with auto-generated reorder suggestions (sales velocity × coverage window) and build-a-PO flow ✅

## 5. Customers & Marketing
- [x] Loyalty points — earn on completed sales (rate configurable), redeem as pre-tax discount, pro-rata reversal on refunds ✅
- [x] Store credit / account balance — top-ups, `store_credit` tender at checkout, auto-restore on refund/cancel ✅
- [x] Promotions engine — % off coupon codes with usage caps and time windows (BOGO/happy-hour schedules still open) ✅
- [x] Email receipts — sent via the mailer stub after completed sales when the customer has an email (dry-run until SMTP configured); SMS pending provider ✅
- [x] Marketing export — per-customer visits / lifetime value / recent spend CSV ✅
- [x] Customer profile modal — balances, visit stats, LTV, recent orders ✅

## 6. Multi-store & Staff
- [x] Multiple locations per tenant with per-location stock (shared price list) — register picker, location-aware checkout/refunds/transfers ✅
- [x] Shift / cash-drawer sessions — opening float, drops & payouts, live X-report, counted-close with variance and printable Z-report ✅
- [x] Time clock — clock in/out widget, 30-day hours report ✅
- [x] Granular permissions — capability keys (products/inventory/refunds/discounts/reports/giftcards) layered over role baselines, editable per staff member ✅
- [x] PIN-based staff switching at the register (fast cashier handover) ✅
- [x] 2FA for owners (TOTP, dependency-free implementation) ✅
- [x] Audit-log viewer — admin/user action journal with filters ✅

## 7. Reporting & Data
- [x] X-report (mid-shift) and Z-report (close-out) — shipped with drawer sessions ✅
- [x] Tax reports by rate — net tax due per period, grouped by rate so extra jurisdictions slot in later ✅
- [x] Product profitability report — net-of-refund revenue vs stored cost, margin %, CSV export ✅
- [x] CSV / PDF export — CSV on orders, profitability, timeclock, audit; PDF via print-optimised report/receipt views ✅
- [x] Scheduled email digests — daily builder + 06:00 scheduler + owner delivery; sender is a dry-run stub until `SMTP_URL`/`MAIL_FROM` are configured ✅
- [x] Dashboard date-range picker (today / 7d / 30d) with automatic comparison against the prior equal-length period ✅

## 8. Integrations & Platform
- [ ] E-commerce sync (Shopify / WooCommerce) — *channel adapter stub exists (`lib/channels.js`); needs store credentials*
- [x] Accounting export — flat daily journal rows (sales/discounts/tips/tax/refunds) for any import format ✅
- [x] Webhooks + public API keys per tenant — HMAC-SHA256 signed `order.created` deliveries with outcome log; scoped read-only keys ✅
- [ ] Tenant billing — Stripe subscriptions — *plans + adapter stub exist (`lib/channels.js`); needs STRIPE_BILLING_KEY*
- [x] Super-admin console (lite) — `/api/platform/tenants` cross-tenant stats gated by `PLATFORM_ADMIN_KEY` ✅

## 9. Security & Ops Hardening
- [x] httpOnly-cookie refresh sessions with single-use rotation (access token lives in memory only; silent restore on boot) ✅
- [x] Global API rate limiting — 600 req/min/IP across the API on top of strict auth buckets ✅
- [x] Automated backups — `scripts/db-backup.ps1|sh` rolling dumps (schedule via Task Scheduler/cron); PITR via Postgres WAL archiving documented in README ✅
- [x] Structured JSON logging + Sentry capture (`SENTRY_DSN`) without extra dependencies ✅
- [x] CI — GitHub Actions: ephemeral Postgres → migrations → seed → node:test API suite + SPA build (Playwright slot ready) ✅

---

## Suggested build order (highest leverage first)

1. **Offline sale queue** — a POS must survive Wi-Fi blips; idempotency already in place
2. **Split tender** — common real-world checkout need
3. **Shift sessions + Z-reports** — required for serious retail operation
4. **Purchase orders & receiving** — closes the inventory loop
5. **Loyalty & promotions** — drives tenant retention/revenue
