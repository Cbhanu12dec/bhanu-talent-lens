import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function AgentStrategy() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.agentRuns.get(runId!) });
  const [positioning, setPositioning] = useState('');
  const updateStrategy = useMutation({ mutationFn: (body: any) => api.agentRuns.updateStrategy(runId!, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }) });

  useEffect(() => { if (run?.strategySnapshot?.positioning) setPositioning(run.strategySnapshot.positioning); }, [run]);

  const strategy = run?.strategySnapshot;

  async function handleBuild() {
    await updateStrategy.mutateAsync({ positioning });
    navigate(`/agent/${runId}/build`);
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Strategy</h1><p className="page-sub">Step 3 of 6 — Review and adjust the agent's plan</p></div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===2?'active':i<2?'done':''}`}><div className="step-num">{i<2?'✓':i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>
      {strategy ? (
        <div className="agent-layout">
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Positioning</div>
              <textarea rows={3} value={positioning} onChange={e => setPositioning(e.target.value)} style={{ marginBottom: 0 }} />
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Experience Priority</div>
              {(strategy.experiencePriority || []).map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span>{e.employer}</span>
                  <span className={`badge badge-${e.level==='Very High'?'violet':e.level==='High'?'green':'gray'}`}>{e.level}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>Top Skills to Highlight</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(strategy.skillPriority || []).map((s: string) => <span key={s} className="badge badge-violet">{s}</span>)}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Build targets</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 6 }}>Target length: <strong>{strategy.targets?.resumeLength}</strong></div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>Target match score: <strong>{strategy.targets?.targetMatchScore}%</strong></div>
            <button className="btn btn-primary btn-full" disabled={updateStrategy.isPending} onClick={handleBuild}>Build resume →</button>
          </div>
        </div>
      ) : (
        <div className="loading-row"><div className="spinner"/><span>Loading strategy…</span></div>
      )}
    </div>
  );
}
