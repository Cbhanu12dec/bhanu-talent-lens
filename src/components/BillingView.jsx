import React, { useEffect, useState } from 'react';
import { startCheckout } from '../lib/billing.js';
import { listBillingHistory } from '../lib/firestore.js';
import CouponInput from './CouponInput.jsx';

const PACKS = [
  { id: 'pack_100', count: 100, price: '$9.00', amountCents: 900, tag: null },
  { id: 'pack_250', count: 250, price: '$19.99', amountCents: 1999, tag: 'Best value' },
  { id: 'pack_500', count: 500, price: '$39.99', amountCents: 3999, tag: null }
];

function formatMoney(cents, currency) {
  if (cents === undefined || cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100);
}
function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BillingView({ uid, credits, creditsTotal, checkoutStatus, active, onRefresh }) {
  const [busyPack, setBusyPack] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [appliedCoupons, setAppliedCoupons] = useState({}); // { [packId]: { code, discountedAmountCents } }
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!active) return;
    (async () => {
      try {
        setHistory(await listBillingHistory(uid));
      } catch (err) {
        console.error(err);
      }
      setLoadingHistory(false);
    })();
  }, [uid, checkoutStatus, active, credits]);

  async function handleBuy(packId) {
    setBusyPack(packId); setError(null);
    try {
      await startCheckout(packId, appliedCoupons[packId]?.code); // redirects the browser to Stripe
    } catch (err) {
      console.error(err);
      setError('Could not start checkout. Please try again.');
      setBusyPack(null);
    }
  }

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await onRefresh?.();
      setHistory(await listBillingHistory(uid));
    } catch (err) {
      console.error(err);
    }
    setRefreshing(false);
  }

  return (
    <section>
      <h1 className="page-title">Billing and credits</h1>
      <p className="page-sub">Your credit balance, purchase history, and how to add more.</p>

      {checkoutStatus === 'success' && (
        <div className="success-box">
          Payment received — crediting your account now. This usually takes a few seconds and
          updates automatically. If your balance below hasn't moved after a minute, use
          "Refresh balance" — Stripe's confirmation can occasionally take longer than expected.
        </div>
      )}
      {checkoutStatus === 'cancel' && (
        <div className="error-box">Checkout was canceled — no charge was made.</div>
      )}
      {error && <div className="error-box">{error}</div>}

      <div className="plan-card">
        <div>
          <div className="plan-name">Free plan</div>
          <div className="plan-sub">Each resume tailoring uses 1 credit.</div>
          <div className="credit-big">
            <span className="credit-big-num">{credits ?? '—'}</span>
            <span className="credit-big-label">/ {creditsTotal ?? '—'} credits</span>
          </div>
          <div className="bar-track" style={{ width: 260 }}>
            <div className="bar-fill" style={{ width: `${creditsTotal ? (credits / creditsTotal) * 100 : 0}%` }}></div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={handleManualRefresh}>
          {refreshing ? 'Refreshing…' : '↻ Refresh balance'}
        </button>
      </div>

      <div className="panel-head" style={{ marginTop: 32 }}><h2>Buy more credits</h2></div>
      <div className="pack-grid">
        {PACKS.map(pack => (
          <div className={`pack-card ${pack.tag ? 'popular' : ''}`} key={pack.id}>
            {pack.tag && <div className="pack-tag">{pack.tag}</div>}
            <div className="pack-count">{pack.count}</div>
            <div className="pack-price">{pack.price} one-time</div>
            <div className="pack-per">{(pack.amountCents / pack.count / 100).toFixed(2).replace(/0$/, '')}c per credit</div>
            <button className={`btn btn-full ${pack.tag ? 'btn-primary' : ''}`} disabled={busyPack === pack.id} onClick={() => handleBuy(pack.id)}>
              {busyPack === pack.id ? 'Redirecting…' : 'Buy'}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>Have a promo code?</span>
        <div style={{ marginTop: 6 }}>
          <CouponInput packId={PACKS[0].id} originalCents={PACKS[0].amountCents}
            onApplied={coupon => setAppliedCoupons(prev => ({ ...prev, [PACKS[0].id]: coupon }))} />
        </div>
      </div>
      <div className="demo-note">
        Checkout is handled entirely by Stripe — your card details never touch ResumeCraftPro
        servers. Credits are granted only after Stripe confirms the payment via webhook, not
        immediately on redirect, so the balance above may take a few seconds to update.
      </div>

      <div className="panel-head" style={{ marginTop: 32 }}><h2>Billing history</h2></div>
      <div className="panel">
        {loadingHistory ? (
          <div className="loading"><span className="spinner"></span> Loading…</div>
        ) : history.length === 0 ? (
          <div className="empty">No purchases yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="contact-table">
              <thead><tr><th>Date</th><th>Credits</th><th>Amount</th><th>Coupon</th><th>Status</th></tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td>{formatDate(h.createdAt)}</td>
                    <td>{h.credits} credits</td>
                    <td>{formatMoney(h.amountCents, h.currency)}</td>
                    <td>{h.couponCode ? <span className="chip" style={{ fontFamily: 'var(--mono)' }}>{h.couponCode}</span> : '—'}</td>
                    <td><span className="chip match" style={{ textTransform: 'capitalize' }}>{h.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
