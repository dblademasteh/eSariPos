ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS surcharge_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (surcharge_pct >= 0 AND surcharge_pct <= 99.99),
  ADD COLUMN IF NOT EXISTS cash_rounding text NOT NULL DEFAULT 'none'
    CHECK (cash_rounding IN ('none','step5','step10','step100'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tip numeric(12,2) NOT NULL DEFAULT 0 CHECK (tip >= 0),
  ADD COLUMN IF NOT EXISTS surcharge numeric(12,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  ADD COLUMN IF NOT EXISTS rounding_adjustment numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_total >= 0);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS refunded_qty int NOT NULL DEFAULT 0
    CHECK (refunded_qty >= 0);

-- Widen enums that previously only allowed completed/refunded, cash/card/mobile/other.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('completed','refunded','partially_refunded','layaway','cancelled'));

ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','card','card_terminal','mobile','gift_card','other'));

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('initial','sale','refund','restock','adjustment','cancel'));

CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE gift_card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  delta numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gift_cards_tenant_code_idx ON gift_cards (tenant_id, code);
CREATE INDEX gift_card_tx_card_idx ON gift_card_transactions (card_id, created_at DESC);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  restocked boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refunds_order_idx ON refunds (order_id);
CREATE INDEX refunds_tenant_created_idx ON refunds (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gift_cards','gift_card_transactions','refunds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
       WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
