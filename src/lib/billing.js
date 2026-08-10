import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const ensureAccountFn = httpsCallable(functions, 'ensureAccount');
const createCheckoutSessionFn = httpsCallable(functions, 'createCheckoutSession');

export async function ensureAccount() {
  const res = await ensureAccountFn();
  return res.data; // { ok, role } — role is display-only, never used for auth decisions
}

// Redirects the browser to Stripe Checkout. couponCode is optional — if
// provided, it's re-validated server-side inside createCheckoutSession
// (never trust a client-side discount calculation for the actual charge).
export async function startCheckout(packId, couponCode) {
  const origin = window.location.origin;
  const res = await createCheckoutSessionFn({
    packId,
    couponCode: couponCode || undefined,
    successUrl: `${origin}/?checkout=success`,
    cancelUrl: `${origin}/?checkout=cancel`
  });
  window.location.href = res.data.url;
}
