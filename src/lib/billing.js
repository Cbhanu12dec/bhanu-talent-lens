import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const ensureAccountFn = httpsCallable(functions, 'ensureAccount');
const createCheckoutSessionFn = httpsCallable(functions, 'createCheckoutSession');

export async function ensureAccount() {
  await ensureAccountFn();
}

// Redirects the browser to Stripe Checkout. On success, Stripe redirects
// back to `${origin}/?checkout=success` (webhook grants credits async —
// see BillingView's poll-and-refresh after redirect); on cancel, back to
// `${origin}/?checkout=cancel`.
export async function startCheckout(packId) {
  const origin = window.location.origin;
  const res = await createCheckoutSessionFn({
    packId,
    successUrl: `${origin}/?checkout=success`,
    cancelUrl: `${origin}/?checkout=cancel`
  });
  window.location.href = res.data.url;
}
