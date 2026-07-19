import React, { useState } from 'react';
import { addCredits } from '../lib/firestore.js';

const PACKS = [
  { count: 10, tag: null },
  { count: 50, tag: 'Most popular' },
  { count: 200, tag: null }
];

export default function BillingView({ uid, credits, creditsTotal, onCreditsChange, notify }) {
  const [busyPack, setBusyPack] = useState(null);

  async function handleAdd(n) {
    setBusyPack(n);
    try {
      const result = await addCredits(uid, n);
      onCreditsChange(result.credits, result.creditsTotal);
      notify?.({ kind: 'good', title: `+${n} credits added`, detail: 'Just now' });
    } catch (err) {
      console.error(err);
    }
    setBusyPack(null);
  }

  return (
    <section>
      <h1 className="page-title">Billing and credits</h1>
      <p className="page-sub">Your credit balance and how to add more.</p>

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

      <div className="panel-head" style={{ marginTop: 32 }}><h2>Add credits</h2></div>
      <div className="pack-grid">
        {PACKS.map(pack => (
          <div className={`pack-card ${pack.tag ? 'popular' : ''}`} key={pack.count}>
            {pack.tag && <div className="pack-tag">{pack.tag}</div>}
            <div className="pack-count">{pack.count}</div>
            <div className="pack-price">credits</div>
            <button className={`btn btn-full ${pack.tag ? 'btn-primary' : ''}`} disabled={busyPack === pack.count} onClick={() => handleAdd(pack.count)}>
              {busyPack === pack.count ? 'Adding…' : 'Add'}
            </button>
          </div>
        ))}
      </div>

      <div className="demo-note">
        This is a demo credit system — clicking "Add" grants credits directly, no payment is
        processed. There's no payment gateway wired up yet; connecting real billing (Stripe or
        similar) would replace this panel with an actual checkout and invoice history.
      </div>
    </section>
  );
}
