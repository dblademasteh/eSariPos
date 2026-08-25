-- 012: Register behavior settings

ALTER TABLE tenants ADD COLUMN auto_print_receipt BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN open_drawer_on_cash BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN allow_negative_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN max_discount_pct INT NOT NULL DEFAULT 100;
ALTER TABLE tenants ADD COLUMN require_customer BOOLEAN NOT NULL DEFAULT false;
