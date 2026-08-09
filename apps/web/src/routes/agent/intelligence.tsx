import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function AgentIntelligence() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.agentRuns.get(runId!) });
  const { data: findings, isLoading: findingsLoading } = useQuery({ queryKey: ['findings', runId], queryFn: () => api.agentRuns.findings(runId!), enabled: run?.currentStep !== 'SETUP' });
  const analyze = useMutation({ mutationFn: () => api.agentRuns.analyze(runId!), onSuccess: () => {} });

  useEffect(() => { if (run?.currentStep === 'SETUP') analyze.mutate(); }, [run?.currentStep]);

  const loading = analyze.isPending || findingsLoading || run?.currentStep === 'SETUP';

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Intelligence</h1><p className="page-sub">Step 2 of 6 — Analyzing your profile against the JD</p></div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===1?'active':i<1?'done':''}`}><div className="step-num">{i<1?'✓':i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>
      {loading ? (
        <div className="card"><div className="loading-row"><div className="spinner"/><span>Analyzing job description and mapping your experience…</span></div></div>
      ) : findings && (
        <div className="agent-layout">
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header"><div className="card-title">Role Match</div><span className={`badge badge-${findings.roleMatch === 'Strong' ? 'green' : findings.roleMatch === 'Good' ? 'violet' : 'amber'}`}>{findings.roleMatch}</span></div>
              {findings.strongestEvidence?.length > 0 && (<><div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Strongest evidence</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{findings.strongestEvidence.map((e: string) => <span key={e} className="badge badge-green">{e}</span>)}</div></>)}
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title">Requirement Gaps</div></div>
              {(findings.gaps || []).map((g: any) => (
                <div key={g.requirement} className="req-match-row">
                  <div className="req-name">{g.requirement}</div>
                  <span className={`req-strength ${g.strength}`}>{g.strength}</span>
                  {g.promptUser && <button className="btn btn-sm">Add experience</button>}
                </div>
              ))}
              {!findings.gaps?.length && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No critical gaps found</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 14 }}>Agent Findings</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 16 }}>The agent has mapped your profile evidence against every JD requirement. Review the gaps above, then advance to strategy.</p>
            <button className="btn btn-primary btn-full" onClick={() => navigate(`/agent/${runId}/strategy`)}>Continue to Strategy →</button>
          </div>
        </div>
      )}
    </div>
  );
}
