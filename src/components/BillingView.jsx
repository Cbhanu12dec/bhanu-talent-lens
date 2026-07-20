import React, { useEffect, useState } from 'react';
import { startCheckout } from '../lib/billing.js';
import { listBillingHistory } from '../lib/firestore.js';

const PACKS = [
  { id: 'pack_50', count: 50, price: '$9.00', tag: null },
  { id: 'pack_200', count: 200, price: '$29.00', tag: 'Best value' },
  { id: 'pack_500', count: 500, price: '$59.00', tag: null }
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

export default function BillingView({ uid, credits, creditsTotal, checkoutStatus }) {
  const [busyPack, setBusyPack] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setHistory(await listBillingHistory(uid));
      } catch (err) {
        console.error(err);
      }
      setLoadingHistory(false);
    })();
  }, [uid, checkoutStatus]);

  async function handleBuy(packId) {
    setBusyPack(packId); setError(null);
    try {
      await startCheckout(packId); // redirects the browser to Stripe
    } catch (err) {
      console.error(err);
      setError('Could not start checkout. Please try again.');
      setBusyPack(null);
    }
  }

  return (
    <section>
      <h1 className="page-title">Billing and credits</h1>
      <p className="page-sub">Your credit balance, purchase history, and how to add more.</p>

      {checkoutStatus === 'success' && (
        <div className="success-box">
          Payment received — crediting your account now. This can take a few seconds; your balance
          below will update automatically once Stripe confirms the payment.
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
      </div>

      <div className="panel-head" style={{ marginTop: 32 }}><h2>Buy more credits</h2></div>
      <div className="pack-grid">
        {PACKS.map(pack => (
          <div className={`pack-card ${pack.tag ? 'popular' : ''}`} key={pack.id}>
            {pack.tag && <div className="pack-tag">{pack.tag}</div>}
            <div className="pack-count">{pack.count}</div>
            <div className="pack-price">{pack.price} one-time</div>
            <button className={`btn btn-full ${pack.tag ? 'btn-primary' : ''}`} disabled={busyPack === pack.id} onClick={() => handleBuy(pack.id)}>
              {busyPack === pack.id ? 'Redirecting…' : 'Buy'}
            </button>
          </div>
        ))}
      </div>
      <div className="demo-note">
        Checkout is handled entirely by Stripe — your card details never touch TalentLens
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
          <table className="contact-table">
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id}>
                  <td>{formatDate(h.createdAt)}</td>
                  <td>{h.credits} credits</td>
                  <td>{formatMoney(h.amountCents, h.currency)}</td>
                  <td><span className="chip match" style={{ textTransform: 'capitalize' }}>{h.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
