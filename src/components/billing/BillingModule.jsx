import React, { useEffect, useState } from 'react';
import { startCheckout, getBillingSettings } from '../../lib/billing.js';
import { listBillingHistory } from '../../lib/firestore.js';
import CouponInput from '../CouponInput.jsx';
import {
  Section, DetailRow, StatusBadge, Meter, EmptyState, Skeleton, SkeletonRows
} from '../ui/Primitives.jsx';

// Mirrors PACKS in functions/index.js. The server re-derives price and credit
// count from packId, so these values are display only and can never be used
// to charge a different amount than the server intends.
export const PACKS = [
  {
    id: 'pack_100', count: 100, price: '$9.00', amountCents: 900, tag: null,
    feats: ['100 resume tailorings', 'Never expires', 'Unlimited PDF & DOCX exports']
  },
  {
    id: 'pack_250', count: 250, price: '$19.99', amountCents: 1999, tag: 'Best value',
    feats: ['250 resume tailorings', 'Never expires', 'Lowest cost per credit']
  },
  {
    id: 'pack_500', count: 500, price: '$39.99', amountCents: 3999, tag: null,
    feats: ['500 resume tailorings', 'Never expires', 'Best for heavy job searches']
  }
];

const money = (cents, currency) => cents == null
  ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100);

const dateOf = ts => {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDate = ts => {
  const d = dateOf(ts);
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
};
const shortRef = id => (id ? `#${String(id).slice(-8).toUpperCase()}` : '—');

/* -------------------------------------------------------------- balance */

export function CreditBalanceCard({ credits, creditsTotal, onBuy, onRefresh, refreshing, loading }) {
  const used = creditsTotal != null && credits != null ? Math.max(creditsTotal - credits, 0) : null;
  const low = credits != null && credits <= 5;

  return (
    <Section className="sec--balance">
      {loading ? (
        <div className="bal">
          <div className="bal-main">
            <Skeleton w={110} h={12} />
            <div style={{ margin: '10px 0 14px' }}><Skeleton w={190} h={34} /></div>
            <Skeleton w={280} h={6} />
          </div>
        </div>
      ) : (
        <div className="bal">
          <div className="bal-main">
            <div className="bal-label">Credit balance</div>
            <div className="bal-figure">
              <span className="bal-num">{credits ?? '—'}</span>
              <span className="bal-unit">
                credits remaining{creditsTotal != null ? ` of ${creditsTotal} ever added` : ''}
              </span>
            </div>
            <div className="bal-meter">
              <Meter value={credits ?? 0} max={creditsTotal || 1} thresholds={[1.01, 1.02]} />
            </div>
            <div className="bal-note">
              {low
                ? <StatusBadge tone="warn">Low balance</StatusBadge>
                : <StatusBadge tone="ok">Active</StatusBadge>}
              <span style={{ marginLeft: 9 }}>
                {used != null ? `${used} used so far. ` : ''}Credits never expire.
              </span>
            </div>
          </div>
          <div className="bal-actions">
            <button className="btn btn-primary" onClick={onBuy}>Buy credits</button>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh balance'}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- usage */

export function CreditUsage({ credits, creditsTotal, resumeCount, settings }) {
  const used = creditsTotal != null && credits != null ? Math.max(creditsTotal - credits, 0) : 0;
  const cost = settings?.tailoringFree ? 0 : (settings?.creditCostPerTailor ?? 1);

  return (
    <Section
      title="Usage"
      description="Credits are deducted only when a tailoring run completes. Nothing resets on a schedule and unused credits roll over indefinitely."
    >
      <div className="usage-row">
        <span className="usage-ico" aria-hidden="true">✦</span>
        <div className="usage-text">
          <div className="usage-name">Credits consumed</div>
          <div className="usage-sub">Across the lifetime of this account</div>
        </div>
        <div className="usage-meter">
          <Meter value={used} max={creditsTotal || 1} />
        </div>
        <div className="usage-val">{used} / {creditsTotal ?? '—'}</div>
      </div>

      <div className="usage-row">
        <span className="usage-ico" aria-hidden="true">◎</span>
        <div className="usage-text">
          <div className="usage-name">Resume tailoring</div>
          <div className="usage-sub">
            {cost === 0
              ? 'Currently free — promotional pricing is active'
              : `${cost} credit${cost === 1 ? '' : 's'} per completed run`}
          </div>
        </div>
        <div className="usage-val">{cost === 0 ? 'Free' : `${cost} cr`}</div>
      </div>

      <div className="usage-row">
        <span className="usage-ico" aria-hidden="true">▤</span>
        <div className="usage-text">
          <div className="usage-name">Resumes stored</div>
          <div className="usage-sub">Storage, exports and career profiles cost nothing</div>
        </div>
        <div className="usage-val">{resumeCount ?? 0}</div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- packs */

export function CreditPacks({ onBuy, busyPack, coupons, onCoupon }) {
  return (
    <Section
      title="Buy credits"
      description="One-time purchases. There is no subscription and no recurring charge."
    >
      <div className="packs">
        {PACKS.map(pack => {
          const applied = coupons?.[pack.id];
          return (
            <div className={`pack2${pack.tag ? ' pack2--best' : ''}`} key={pack.id}>
              {pack.tag && <span className="pack2-tag">{pack.tag}</span>}
              <div className="pack2-count">{pack.count} credits</div>
              <div className="pack2-price">
                {applied ? money(applied.discountedAmountCents) : pack.price}
                {applied && <s style={{ color: 'var(--ink-3)', marginLeft: 7, fontWeight: 400 }}>{pack.price}</s>}
              </div>
              <div className="pack2-per">
                ${(pack.amountCents / pack.count / 100).toFixed(2)} per credit
              </div>
              <ul className="pack2-feats">
                {pack.feats.map(f => <li key={f}>{f}</li>)}
              </ul>
              <button
                className={`btn btn-full ${pack.tag ? 'btn-primary' : 'btn-secondary'}`}
                disabled={busyPack === pack.id}
                onClick={() => onBuy(pack.id)}
              >
                {busyPack === pack.id ? 'Redirecting…' : `Buy ${pack.count} credits`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="srow" style={{ borderTop: '1px solid var(--border)', marginTop: 18 }}>
        <div className="srow-text">
          <div className="srow-title">Promo code</div>
          <div className="srow-desc">Discounts are re-validated by the server before any charge is made.</div>
        </div>
        <div className="srow-control">
          <CouponInput
            packId={PACKS[1].id}
            originalCents={PACKS[1].amountCents}
            onApplied={c => onCoupon(PACKS[1].id, c)}
          />
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- payment method */

export function PaymentMethodCard() {
  return (
    <Section title="Payment method">
      <EmptyState
        compact
        icon="▤"
        title="No stored payment method"
        body="Card details are collected by Stripe at checkout and are never sent to or stored on ResumeCraft Pro servers, so there is nothing to manage here."
      />
    </Section>
  );
}

/* ------------------------------------------------------ billing contact */

export function BillingContact({ profileInfo, email, onEdit }) {
  return (
    <Section
      title="Billing contact"
      description="Used on Stripe receipts for your purchases."
      action={<button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>}
    >
      <DetailRow label="Name" value={profileInfo?.name} />
      <DetailRow label="Email" value={email} />
      <DetailRow label="Country" value="Collected by Stripe at checkout" />
    </Section>
  );
}

/* -------------------------------------------------------------- history */

const PAGE = 5;

export function PurchaseHistory({ history, loading }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? history : history.slice(0, PAGE);

  return (
    <Section
      title="Purchase history"
      description="Every completed credit purchase on this account."
      className="sec--flush"
      action={history.length > PAGE && !showAll
        ? <button className="btn btn-secondary btn-sm" onClick={() => setShowAll(true)}>View all</button>
        : null}
    >
      {loading ? (
        <div style={{ padding: 'var(--sec-pad)' }}><SkeletonRows rows={3} /></div>
      ) : history.length === 0 ? (
        <EmptyState
          icon="▤"
          title="No purchases yet"
          body="Your receipts will appear here after your first credit purchase."
        />
      ) : (
        <>
          <div className="itable-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Date</th>
                  <th scope="col">Credits</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Promo</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(h => (
                  <tr key={h.id}>
                    <td className="mono">{shortRef(h.id)}</td>
                    <td>{fmtDate(h.createdAt)}</td>
                    <td className="num">{h.credits}</td>
                    <td className="num">{money(h.amountCents, h.currency)}</td>
                    <td className="mono">{h.couponCode || '—'}</td>
                    <td><StatusBadge status={h.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rows become cards below 860px rather than scrolling sideways. */}
          <div className="icards">
            {rows.map(h => (
              <div className="icard" key={h.id}>
                <div className="icard-top">
                  <span className="icard-amt">{money(h.amountCents, h.currency)}</span>
                  <StatusBadge status={h.status} />
                </div>
                <div className="icard-meta">
                  <span>{h.credits} credits</span>
                  <span>{fmtDate(h.createdAt)}</span>
                  <span className="mono">{shortRef(h.id)}</span>
                  {h.couponCode && <span className="mono">{h.couponCode}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="itable-foot">
            <span className="itable-count">
              Showing {rows.length} of {history.length}
            </span>
            {showAll && history.length > PAGE && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(false)}>Show less</button>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------- support */

export function BillingSupport() {
  return (
    <Section>
      <div className="support-note">
        <p className="support-text">
          <b>Need help with billing?</b>
          Questions about a charge, a missing credit top-up or a refund — we answer billing email first.
        </p>
        <a className="btn btn-secondary btn-sm" href="mailto:support@resumecraftpro.app?subject=Billing%20question">
          Contact support
        </a>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- module */

/**
 * The single billing implementation. Rendered by the Billing page and reused
 * verbatim at /settings/billing so there is one source of truth.
 */
export default function BillingModule({
  uid, email, profileInfo, credits, creditsTotal, resumeCount,
  checkoutStatus, active, onRefresh, onNavigate, notify
}) {
  const [busyPack, setBusyPack] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [coupons, setCoupons] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listBillingHistory(uid);
        if (!cancelled) setHistory(rows);
      } catch (err) {
        console.error(err);
      }
      if (!cancelled) setLoadingHistory(false);
    })();
    return () => { cancelled = true; };
  }, [uid, checkoutStatus, active, credits]);

  useEffect(() => {
    if (!active || settings) return;
    getBillingSettings().then(setSettings).catch(() => setSettings({ creditCostPerTailor: 1 }));
  }, [active, settings]);

  async function handleBuy(packId) {
    setBusyPack(packId);
    try {
      await startCheckout(packId, coupons[packId]?.code); // redirects to Stripe
    } catch (err) {
      console.error(err);
      notify?.({ kind: 'bad', title: 'Could not start checkout', detail: 'Please try again in a moment.' });
      setBusyPack(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh?.();
      setHistory(await listBillingHistory(uid));
      notify?.({ kind: 'ok', title: 'Balance refreshed' });
    } catch (err) {
      console.error(err);
      notify?.({ kind: 'bad', title: 'Could not refresh balance' });
    }
    setRefreshing(false);
  }

  function scrollToPacks() {
    document.getElementById('credit-packs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <CreditBalanceCard
        credits={credits} creditsTotal={creditsTotal}
        onBuy={scrollToPacks} onRefresh={handleRefresh}
        refreshing={refreshing} loading={credits == null}
      />
      <CreditUsage
        credits={credits} creditsTotal={creditsTotal}
        resumeCount={resumeCount} settings={settings}
      />
      <div id="credit-packs">
        <CreditPacks
          onBuy={handleBuy} busyPack={busyPack} coupons={coupons}
          onCoupon={(packId, c) => setCoupons(prev => ({ ...prev, [packId]: c }))}
        />
      </div>
      <PaymentMethodCard />
      <BillingContact
        profileInfo={profileInfo} email={email}
        onEdit={() => onNavigate?.('settings', 'profile')}
      />
      <PurchaseHistory history={history} loading={loadingHistory} />
      <BillingSupport />
    </>
  );
}
