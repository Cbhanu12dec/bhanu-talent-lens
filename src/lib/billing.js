import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const ensureAccountFn = httpsCallable(functions, 'ensureAccount');
const createCheckoutSessionFn = httpsCallable(functions, 'createCheckoutSession');
const getBillingSettingsFn = httpsCallable(functions, 'getBillingSettingsPublic');

export async function ensureAccount() {
  const res = await ensureAccountFn();
  return res.data; // { ok, role } — role is display-only, never used for auth decisions
}

// What a tailoring actually costs right now. Admin-controlled and read live,
// so the Billing page never states a price the server would not charge.
export async function getBillingSettings() {
  const res = await getBillingSettingsFn();
  return res.data; // { tailoringFree, creditCostPerTailor }
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
