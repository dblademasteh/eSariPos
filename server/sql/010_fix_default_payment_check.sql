-- Fix: update tenants default_payment_method CHECK to include PH methods
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_default_payment_method_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_default_payment_method_check
    CHECK (default_payment_method IN (
      'cash','card','card_terminal','mobile','gcash','maya','other'
    ));
