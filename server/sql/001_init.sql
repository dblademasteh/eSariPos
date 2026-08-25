CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app LOGIN PASSWORD 'pos_app';
  END IF;
END $$;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 99.99),
  address text,
  phone text,
  receipt_footer text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner','manager','cashier')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#0d9488',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  sku text,
  barcode text,
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '📦',
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX products_tenant_sku_idx ON products (tenant_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no bigint NOT NULL DEFAULT nextval('order_number_seq'),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded')),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  amount_paid numeric(12,2),
  change_due numeric(12,2),
  note text,
  idempotency_key text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  line_total numeric(12,2) NOT NULL
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash','card','mobile','other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('initial','sale','refund','restock','adjustment')),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_tenant_active_idx ON products (tenant_id, is_active);
CREATE INDEX products_tenant_cat_idx ON products (tenant_id, category_id);
CREATE INDEX orders_tenant_created_idx ON orders (tenant_id, created_at DESC);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX movements_product_idx ON stock_movements (product_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  EXECUTE 'ALTER TABLE tenants ENABLE ROW LEVEL SECURITY';
  EXECUTE $policy$
    CREATE POLICY tenant_isolation ON tenants
    USING (id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (id = current_setting('app.tenant_id', true)::uuid)
  $policy$;
  FOREACH t IN ARRAY ARRAY[
    'users','categories','products','customers',
    'orders','order_items','payments','stock_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
       WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_app;
