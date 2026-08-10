import React, { useState, useEffect } from 'react';
import { listResumes, listDomainsPublic } from '../lib/firestore.js';

export default function InsightsView({ uid }) {
  const [tab, setTab] = useState('overview');
  const [resumes, setResumes] = useState([]);
  const [domains, setDomains] = useState([]);

  useEffect(() => {
    if (!uid) return;
    listResumes(uid).then(setResumes).catch(() => {});
    listDomainsPublic().then(setDomains).catch(() => {});
  }, [uid]);

  const roles = [['Senior Backend Engineer', 94], ['Platform Engineer', 91], ['Technical Program Manager', 88], ['Staff Backend Engineer', 84]];
  const coverage = [['Kubernetes', 'Strong'], ['Distributed Systems', 'Strong'], ['AI Infrastructure', 'Weak'], ['Platform Engineering', 'Strong']];
  const growing = [['Kubernetes', 72], ['Distributed Systems', 68], ['AI Infrastructure', 54], ['Platform Engineering', 51]];
  const missing = ['Capacity Planning', 'AI Infrastructure', 'FinOps', 'Observability Platform'];
  const saturated = ['Team player', 'Results-driven', 'Hard-working'];

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">AI Insights</h1>
        <p className="page-sub">Your career intelligence and keyword trends, in one place.</p>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab${tab === 'keywords' ? ' active' : ''}`} onClick={() => setTab('keywords')}>Keyword Trends</button>
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid-3" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="eyebrow">Resumes Built</div>
              <div style={{ fontSize: 26, fontWeight: 650, marginTop: 6 }}>{resumes.length}</div>
              <div className="card-sub">Across {new Set(resumes.map(r => r.domainId).filter(Boolean)).size || 0} domain{new Set(resumes.map(r => r.domainId)).size === 1 ? '' : 's'}</div>
            </div>
            <div className="card">
              <div className="eyebrow">Strongest Positioning</div>
              <div style={{ fontSize: 15, fontWeight: 650, marginTop: 6 }}>Cloud / Backend Engineering</div>
              <div className="card-sub">Based on your career profile</div>
            </div>
            <div className="card">
              <div className="eyebrow">Domains Available</div>
              <div style={{ fontSize: 26, fontWeight: 650, marginTop: 6 }}>{domains.length}</div>
              <div className="card-sub">Published by your admin</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 16 }}>
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Marketable Roles</div>
              {roles.map(([r, s]) => (
                <div key={r} className="bar-row">
                  <div className="bh"><span>{r}</span><span>{s}%</span></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${s}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 10 }}>Your Coverage</div>
              {coverage.map(([label, lvl]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  {label}
                  <span className={`badge badge-${lvl === 'Strong' ? 'success' : 'warning'}`}>{lvl}</span>
                </div>
              ))}
              <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Resume Opportunities</div>
              <div style={{ fontSize: 12.8, color: 'var(--text-secondary)', lineHeight: 2 }}>
                <div>✦ Add quantified metrics to 3 more bullets</div>
                <div>✦ 2 projects are missing outcomes</div>
                <div>✦ Consider adding Capacity Planning examples</div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'keywords' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 16 }}>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Fastest Growing Requirements</div>
            {growing.map(([k, p]) => (
              <div key={k} className="bar-row">
                <div className="bh"><span>{k}</span><span>{p}%</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${p}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Top Missing Keywords</div>
            <div className="chips">
              {missing.map(k => <span key={k} className="chip" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>{k}</span>)}
            </div>
            <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Saturated Keywords (de-emphasize)</div>
            <div className="chips">
              {saturated.map(k => <span key={k} className="chip">{k}</span>)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
