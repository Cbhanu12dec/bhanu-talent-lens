import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores';

export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const { data: runs } = useQuery({ queryKey: ['agent-runs'], queryFn: () => api.agentRuns.list() });
  const { data: resumes } = useQuery({ queryKey: ['resumes'], queryFn: () => api.resumes.list() });

  async function startNewRun() {
    navigate('/career-profile');
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Welcome back{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}</h1>
        <p className="page-sub">Your resume intelligence workspace</p>
      </div>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{resumes?.length || 0}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Tailored resumes</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{runs?.length || 0}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Agent runs</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{user?.credits ?? '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Credits remaining</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div><div className="card-title">Start a new Agent run</div><div className="card-sub">AI builds a tailored resume from your career profile</div></div>
          <button className="btn btn-primary" onClick={startNewRun}>+ New run</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
          1. Select your career profile &nbsp;→&nbsp; 2. Choose a target domain &nbsp;→&nbsp; 3. Paste the job description &nbsp;→&nbsp; 4. Let the agent analyze, strategize, and build &nbsp;→&nbsp; 5. Review &amp; export.
        </p>
      </div>

      {runs && runs.length > 0 && (
        <div className="section-card">
          <div className="section-card-head">
            <span className="card-title">Recent agent runs</span>
          </div>
          <div className="section-card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead><tr><th>Role</th><th>Company</th><th>Domain</th><th>Status</th><th>Step</th><th></th></tr></thead>
              <tbody>
                {runs.slice(0, 8).map((run: any) => (
                  <tr key={run.id}>
                    <td>{run.jobDescription?.title || '—'}</td>
                    <td>{run.jobDescription?.company || '—'}</td>
                    <td>{run.domain?.name || '—'}</td>
                    <td><span className={`badge badge-${run.status==='COMPLETED'?'green':run.status==='FAILED'?'red':'violet'}`}>{run.status}</span></td>
                    <td><span className="tag">{run.currentStep}</span></td>
                    <td><button className="btn btn-sm btn-ghost" onClick={() => navigate(`/agent/${run.id}/${run.currentStep.toLowerCase()}`)}>Continue →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
