import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function BillingPage() {
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: () => api.billing.plans() });
  const { data: credits } = useQuery({ queryKey: ['credits'], queryFn: () => api.billing.credits() });

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Billing</h1><p className="page-sub">Credits and plan</p></div>
      <div className="card" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><div style={{ fontSize: 13, color: 'var(--text-3)' }}>Credits remaining</div><div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{credits?.credits ?? '—'}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>of {credits?.creditsMax ?? '—'}</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {(plans || []).map((p: any) => (
          <div key={p.id} className="card" style={{ textAlign: 'center', border: p.id === 'pro' ? '2px solid var(--accent)' : undefined }}>
            {p.id === 'pro' && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Most popular</div>}
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>{p.priceMonthly === 0 ? 'Free' : `$${(p.priceMonthly/100).toFixed(0)}/mo`}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>{p.credits} credits/month</div>
            <ul style={{ listStyle: 'none', fontSize: 12, color: 'var(--text-2)', textAlign: 'left', marginBottom: 16 }}>{p.features.map((f: string) => <li key={f} style={{ padding: '3px 0' }}>✓ {f}</li>)}</ul>
            <button className={`btn btn-full ${p.id === 'pro' ? 'btn-primary' : 'btn-ghost'}`}>{p.priceMonthly === 0 ? 'Current plan' : 'Upgrade'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
