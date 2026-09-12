import React, { useState, useEffect } from 'react';
import {
  listCareerProfiles, createCareerProfile, renameCareerProfile, deleteCareerProfileDoc, setDefaultCareerProfile,
  addExperience, updateExperience, deleteExperience,
  addEducation, deleteEducation, addSkill, deleteSkill
} from '../lib/firestore.js';

const PROFILE_NAME_IDEAS = ['Full Stack roles', 'Program Manager roles', 'Data / ML roles', 'Early-career roles'];

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Each todo opens the matching editor, so no item is ever dead text (§4).
const CHECKLIST = [
  {
    id: 'exp', label: 'Add your work experience',
    isDone: p => (p?.experience?.length || 0) > 0,
    go: ({ setAddExpOpen }) => { setAddExpOpen(true); scrollTo('cp-experience'); },
  },
  {
    id: 'exp2', label: 'Add a second role for stronger context',
    isDone: p => (p?.experience?.length || 0) > 1,
    go: ({ setAddExpOpen }) => { setAddExpOpen(true); scrollTo('cp-experience'); },
  },
  {
    id: 'edu', label: 'Add your education',
    isDone: p => (p?.education?.length || 0) > 0,
    go: ({ setAddEduOpen }) => { setAddEduOpen(true); scrollTo('cp-education'); },
  },
  {
    id: 'skills', label: 'List at least 3 skills',
    isDone: p => (p?.skills?.length || 0) >= 3,
    go: ({ focusSkills }) => focusSkills(),
  },
];

// Skills are stored as flat labels, so the group is inferred rather than
// migrated — §4 still requires they never render as an unsorted dump.
const SKILL_GROUPS = [
  ['Languages', /^(javascript|typescript|python|java|c\+\+|c#|go|golang|ruby|php|rust|kotlin|swift|scala|sql|r|bash|shell)$/i],
  ['Frontend', /(react|vue|angular|svelte|next\.?js|redux|tailwind|css|html|sass|webpack|vite)/i],
  ['Backend', /(node|express|django|flask|spring|rails|\.net|graphql|rest|api|microservice|kafka|rabbitmq)/i],
  ['Cloud & DevOps', /(aws|azure|gcp|google cloud|kubernetes|k8s|docker|terraform|jenkins|ci\/cd|ansible|helm|cloudformation|devops)/i],
  ['Data', /(postgres|mysql|mongo|redis|dynamo|snowflake|spark|hadoop|airflow|etl|bigquery|elasticsearch|databricks)/i],
  ['AI & ML', /(machine learning|ml|tensorflow|pytorch|llm|nlp|generative|openai|langchain|data science)/i],
  ['Delivery & Leadership', /(agile|scrum|jira|confluence|roadmap|stakeholder|program management|project management|leadership|mentoring)/i],
];

function groupSkills(skills) {
  const groups = new Map();
  const other = [];
  for (const s of skills || []) {
    const match = SKILL_GROUPS.find(([, re]) => re.test(s.label));
    if (match) {
      if (!groups.has(match[0])) groups.set(match[0], []);
      groups.get(match[0]).push(s);
    } else {
      other.push(s);
    }
  }
  const out = SKILL_GROUPS.map(([name]) => [name, groups.get(name)]).filter(([, v]) => v?.length);
  if (other.length) out.push(['Other', other]);
  return out;
}

export default function CareerProfileView({ uid, notify }) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState('main');
  const [loading, setLoading] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [addExpOpen, setAddExpOpen] = useState(false);
  const [addEduOpen, setAddEduOpen] = useState(false);
  const [editingExp, setEditingExp] = useState(null);
  const [skillInput, setSkillInput] = useState('');
  const [saving, setSaving] = useState(false);

  const [expForm, setExpForm] = useState({ title: '', company: '', location: '', startDate: '', endDate: '' });
  const [eduForm, setEduForm] = useState({ school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '' });
  const skillInputRef = React.useRef(null);

  function focusSkills() {
    scrollTo('cp-skills');
    setTimeout(() => skillInputRef.current?.focus(), 320);
  }

  useEffect(() => { load(); }, [uid]);

  async function load(selectId) {
    setLoading(true);
    const list = await listCareerProfiles(uid);
    setProfiles(list);
    const target = selectId || list.find(p => p.isDefault)?.id || list[0]?.id || 'main';
    setActiveId(target);
    setLoading(false);
  }

  const profile = profiles.find(p => p.id === activeId) || { experience: [], education: [], skills: [] };

  function patchActiveProfile(patch) {
    setProfiles(list => list.map(p => p.id === activeId ? { ...p, ...patch } : p));
  }

  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;
    const created = await createCareerProfile(uid, newProfileName.trim());
    setProfiles(list => [...list, created]);
    setActiveId(created.id);
    setNewProfileName(''); setNewProfileOpen(false); setSwitcherOpen(false);
    notify?.({ kind: 'good', title: 'Profile created', detail: created.name });
  }

  async function handleRenameProfile(id) {
    if (!renameValue.trim()) return;
    await renameCareerProfile(uid, id, renameValue.trim());
    setProfiles(list => list.map(p => p.id === id ? { ...p, name: renameValue.trim() } : p));
    setRenamingId(null);
  }

  async function handleDeleteProfile(id) {
    if (profiles.length <= 1) { notify?.({ kind: 'warn', title: "Can't delete your only profile", detail: '' }); return; }
    await deleteCareerProfileDoc(uid, id);
    const remaining = profiles.filter(p => p.id !== id);
    setProfiles(remaining);
    if (activeId === id) setActiveId(remaining.find(p => p.isDefault)?.id || remaining[0].id);
    notify?.({ kind: '', title: 'Profile deleted', detail: '' });
  }

  async function handleSetDefault(id) {
    await setDefaultCareerProfile(uid, id);
    setProfiles(list => list.map(p => ({ ...p, isDefault: p.id === id })));
  }

  async function handleAddExp() {
    if (!expForm.title || !expForm.company || !expForm.startDate) return;
    setSaving(true);
    const item = await addExperience(uid, expForm, activeId);
    patchActiveProfile({ experience: [...(profile.experience || []), item] });
    setExpForm({ title: '', company: '', location: '', startDate: '', endDate: '' });
    setAddExpOpen(false); setSaving(false);
    notify?.({ kind: 'good', title: 'Experience added', detail: `${expForm.title} at ${expForm.company}` });
  }

  async function handleUpdateExp() {
    if (!editingExp) return;
    setSaving(true);
    await updateExperience(uid, editingExp.id, expForm, activeId);
    patchActiveProfile({ experience: (profile.experience || []).map(e => e.id === editingExp.id ? { ...e, ...expForm } : e) });
    setEditingExp(null); setExpForm({ title: '', company: '', location: '', startDate: '', endDate: '' });
    setAddExpOpen(false); setSaving(false);
  }

  async function handleDeleteExp(id) {
    await deleteExperience(uid, id, activeId);
    patchActiveProfile({ experience: (profile.experience || []).filter(e => e.id !== id) });
    notify?.({ kind: '', title: 'Experience removed', detail: '' });
  }

  async function handleAddEdu() {
    if (!eduForm.school || !eduForm.degree) return;
    setSaving(true);
    const item = await addEducation(uid, eduForm, activeId);
    patchActiveProfile({ education: [...(profile.education || []), item] });
    setEduForm({ school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '' });
    setAddEduOpen(false); setSaving(false);
  }

  async function handleDeleteEdu(id) {
    await deleteEducation(uid, id, activeId);
    patchActiveProfile({ education: (profile.education || []).filter(e => e.id !== id) });
  }

  async function handleAddSkill() {
    if (!skillInput.trim()) return;
    const item = await addSkill(uid, skillInput.trim(), activeId);
    patchActiveProfile({ skills: [...(profile.skills || []), item] });
    setSkillInput('');
  }

  async function handleDeleteSkill(id) {
    await deleteSkill(uid, id, activeId);
    patchActiveProfile({ skills: (profile.skills || []).filter(s => s.id !== id) });
  }

  function openEditExp(exp) {
    setEditingExp(exp);
    setExpForm({ title: exp.title, company: exp.company, location: exp.location || '', startDate: exp.startDate, endDate: exp.endDate || '' });
    setAddExpOpen(true);
  }

  const completenessOf = (p) => Math.min(
    (((p?.experience?.length || 0) > 0 ? 40 : 0) +
     ((p?.education?.length || 0) > 0 ? 25 : 0) +
     ((p?.skills?.length || 0) >= 3 ? 20 : 0) +
     ((p?.experience?.length || 0) > 1 ? 15 : 0)), 100
  );
  const completeness = completenessOf(profile);

  if (loading) return <div className="loading"><span className="spinner" /> Loading career profile…</div>;

  return (
    <section>
      <div className="page-header">
        <h1 className="page-title">Career Profile</h1>
        <p className="page-sub">Your ground truth — the Agent only uses facts from here when building your resumes.</p>
      </div>

      {/* Profile switcher */}
      <div className="profile-switcher" style={{ position: 'relative', marginBottom: 18 }}>
        <button className="profile-switcher-btn" onClick={() => setSwitcherOpen(v => !v)}>
          <div className="profile-avatar">{(profile.name || 'P').charAt(0).toUpperCase()}</div>
          <div style={{ textAlign: 'left' }}>
            <div className="profile-switcher-name">{profile.name || 'Primary Profile'}{profile.isDefault && <span className="badge badge-violet" style={{ marginLeft: 8 }}>Default</span>}</div>
            <div className="profile-switcher-meta">{profile.experience?.length || 0} experience · {profile.education?.length || 0} education · {completeness}% complete</div>
          </div>
          <span className="profile-switcher-chevron">{switcherOpen ? '▾' : '▸'}</span>
        </button>

        {switcherOpen && (
          <div className="profile-switcher-menu">
            {profiles.map(p => (
              <div key={p.id} className={`profile-switcher-item${p.id === activeId ? ' active' : ''}`}>
                {renamingId === p.id ? (
                  <div style={{ display: 'flex', gap: 6, flex: 1, padding: '4px 0' }} onClick={e => e.stopPropagation()}>
                    <input type="text" autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRenameProfile(p.id)} style={{ flex: 1 }} />
                    <button className="btn btn-xs btn-primary" onClick={() => handleRenameProfile(p.id)}>Save</button>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => { setActiveId(p.id); setSwitcherOpen(false); }}>
                      <div className="profile-switcher-item-name">{p.name}{p.isDefault && <span className="badge badge-violet" style={{ marginLeft: 6 }}>Default</span>}</div>
                      <div className="profile-switcher-item-meta">{p.experience?.length || 0} experience · {p.skills?.length || 0} skills · {completenessOf(p)}% complete</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!p.isDefault && <button className="btn btn-xs btn-ghost" title="Set as default" onClick={() => handleSetDefault(p.id)}>☆</button>}
                      <button className="btn btn-xs btn-ghost" title="Rename" onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}>✎</button>
                      {profiles.length > 1 && <button className="btn btn-xs btn-ghost" title="Delete" style={{ color: 'var(--error)' }} onClick={() => handleDeleteProfile(p.id)}>✕</button>}
                    </div>
                  </>
                )}
              </div>
            ))}
            <div className="profile-switcher-divider" />
            {newProfileOpen ? (
              <div style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" autoFocus value={newProfileName} onChange={e => setNewProfileName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateProfile()} placeholder="e.g. Program Manager roles" style={{ flex: 1 }} />
                  <button className="btn btn-xs btn-primary" onClick={handleCreateProfile}>Create</button>
                </div>
                <div className="chips" style={{ marginTop: 8 }}>
                  {PROFILE_NAME_IDEAS.filter(n => !profiles.some(p => p.name === n)).map(n => (
                    <div key={n} className="chip add" onClick={() => setNewProfileName(n)}>+ {n}</div>
                  ))}
                </div>
                <div className="field-hint" style={{ marginTop: 6 }}>Name profiles by the kind of role they target, so you can tell them apart at a glance.</div>
              </div>
            ) : (
              <div className="profile-switcher-item" style={{ color: 'var(--primary)', fontWeight: 600 }} onClick={() => setNewProfileOpen(true)}>
                + New Profile
              </div>
            )}
          </div>
        )}
      </div>

      {/* §4 Completeness — every todo is a real click target, never static text */}
      <div className="card" style={{ marginBottom: 18, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div className="completeness-pct">{completeness}%</div>
          <div>
            <span className={`badge badge-${completeness >= 80 ? 'success' : completeness >= 50 ? 'warning' : 'danger'}`}>
              {completeness >= 80 ? 'Excellent' : completeness >= 50 ? 'Getting there' : 'Needs work'}
            </span>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>Profile completeness</div>
          </div>
        </div>
        <div className="progress-bar" style={{ height: 8 }}>
          <div className="progress-fill" style={{ width: `${completeness}%`, height: '100%' }} />
        </div>

        <div className="check-list">
          {CHECKLIST.map(item => {
            const done = item.isDone(profile);
            return (
              <button key={item.id}
                className={`check-item ${done ? 'done' : 'todo'}`}
                disabled={done}
                onClick={() => !done && item.go({ setAddExpOpen, setAddEduOpen, focusSkills })}>
                <span className="check-mark">{done ? '✓' : '○'}</span>
                <span>{item.label}</span>
                {!done && <span className="check-arrow">→</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 18, alignItems: 'start' }}>
        {/* Experience */}
        <div className="panel" id="cp-experience">
          <div className="panel-head">
            <h2>Experience</h2>
            <button className="btn btn-sm btn-primary" onClick={() => { setEditingExp(null); setExpForm({ title: '', company: '', location: '', startDate: '', endDate: '' }); setAddExpOpen(v => !v); }}>
              {addExpOpen && !editingExp ? '✕ Cancel' : '+ Add'}
            </button>
          </div>

          {addExpOpen && (
            <div className="inline-form">
              <div className="row-2">
                <div className="field"><label className="field-label">Title *</label><input type="text" value={expForm.title} onChange={e => setExpForm(p => ({ ...p, title: e.target.value }))} placeholder="Software Engineer II" /></div>
                <div className="field"><label className="field-label">Company *</label><input type="text" value={expForm.company} onChange={e => setExpForm(p => ({ ...p, company: e.target.value }))} placeholder="Microsoft" /></div>
              </div>
              <div className="row-2">
                <div className="field"><label className="field-label">Start (YYYY-MM) *</label><input type="text" value={expForm.startDate} onChange={e => setExpForm(p => ({ ...p, startDate: e.target.value }))} placeholder="2023-06" /></div>
                <div className="field"><label className="field-label">End (blank = Present)</label><input type="text" value={expForm.endDate} onChange={e => setExpForm(p => ({ ...p, endDate: e.target.value }))} placeholder="2025-01" /></div>
              </div>
              <div className="field"><label className="field-label">Location</label><input type="text" value={expForm.location} onChange={e => setExpForm(p => ({ ...p, location: e.target.value }))} placeholder="Seattle, WA" /></div>
              <div className="toolbar" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={saving} onClick={editingExp ? handleUpdateExp : handleAddExp}>
                  {saving ? 'Saving…' : editingExp ? 'Save changes' : 'Add experience'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAddExpOpen(false); setEditingExp(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {(profile.experience || []).length === 0 && !addExpOpen && (
            <div className="empty-state">
              <div className="empty-state-icon">💼</div>
              <div className="empty-state-title">No experience yet</div>
              <p>The Agent needs at least one role here before it can build a resume.</p>
              <button className="btn btn-primary btn-sm" onClick={() => setAddExpOpen(true)}>+ Add your first role</button>
            </div>
          )}

          {(profile.experience || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(e => (
            <div key={e.id} className="entry-row">
              <div className="entry-row-icon">💼</div>
              <div style={{ flex: 1 }}>
                <div className="entry-row-title">{e.title}</div>
                <div className="entry-row-sub">{e.company}{e.location ? ` · ${e.location}` : ''}</div>
                <div className="entry-row-dates">{e.startDate} – {e.endDate || 'Present'}</div>
              </div>
              <div className="entry-row-actions">
                <button className="btn btn-xs btn-ghost" onClick={() => openEditExp(e)}>Edit</button>
                <button className="btn btn-xs btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteExp(e.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* Education + Skills */}
        <div>
          <div className="panel" id="cp-education" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2>Education</h2>
              <button className="btn btn-sm btn-primary" onClick={() => setAddEduOpen(v => !v)}>{addEduOpen ? '✕' : '+ Add'}</button>
            </div>
            {addEduOpen && (
              <div className="inline-form">
                <div className="field"><label className="field-label">School *</label><input type="text" value={eduForm.school} onChange={e => setEduForm(p => ({ ...p, school: e.target.value }))} placeholder="MIT" /></div>
                <div className="field"><label className="field-label">Degree *</label><input type="text" value={eduForm.degree} onChange={e => setEduForm(p => ({ ...p, degree: e.target.value }))} placeholder="M.S. Computer Science" /></div>
                <div className="row-2">
                  <div className="field"><label className="field-label">Start</label><input type="text" value={eduForm.startDate} onChange={e => setEduForm(p => ({ ...p, startDate: e.target.value }))} placeholder="2020-09" /></div>
                  <div className="field"><label className="field-label">End</label><input type="text" value={eduForm.endDate} onChange={e => setEduForm(p => ({ ...p, endDate: e.target.value }))} placeholder="2022-05" /></div>
                </div>
                <div className="toolbar" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={saving} onClick={async () => { setSaving(true); await handleAddEdu(); setSaving(false); }}>Add</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAddEduOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
            {(profile.education || []).map(e => (
              <div key={e.id} className="entry-row">
                <div className="entry-row-icon">🎓</div>
                <div style={{ flex: 1 }}>
                  <div className="entry-row-title">{e.degree}</div>
                  <div className="entry-row-sub">{e.school}</div>
                  <div className="entry-row-dates">{e.startDate}{e.endDate ? ` – ${e.endDate}` : ''}</div>
                </div>
                <button className="btn btn-xs btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteEdu(e.id)}>✕</button>
              </div>
            ))}
            {!(profile.education?.length) && !addEduOpen && (
              <div className="empty-state" style={{ padding: '18px 0' }}>
                <div className="empty-state-icon">🎓</div>
                <div className="empty-state-title">No education yet</div>
                <button className="btn btn-sm btn-primary" onClick={() => setAddEduOpen(true)}>+ Add education</button>
              </div>
            )}
          </div>

          <div className="panel" id="cp-skills">
            <div className="panel-head"><h2>Skills</h2><span className="count">{profile.skills?.length || 0}</span></div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input ref={skillInputRef} type="text" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && skillInput.trim() && handleAddSkill()} placeholder="Add a skill…" style={{ flex: 1 }} />
              <button className="btn btn-sm btn-primary" onClick={handleAddSkill}>+ Add</button>
            </div>
            {/* Grouped by category — never a flat unsorted dump (§6). */}
            {groupSkills(profile.skills).map(([group, items]) => (
              <div className="skill-group" key={group}>
                <div className="skill-group-label">{group}</div>
                <div className="chips">
                  {items.map(s => (
                    <div key={s.id} className="chip editable" onClick={() => handleDeleteSkill(s.id)} title="Click to remove">
                      {s.label} <span className="x">✕</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!(profile.skills?.length) && (
              <div className="empty-state" style={{ padding: '18px 0' }}>
                <div className="empty-state-icon">◈</div>
                <div className="empty-state-title">No skills yet</div>
                <p>Add at least 3 so the Agent has something to match against.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
