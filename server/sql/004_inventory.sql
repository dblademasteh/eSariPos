-- ============ Suppliers & purchase orders ============
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','received','cancelled')),
  note text,
  received_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  received_qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0)
);

CREATE INDEX po_tenant_created_idx ON purchase_orders (tenant_id, created_at DESC);
CREATE INDEX po_lines_po_idx ON po_lines (po_id);

-- ============ Cycle counts ============
CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  note text,
  applied_at timestamptz,
  variance_total numeric(12,2),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  system_qty numeric(12,3) NOT NULL,
  counted_qty numeric(12,3),
  UNIQUE (count_id, product_id)
);

CREATE INDEX count_lines_count_idx ON stock_count_lines (count_id);

-- ============ Locations & transfers ============
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Stock held at non-default locations. The default location's stock stays in
-- products.stock so the whole existing pipeline (checkout, counts, low stock)
-- keeps a single source of truth.
CREATE TABLE location_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  UNIQUE (location_id, product_id)
);

-- ============ Recipes / BOM ============
-- If a product has recipe lines it is "composite": selling it deducts its
-- components instead of itself. Components are normal stocked products.
CREATE TABLE recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (product_id, component_id)
);

-- ============ Product extensions: variants & unit-of-measure ============
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_label text,
  ADD COLUMN IF NOT EXISTS sold_by text NOT NULL DEFAULT 'unit' CHECK (sold_by IN ('unit','weight','length')),
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS reorder_qty int NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0);

-- Weighted/length items sell and stock in fractional base units.
ALTER TABLE products ALTER COLUMN stock TYPE numeric(12,3);
ALTER TABLE stock_movements ALTER COLUMN delta TYPE numeric(12,3);
ALTER TABLE order_items ALTER COLUMN quantity TYPE numeric(12,3);
ALTER TABLE order_items ALTER COLUMN refunded_qty TYPE numeric(12,3);

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('initial','sale','refund','restock','adjustment','cancel',
                    'transfer_in','transfer_out','count'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'suppliers','purchase_orders','po_lines',
    'stock_counts','stock_count_lines',
    'locations','location_stock','recipe_lines'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
