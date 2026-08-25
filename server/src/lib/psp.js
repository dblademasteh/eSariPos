// Card-present processing stub.
//
// A real integration creates a PaymentIntent on Stripe Terminal (or an Adyen
// terminal API call) and returns the PSP reference for the payment row.
// Until STRIPE_API_KEY is configured every terminal payment fails closed.

export function terminalConfigured() {
  return Boolean(process.env.STRIPE_API_KEY);
}

export async function authorizeTerminal({ amountCents, reference }) {
  if (!terminalConfigured()) {
    return {
      ok: false,
      error: 'Card-present processing is not configured on this store (missing STRIPE_API_KEY)',
    };
  }
  return {
    ok: false,
    error: 'Terminal capture is pending integration - record the sale with another method',
  };
}
