-- 011: Additional settings fields for loyalty and inventory tabs

-- Loyalty settings
ALTER TABLE tenants ADD COLUMN loyalty_min_redeem INT NOT NULL DEFAULT 100;
ALTER TABLE tenants ADD COLUMN loyalty_max_redemption_pct NUMERIC(5,2) NOT NULL DEFAULT 100;
ALTER TABLE tenants ADD COLUMN loyalty_expiry_days INT NOT NULL DEFAULT 0;

-- Inventory settings
ALTER TABLE tenants ADD COLUMN inventory_stock_mode TEXT NOT NULL DEFAULT 'track';
ALTER TABLE tenants ADD COLUMN inventory_require_adjustment_note BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN inventory_auto_reorder BOOLEAN NOT NULL DEFAULT false;
