import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';

export default function DomainBuilderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainSummary, setNewDomainSummary] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newSkillLabel, setNewSkillLabel] = useState('');
  const [newSkillCatId, setNewSkillCatId] = useState('');
  const [newSpText, setNewSpText] = useState('');
  const [newSpCatId, setNewSpCatId] = useState('');

  const { data: domains } = useQuery({ queryKey: ['admin-domains'], queryFn: () => api.domains.adminList() });
  const domain = domains?.find((d: any) => d.id === selectedId);

  const createDomain = useMutation({ mutationFn: () => api.domains.adminCreate({ name: newDomainName, summary: newDomainSummary }), onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ['admin-domains'] }); setSelectedId(d.id); setNewDomainName(''); setNewDomainSummary(''); }});
  const publishDomain = useMutation({ mutationFn: (id: string) => api.domains.adminPublish(id, domain?.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-domains'] })});
  const addCategory = useMutation({ mutationFn: () => api.domains.adminAddCategory(selectedId!, { name: newCatName }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-domains'] }); setNewCatName(''); }});
  const addSkill = useMutation({ mutationFn: () => api.domains.adminAddSkill(newSkillCatId, { label: newSkillLabel }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-domains'] }); setNewSkillLabel(''); }});
  const addSp = useMutation({ mutationFn: () => api.domains.adminAddStrongPoint(newSpCatId, { text: newSpText }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-domains'] }); setNewSpText(''); }});

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Domain Builder</h1><p className="page-sub">Admin only — domains + their hidden skill/strong-point data</p></div>
        <button className="btn btn-ghost" onClick={() => navigate('/admin')}>← Back to Admin</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Domain list */}
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>New domain</div>
            <div className="form-group"><input type="text" placeholder="Name" value={newDomainName} onChange={e=>setNewDomainName(e.target.value)} /></div>
            <div className="form-group"><input type="text" placeholder="Summary" value={newDomainSummary} onChange={e=>setNewDomainSummary(e.target.value)} /></div>
            <button className="btn btn-primary btn-sm btn-full" onClick={() => createDomain.mutate()}>+ Create</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(domains || []).map((d: any) => (
              <div key={d.id} className="card" style={{ cursor: 'pointer', border: selectedId===d.id ? '2px solid var(--accent)' : undefined }} onClick={() => setSelectedId(d.id)}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
                <span className={`badge badge-${d.status==='PUBLISHED'?'green':'gray'}`} style={{ marginTop: 4 }}>{d.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Domain detail */}
        {domain && (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div><div style={{ fontWeight: 700, fontSize: 16 }}>{domain.name}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>{domain.summary}</div></div>
                <button className={`btn btn-sm ${domain.status==='PUBLISHED'?'btn-danger':'btn-primary'}`} onClick={() => publishDomain.mutate(domain.id)}>{domain.status==='PUBLISHED'?'Unpublish':'Publish'}</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" placeholder="New category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)} />
                <button className="btn btn-sm" onClick={() => addCategory.mutate()}>+ Category</button>
              </div>
            </div>

            {(domain.categories || []).map((cat: any) => (
              <div key={cat.id} className="section-card" style={{ marginBottom: 14 }}>
                <div className="section-card-head"><span className="card-title">{cat.name}</span></div>
                <div className="section-card-body">
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6 }}>SKILLS</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {(cat.skills || []).map((s: any) => <span key={s.id} className="tag">{s.label} (w:{s.weight})</span>)}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="text" placeholder="Skill label" value={newSkillCatId===cat.id?newSkillLabel:''} onFocus={() => setNewSkillCatId(cat.id)} onChange={e=>{ setNewSkillCatId(cat.id); setNewSkillLabel(e.target.value); }} />
                      <button className="btn btn-sm" onClick={() => addSkill.mutate()}>+ Skill</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6 }}>STRONG POINTS (style directives)</div>
                    {(cat.strongPoints || []).map((sp: any) => <div key={sp.id} style={{ fontSize: 12, color: 'var(--text-2)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>{sp.text}</div>)}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <input type="text" placeholder="Style directive text" value={newSpCatId===cat.id?newSpText:''} onFocus={() => setNewSpCatId(cat.id)} onChange={e=>{ setNewSpCatId(cat.id); setNewSpText(e.target.value); }} />
                      <button className="btn btn-sm" onClick={() => addSp.mutate()}>+ Point</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!domain && <div className="empty-state"><h3>Select a domain</h3><p>Click a domain on the left to edit its categories, skills, and style directives.</p></div>}
      </div>
    </div>
  );
}
