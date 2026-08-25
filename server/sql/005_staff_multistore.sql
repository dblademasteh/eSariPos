-- ============ Staff: granular permissions, PIN, 2FA ============
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions jsonb,
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

-- ============ Orders: which drawer / where ============
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id uuid;

-- ============ Shift / cash-drawer sessions ============
CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  opened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(12,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  counted_cash numeric(12,2),
  expected_cash numeric(12,2),
  variance numeric(12,2),
  closing_note text
);

-- One open drawer per staff member.
CREATE UNIQUE INDEX cash_sessions_open_user_idx ON cash_sessions (tenant_id, opened_by)
  WHERE status = 'open';

CREATE TABLE cash_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('drop','payout')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_events_session_idx ON cash_session_events (session_id, created_at);

-- ============ Time clock ============
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz,
  note text
);

CREATE INDEX shifts_tenant_user_idx ON shifts (tenant_id, user_id, clock_in DESC);

-- One open shift per user.
CREATE UNIQUE INDEX shifts_open_user_idx ON shifts (tenant_id, user_id)
  WHERE clock_out IS NULL;

-- ============ Audit log ============
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_tenant_created_idx ON audit_log (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_sessions','cash_session_events','shifts','audit_log'] LOOP
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
