// External-channel adapters. Like the PSP stub, real credentials activate
// behaviour; until then these are documented no-ops so the call sites and
// data flow exist end-to-end.

export function shopifyConfigured() {
  return Boolean(process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ACCESS_TOKEN);
}

export async function pushOrderToChannels(order) {
  if (!shopifyConfigured()) return { pushed: false, reason: 'not configured' };
  // Real integration would upsert into Shopify/WooCommerce via their REST APIs.
  return { pushed: false, reason: 'pending integration' };
}

export function billingConfigured() {
  return Boolean(process.env.STRIPE_BILLING_KEY);
}

// Tenant billing (Stripe subscriptions). Plans gate tenant limits once live.
export const BILLING_PLANS = [
  { key: 'starter', priceMonthly: 29, limits: { staff: 3, locations: 1 } },
  { key: 'growth', priceMonthly: 79, limits: { staff: 15, locations: 5 } },
  { key: 'scale', priceMonthly: 199, limits: { staff: 999, locations: 999 } },
];

export async function createBillingCheckout(tenantSlug, planKey) {
  if (!billingConfigured()) {
    return { ok: false, error: 'Billing is not configured on this deployment (missing STRIPE_BILLING_KEY)' };
  }
  void tenantSlug;
  void planKey;
  return { ok: false, error: 'Stripe billing pending integration' };
}
