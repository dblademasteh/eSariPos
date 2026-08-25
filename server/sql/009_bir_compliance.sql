-- ============ §11 Philippine BIR Compliance ============

-- BIR fields on tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS bir_accreditation_no text,
  ADD COLUMN IF NOT EXISTS machine_serial_no text;

-- SC/PWD discount support on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'regular'
    CHECK (discount_type IN ('regular','senior','pwd','percentage','employee')),
  ADD COLUMN IF NOT EXISTS beneficiary_name text,
  ADD COLUMN IF NOT EXISTS beneficiary_id_number text,
  ADD COLUMN IF NOT EXISTS beneficiary_id_type text
    CHECK (beneficiary_id_type IS NULL OR beneficiary_id_type IN ('senior_id','pwd_id','postal','other'));

-- Philippine payment methods
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check
    CHECK (method IN (
      'cash','card','card_terminal','mobile','gift_card','store_credit','other',
      'gcash','maya','qr_ph','instapay','pesonet'
    ));

-- Update default_payment_method CHECK to include PH methods
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_default_payment_method_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_default_payment_method_check
    CHECK (default_payment_method IN (
      'cash','card','card_terminal','mobile','gcash','maya','other'
    ));
