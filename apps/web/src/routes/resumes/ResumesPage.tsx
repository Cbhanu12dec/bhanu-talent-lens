import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

export default function ResumesPage() {
  const { data: resumes, isLoading } = useQuery({ queryKey: ['resumes'], queryFn: () => api.resumes.list() });
  const navigate = useNavigate();

  if (isLoading) return <div className="loading-row"><div className="spinner"/><span>Loading…</span></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Resumes</h1><p className="page-sub">All your tailored resumes</p></div>
        <button className="btn btn-primary" onClick={() => navigate('/career-profile')}>+ New resume</button>
      </div>
      {!resumes?.length && <div className="empty-state"><h3>No resumes yet</h3><p>Start an Agent Run to generate your first AI-tailored resume.</p><button className="btn btn-primary" onClick={() => navigate('/career-profile')}>Start Agent Run →</button></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
        {(resumes || []).map((r: any) => (
          <div key={r.id} className="card" style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="badge badge-violet">{r.domain?.name}</span>
              <span className={`badge badge-${r.status==='ACTIVE'?'green':'gray'}`}>{r.status}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>For {r.jobDescription?.company || 'Unknown company'} · {r.jobDescription?.title || ''}</div>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/agent/${r.id}/review`)}>View & edit →</button>
          </div>
        ))}
      </div>
    </div>
  );
}
