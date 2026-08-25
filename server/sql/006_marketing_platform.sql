-- ============ §5 Customers & marketing ============
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points int NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  ADD COLUMN IF NOT EXISTS store_credit numeric(12,2) NOT NULL DEFAULT 0 CHECK (store_credit >= 0),
  ADD COLUMN IF NOT EXISTS marketing_optin boolean NOT NULL DEFAULT true;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS loyalty_earn_per_unit int NOT NULL DEFAULT 1 CHECK (loyalty_earn_per_unit >= 0),
  ADD COLUMN IF NOT EXISTS loyalty_point_cents int NOT NULL DEFAULT 1 CHECK (loyalty_point_cents > 0);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS points_redeemed int NOT NULL DEFAULT 0 CHECK (points_redeemed >= 0),
  ADD COLUMN IF NOT EXISTS points_earned int NOT NULL DEFAULT 0 CHECK (points_earned >= 0);

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  percent_off numeric(4,2) NOT NULL CHECK (percent_off > 0 AND percent_off <= 100),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  times_used int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- ============ §8 Platform: API keys & webhooks ============
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{order.created}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  status text NOT NULL,
  response_code int,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);

-- ============ §9 Refresh-token rotation state ============
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS refresh_jti text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coupons','api_keys','webhooks','webhook_deliveries'] LOOP
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
