import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function AgentBuild() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const build = useMutation({ mutationFn: () => api.agentRuns.build(runId!) });
  const { data: activity, refetch } = useQuery({ queryKey: ['build-activity', runId], queryFn: () => api.agentRuns.buildActivity(runId!), refetchInterval: 2000 });

  useEffect(() => { build.mutate(); }, []);
  useEffect(() => { if (activity?.status === 'COMPLETED') { setTimeout(() => navigate(`/agent/${runId}/review`), 1000); } }, [activity?.status]);

  const items: any[] = activity?.items || [];
  return (
    <div>
      <div className="page-header"><h1 className="page-title">Building</h1><p className="page-sub">Step 4 of 6 — The agent is writing your resume</p></div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===3?'active':i<3?'done':''}`}><div className="step-num">{i<3?'✓':i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>
      <div style={{ maxWidth: 560 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            {activity?.status !== 'COMPLETED' && <div className="spinner" style={{ width: 18, height: 18 }} />}
            {activity?.status === 'COMPLETED' && <span style={{ color: 'var(--success)', fontSize: 18 }}>✓</span>}
            <div style={{ fontWeight: 600, fontSize: 15 }}>{activity?.status === 'COMPLETED' ? 'Build complete!' : 'Generating your resume…'}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((item: any, i: number) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          {activity?.status === 'COMPLETED' && (
            <div className="toolbar toolbar-left" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => navigate(`/agent/${runId}/review`)}>Review resume →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
