// Card-present processing via Stripe Terminal.
//
// When STRIPE_API_KEY is set and the "stripe" package is installed, a
// PaymentIntent is created and the caller polls until the physical terminal
// captures the payment.  Without credentials every terminal payment fails
// closed so no funds can move without explicit operator action.
import { logger } from './logger.js';

let _stripe = null;
let _checked = false;

async function getStripe() {
  if (_checked) return _stripe;
  _checked = true;
  if (!terminalConfigured()) return null;
  try {
    // Dynamic import — stripe is an optional peer dependency.
    // eslint-disable-next-line no-undef
    const stripeModule = await import('stripe');
    _stripe = stripeModule.default(process.env.STRIPE_API_KEY, {
      apiVersion: '2024-06-20',
    });
    logger.info('[psp] Stripe client ready');
  } catch (err) {
    logger.warn(`[psp] stripe package not installed or key invalid: ${err.message}`);
  }
  return _stripe;
}

export function terminalConfigured() {
  return Boolean(process.env.STRIPE_API_KEY);
}

export async function authorizeTerminal({ amountCents, reference }) {
  const stripe = await getStripe();
  if (!stripe) {
    return {
      ok: false,
      error: 'Card-present processing is not configured on this store (missing STRIPE_API_KEY)',
    };
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'php',
      payment_method_types: ['card_present'],
      metadata: { reference: reference ?? 'pos-sale' },
    });

    logger.info(`[psp] PaymentIntent created: ${intent.id}`);

    // Poll for up to 120 s while the terminal captures the card.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const latest = await stripe.paymentIntents.retrieve(intent.id);
      if (latest.status === 'succeeded') {
        return { ok: true, pspRef: latest.id, amountCents: latest.amount };
      }
      if (latest.status === 'requires_payment_method' || latest.status === 'canceled') {
        return { ok: false, error: `Payment ${latest.status}` };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Timeout — cancel so the amount isn't held.
    await stripe.paymentIntents.cancel(intent.id);
    return { ok: false, error: 'Terminal timed out — payment cancelled' };
  } catch (err) {
    logger.error(`[psp] Stripe error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
