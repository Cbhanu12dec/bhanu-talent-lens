import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function CareerProfilePage() {
  const qc = useQueryClient();
  const { data: profiles, isLoading } = useQuery({ queryKey: ['career-profiles'], queryFn: () => api.careerProfiles.list() });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addExpOpen, setAddExpOpen] = useState(false);
  const [addEduOpen, setAddEduOpen] = useState(false);
  const [expForm, setExpForm] = useState({ title: '', company: '', location: '', startDate: '', endDate: '' });
  const [eduForm, setEduForm] = useState({ school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '' });
  const [skillInput, setSkillInput] = useState('');

  const profile = profiles?.find((p: any) => p.id === activeId) || profiles?.[0];

  const addExp = useMutation({ mutationFn: (body: any) => api.careerProfiles.addExperience(profile!.id, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['career-profiles'] }); setAddExpOpen(false); setExpForm({ title: '', company: '', location: '', startDate: '', endDate: '' }); }});
  const addEdu = useMutation({ mutationFn: (body: any) => api.careerProfiles.addEducation(profile!.id, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['career-profiles'] }); setAddEduOpen(false); }});
  const addSkill = useMutation({ mutationFn: (label: string) => api.careerProfiles.addSkill(profile!.id, { label }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['career-profiles'] }); setSkillInput(''); }});
  const deleteExp = useMutation({ mutationFn: (id: string) => api.careerProfiles.deleteExperience(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['career-profiles'] })});
  const deleteSkill = useMutation({ mutationFn: (id: string) => api.careerProfiles.deleteSkill(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['career-profiles'] })});

  if (isLoading) return <div className="loading-row"><div className="spinner"/><span>Loading…</span></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Career Profile</h1><p className="page-sub">Your ground truth — the agent only uses facts from here</p></div>
      </div>

      {profile && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Experience */}
          <div className="section-card">
            <div className="section-card-head">
              <span className="card-title">Experience</span>
              <button className="btn btn-sm" onClick={() => setAddExpOpen(v => !v)}>+ Add</button>
            </div>
            <div className="section-card-body">
              {addExpOpen && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="input-row" style={{ marginBottom: 8 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Title</label><input type="text" value={expForm.title} onChange={e => setExpForm(p=>({...p,title:e.target.value}))} placeholder="Software Engineer" /></div>
                    <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Company</label><input type="text" value={expForm.company} onChange={e => setExpForm(p=>({...p,company:e.target.value}))} placeholder="Acme Inc." /></div>
                  </div>
                  <div className="input-row" style={{ marginBottom: 8 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Start (YYYY-MM)</label><input type="text" value={expForm.startDate} onChange={e => setExpForm(p=>({...p,startDate:e.target.value}))} placeholder="2022-01" /></div>
                    <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">End (blank = Present)</label><input type="text" value={expForm.endDate} onChange={e => setExpForm(p=>({...p,endDate:e.target.value}))} placeholder="2024-06" /></div>
                  </div>
                  <div className="toolbar toolbar-left"><button className="btn btn-primary btn-sm" onClick={() => addExp.mutate(expForm)}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setAddExpOpen(false)}>Cancel</button></div>
                </div>
              )}
              {(profile.experience || []).map((e: any) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div><div style={{ fontWeight: 600, fontSize: 13 }}>{e.title}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{e.company} · {e.startDate} – {e.endDate || 'Present'}</div></div>
                  <button className="btn btn-sm btn-ghost" onClick={() => deleteExp.mutate(e.id)}>✕</button>
                </div>
              ))}
              {!(profile.experience?.length) && <div className="empty-state" style={{ padding: '20px 0' }}><p>No experience added yet</p></div>}
            </div>
          </div>

          {/* Education + Skills */}
          <div>
            <div className="section-card" style={{ marginBottom: 14 }}>
              <div className="section-card-head"><span className="card-title">Education</span><button className="btn btn-sm" onClick={() => setAddEduOpen(v=>!v)}>+ Add</button></div>
              <div className="section-card-body">
                {addEduOpen && (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <div className="input-row" style={{ marginBottom: 8 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">School</label><input type="text" value={eduForm.school} onChange={e=>setEduForm(p=>({...p,school:e.target.value}))} /></div>
                      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Degree</label><input type="text" value={eduForm.degree} onChange={e=>setEduForm(p=>({...p,degree:e.target.value}))} /></div>
                    </div>
                    <div className="toolbar toolbar-left"><button className="btn btn-primary btn-sm" onClick={() => addEdu.mutate(eduForm)}>Save</button></div>
                  </div>
                )}
                {(profile.education || []).map((e: any) => (
                  <div key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{e.degree}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{e.school} · {e.startDate} – {e.endDate || ''}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="section-card">
              <div className="section-card-head"><span className="card-title">Skills</span></div>
              <div className="section-card-body">
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input type="text" placeholder="Add a skill…" value={skillInput} onChange={e=>setSkillInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&skillInput.trim()) addSkill.mutate(skillInput.trim()); }} style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => skillInput.trim() && addSkill.mutate(skillInput.trim())}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(profile.skills || []).map((s: any) => (
                    <span key={s.id} className="tag" style={{ cursor: 'pointer' }} onClick={() => deleteSkill.mutate(s.id)}>{s.label} ✕</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
