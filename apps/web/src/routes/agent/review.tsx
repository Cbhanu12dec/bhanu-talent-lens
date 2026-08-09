import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

type ReviewTab = 'resume' | 'changes' | 'matches' | 'flags';

export default function AgentReview() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ReviewTab>('resume');
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.agentRuns.get(runId!) });
  const resumeId = run?.resumeId;
  const { data: resume } = useQuery({ queryKey: ['resume', resumeId], queryFn: () => api.resumes.get(resumeId!), enabled: !!resumeId });
  const currentVersionId = resume?.currentVersionId;
  const { data: version } = useQuery({ queryKey: ['version', currentVersionId], queryFn: () => api.resumes.getVersion(resumeId!, currentVersionId!), enabled: !!currentVersionId });
  const { data: changes } = useQuery({ queryKey: ['changes', currentVersionId], queryFn: () => api.resumes.changes(currentVersionId!), enabled: !!currentVersionId && tab === 'changes' });
  const { data: matches } = useQuery({ queryKey: ['matches', currentVersionId], queryFn: () => api.resumes.requirementMatches(currentVersionId!), enabled: !!currentVersionId && tab === 'matches' });
  const { data: flags } = useQuery({ queryKey: ['flags', currentVersionId], queryFn: () => api.resumes.qualityFlags(currentVersionId!), enabled: !!currentVersionId && tab === 'flags' });

  const updateChange = useMutation({ mutationFn: ({ id, status }: any) => api.resumes.updateChange(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['changes', currentVersionId] }) });
  const acceptAll = useMutation({ mutationFn: () => api.resumes.acceptAll(currentVersionId!), onSuccess: () => qc.invalidateQueries({ queryKey: ['changes', currentVersionId] }) });
  const verifyFlag = useMutation({ mutationFn: (id: string) => api.resumes.verifyFlag(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['flags', currentVersionId] }) });

  const content = version?.content as any;
  const score = version?.matchScore;
  const scoreClass = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'poor';
  const scoreTier = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs work';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Review</h1><p className="page-sub">Step 5 of 6 — Review, accept changes, and verify quality</p></div>
        <button className="btn btn-primary" onClick={() => navigate(`/agent/${runId}/export`)}>Export →</button>
      </div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===4?'active':i<4?'done':''}`}><div className="step-num">{i<4?'✓':i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>

      {score != null && (
        <div className="score-card" style={{ marginBottom: 20 }}>
          <div className={`score-num ${scoreClass}`}>{score}</div>
          <div className="score-body">
            <div className="score-label">ATS Match Score</div>
            <div className={`score-tier ${scoreClass}`}>{scoreTier}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {(['resume','changes','matches','flags'] as ReviewTab[]).map(t => (
          <button key={t} className={`nav-item${tab===t?' active':''}`} style={{ borderRadius: 0, borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1, color: tab===t ? 'var(--accent)' : 'var(--text-3)' }} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
            {t==='flags'&&(flags?.filter((f:any)=>f.status==='NEEDS_REVIEW').length??0)>0&&<span className="nav-badge" style={{ marginLeft: 6 }}>{flags!.filter((f:any)=>f.status==='NEEDS_REVIEW').length}</span>}
          </button>
        ))}
      </div>

      {tab === 'resume' && content && (
        <div className="card" style={{ fontFamily: 'serif', lineHeight: 1.6 }}>
          <h2 style={{ textAlign: 'center', marginBottom: 4 }}>{resume?.title}</h2>
          <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, marginBottom: 16 }}>{content.summary}</p>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em', color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>Skills</div>
          <p style={{ fontSize: 13, marginBottom: 16 }}>{content.skills?.join(', ')}</p>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '.06em', color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>Experience</div>
          {(content.experience || []).map((e: any, i: number) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{e.title}</strong><span style={{ color: 'var(--text-3)', fontSize: 12 }}>{e.dateRange}</span></div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 6 }}>{e.company}{e.location ? ` · ${e.location}` : ''}</div>
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>{(e.bullets || []).map((b: string, j: number) => <li key={j} style={{ marginBottom: 4 }}>{b}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {tab === 'changes' && (
        <div className="section-card">
          <div className="section-card-head"><span className="card-title">Changes ({(changes||[]).length})</span><button className="btn btn-sm" onClick={() => acceptAll.mutate()}>Accept all</button></div>
          <div className="section-card-body" style={{ padding: 0 }}>
            {(changes || []).map((c: any) => (
              <div key={c.id} style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase' }}>{c.section}</div>
                <div className="diff-viewer">
                  <div className="diff-header"><div className="diff-col-label">Before</div><div className="diff-col-label">After</div></div>
                  <div className="diff-rows"><div className="diff-cell diff-removed">{c.beforeText}</div><div className="diff-cell diff-added">{c.afterText}</div></div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, marginBottom: 8 }}>{c.rationale}</div>
                {c.status === 'PENDING' && <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-sm btn-primary" onClick={() => updateChange.mutate({ id: c.id, status: 'ACCEPTED' })}>Accept</button><button className="btn btn-sm btn-ghost" onClick={() => updateChange.mutate({ id: c.id, status: 'REVERTED' })}>Revert</button></div>}
                {c.status !== 'PENDING' && <span className={`badge badge-${c.status==='ACCEPTED'?'green':'gray'}`}>{c.status}</span>}
              </div>
            ))}
            {!changes?.length && <div className="empty-state" style={{ padding: 32 }}><p>No changes to review</p></div>}
          </div>
        </div>
      )}

      {tab === 'matches' && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 14 }}>Requirement Coverage</div>
          {(matches || []).map((m: any) => (
            <div key={m.requirementName} className="req-match-row">
              <div className="req-name">{m.requirementName}<div className="req-importance">{m.importance} · {m.mentions}× mentioned</div></div>
              <span className={`req-strength ${m.evidenceStrength}`}>{m.evidenceStrength}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'flags' && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 14 }}>Truthfulness Flags</div>
          {(flags || []).map((f: any) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div><div>{f.claimText}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.sourceRef || 'No source reference'}</div></div>
              {f.status === 'NEEDS_REVIEW' ? <button className="btn btn-sm btn-primary" onClick={() => verifyFlag.mutate(f.id)}>Verify</button> : <span className="badge badge-green">Verified</span>}
            </div>
          ))}
          {!flags?.length && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No flags — all claims are traceable to your profile</div>}
        </div>
      )}
    </div>
  );
}
