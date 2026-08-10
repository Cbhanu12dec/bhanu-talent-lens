import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const validateCoupon = httpsCallable(functions, 'validateCoupon');

// Usage in BillingView.jsx:
//   <CouponInput packId={pack.id} originalCents={pack.amountCents} onApplied={setAppliedCoupon} />
// Then pass appliedCoupon?.code as `couponCode` into startCheckout(packId, couponCode).
export default function CouponInput({ packId, originalCents, onApplied }) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { valid, reason?, discountedAmountCents? }

  async function handleApply() {
    if (!code.trim()) return;
    setChecking(true);
    try {
      const res = await validateCoupon({ code, packId });
      setResult(res.data);
      onApplied?.(res.data.valid ? { code: res.data.code, discountedAmountCents: res.data.discountedAmountCents } : null);
    } catch (err) {
      console.error(err);
      setResult({ valid: false, reason: 'Could not check this code right now.' });
      onApplied?.(null);
    }
    setChecking(false);
  }

  function clear() {
    setCode(''); setResult(null); onApplied?.(null);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row-2" style={{ gridTemplateColumns: '1fr auto' }}>
        <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="Coupon code" disabled={result?.valid} />
        {result?.valid ? (
          <button className="btn btn-sm btn-ghost" onClick={clear}>Remove</button>
        ) : (
          <button className="btn btn-sm btn-ghost" disabled={checking || !code.trim()} onClick={handleApply}>
            {checking ? 'Checking…' : 'Apply'}
          </button>
        )}
      </div>
      {result && !result.valid && <div className="error-box" style={{ marginTop: 8 }}>{result.reason}</div>}
      {result?.valid && (
        <div className="success-box" style={{ marginTop: 8 }}>
          Applied — ${(originalCents / 100).toFixed(2)} → <strong>${(result.discountedAmountCents / 100).toFixed(2)}</strong>
        </div>
      )}
    </div>
  );
}
