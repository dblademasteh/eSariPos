-- ============ §10 Extended tenant settings ============

-- Business timezone (used for digest, reports, shift times)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- Tax-inclusive pricing: when true, displayed prices include tax
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false;

-- Default opening float for cash drawer (per-business)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_opening_float numeric(12,2) NOT NULL DEFAULT 100.00
    CHECK (default_opening_float >= 0);

-- Low-stock alert email threshold (global default for products)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS low_stock_alert_threshold int NOT NULL DEFAULT 5
    CHECK (low_stock_alert_threshold >= 0);

-- Receipt header text (above business name)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS receipt_header text;

-- Business logo URL (stored as external link or base64 data URI)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS logo_url text;

-- Default payment method shown first in checkout
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_payment_method text NOT NULL DEFAULT 'cash'
    CHECK (default_payment_method IN ('cash','card','card_terminal','mobile','other'));

-- Tip settings
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tips_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tip_suggestions text NOT NULL DEFAULT '10,15,20'
    CHECK (length(tip_suggestions) > 0);

-- Auto-close drawer after N hours of inactivity (0 = disabled)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS auto_close_drawer_hours int NOT NULL DEFAULT 0
    CHECK (auto_close_drawer_hours >= 0 AND auto_close_drawer_hours <= 24);

-- Receipt paper width: 40 or 80 columns
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS receipt_width int NOT NULL DEFAULT 40
    CHECK (receipt_width IN (40, 80));
