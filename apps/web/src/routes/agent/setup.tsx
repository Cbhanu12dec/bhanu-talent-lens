import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function AgentSetup() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [jdText, setJdText] = useState('');
  const [profileId, setProfileId] = useState('');
  const [domainId, setDomainId] = useState('');
  const [step, setStep] = useState<'select'|'jd'>('select');

  const { data: profiles } = useQuery({ queryKey: ['career-profiles'], queryFn: () => api.careerProfiles.list() });
  const { data: domains } = useQuery({ queryKey: ['domains'], queryFn: () => api.domains.list() });

  const createJd = useMutation({ mutationFn: (rawText: string) => api.jobDescriptions.create({ rawText }) });
  const createRun = useMutation({ mutationFn: (body: any) => api.agentRuns.create(body) });

  const canAdvance = profileId && domainId;

  async function handleStart() {
    if (!canAdvance || !jdText.trim()) return;
    const jd = await createJd.mutateAsync(jdText);
    const run = await createRun.mutateAsync({ careerProfileId: profileId, domainId, jobDescriptionId: jd.id });
    navigate(`/agent/${run.id}/intelligence`);
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">New Agent Run</h1><p className="page-sub">Step 1 of 6 — Select your inputs</p></div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===0?'active':''}`}><div className="step-num">{i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>
      <div style={{ maxWidth: 600 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div className="card-title">Career Profile</div></div>
          <div className="form-group"><label className="form-label">Select profile</label>
            <select value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">— Choose a profile —</option>
              {(profiles || []).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.experienceCount} roles)</option>)}
            </select>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div className="card-title">Target Domain</div></div>
          <div className="form-group"><label className="form-label">Select domain</label>
            <select value={domainId} onChange={e => setDomainId(e.target.value)}>
              <option value="">— Choose a domain —</option>
              {(domains || []).map((d: any) => <option key={d.id} value={d.id}>{d.name} — {d.summary}</option>)}
            </select>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">Job Description</div></div>
          <div className="form-group"><label className="form-label">Paste the full JD</label>
            <textarea rows={10} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the complete job description here…" />
          </div>
        </div>
        <div className="toolbar toolbar-left">
          <button className="btn btn-primary" disabled={!canAdvance || !jdText.trim() || createRun.isPending} onClick={handleStart}>
            {createRun.isPending ? 'Starting…' : 'Analyze & continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
