import React, { useState, useEffect } from 'react';
import {
  listCareerProfiles, createCareerProfile, renameCareerProfile, deleteCareerProfileDoc, setDefaultCareerProfile,
  addExperience, updateExperience, deleteExperience,
  addEducation, updateEducation, deleteEducation,
  addSkill, deleteSkill,
  addCertification, updateCertification, deleteCertification,
  updateProfileDetails,
} from '../lib/firestore.js';
import Modal from './Modal.jsx';

const PROFILE_NAME_IDEAS = ['Full Stack roles', 'Program Manager roles', 'Data / ML roles', 'Early-career roles'];

const TABS = ['Overview', 'Experience', 'Education', 'Skills', 'Certifications'];

/* ---- §6 One date format across every section: "Mon YYYY" ---- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim();
  return String(value);
}
function isPast(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return false;
  return new Date(Number(m[1]), Number(m[2]), 0) < new Date();
}

/* ---- §2 One link-chip component, reused wherever an outbound link appears ---- */
function LinkChip({ icon, label, href }) {
  if (!href) return null;
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <a className="link-chip" href={url} target="_blank" rel="noopener noreferrer">
      <span aria-hidden="true">{icon}</span>{label}
    </a>
  );
}

function EmptyState({ icon, title, text, actionLabel, onAction }) {
  return (
    <div className="es-card" style={{ padding: '32px 24px', boxShadow: 'none' }}>
      <div className="es-icon">{icon}</div>
      <div className="es-title">{title}</div>
      {text && <p className="es-text">{text}</p>}
      {actionLabel && <button className="btn btn-primary btn-sm" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

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
    } else other.push(s);
  }
  const out = SKILL_GROUPS.map(([name]) => [name, groups.get(name)]).filter(([, v]) => v?.length);
  if (other.length) out.push(['Other', other]);
  return out;
}

function completenessOf(p) {
  if (!p) return 0;
  return Math.min(
    ((p.experience?.length > 0 ? 40 : 0) +
     (p.education?.length > 0 ? 25 : 0) +
     ((p.skills?.length || 0) >= 3 ? 20 : 0) +
     (p.experience?.length > 1 ? 15 : 0)), 100);
}

const EMPTY_EXP = { title: '', company: '', location: '', startDate: '', endDate: '', current: false, bullets: '', skills: '' };
const EMPTY_EDU = { school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', location: '', gpa: '' };
const EMPTY_CERT = { name: '', issuer: '', issueDate: '', expiryDate: '', url: '' };

export default function CareerProfileView({ uid, notify }) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState('main');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');           // 'list' | 'detail'
  const [tab, setTab] = useState('Overview');
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);

  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsForm, setDetailsForm] = useState({});

  const [expForm, setExpForm] = useState(EMPTY_EXP);
  const [expEditingId, setExpEditingId] = useState(null);
  const [expAdding, setExpAdding] = useState(false);

  const [eduForm, setEduForm] = useState(EMPTY_EDU);
  const [eduEditingId, setEduEditingId] = useState(null);
  const [eduAdding, setEduAdding] = useState(false);

  const [certForm, setCertForm] = useState(EMPTY_CERT);
  const [certEditingId, setCertEditingId] = useState(null);
  const [certAdding, setCertAdding] = useState(false);

  const [skillInput, setSkillInput] = useState('');

  useEffect(() => { load(); }, [uid]);

  async function load(selectId) {
    setLoading(true);
    const list = await listCareerProfiles(uid);
    setProfiles(list);
    setActiveId(selectId || list.find(p => p.isDefault)?.id || list[0]?.id || 'main');
    setLoading(false);
  }

  const profile = profiles.find(p => p.id === activeId) || null;
  const details = profile?.details || {};

  function patchActive(patch) {
    setProfiles(list => list.map(p => p.id === activeId ? { ...p, ...patch } : p));
  }

  /* ---------------- profile-level ---------------- */
  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;
    const created = await createCareerProfile(uid, newProfileName.trim());
    setProfiles(list => [...list, created]);
    setNewProfileName(''); setNewProfileOpen(false);
    setActiveId(created.id); setView('detail');
    notify?.({ kind: 'good', title: 'Profile created', detail: created.name });
  }
  async function handleRename(id) {
    if (!renameValue.trim()) return;
    await renameCareerProfile(uid, id, renameValue.trim());
    setProfiles(list => list.map(p => p.id === id ? { ...p, name: renameValue.trim() } : p));
    setRenamingId(null); setMenuOpen(null);
  }
  async function handleDuplicate(p) {
    const created = await createCareerProfile(uid, `${p.name} (copy)`);
    // Copy content across so a duplicate is genuinely a starting point, not an empty shell.
    for (const e of p.experience || []) await addExperience(uid, { ...e, id: undefined }, created.id);
    for (const e of p.education || []) await addEducation(uid, { ...e, id: undefined }, created.id);
    for (const s of p.skills || []) await addSkill(uid, s.label, created.id);
    for (const c of p.certifications || []) await addCertification(uid, { ...c, id: undefined }, created.id);
    if (p.details) await updateProfileDetails(uid, p.details, created.id);
    setMenuOpen(null);
    await load();
    notify?.({ kind: 'good', title: 'Profile duplicated', detail: created.name });
  }
  async function handleSetPrimary(id) {
    await setDefaultCareerProfile(uid, id);
    setProfiles(list => list.map(p => ({ ...p, isDefault: p.id === id })));
    setMenuOpen(null);
  }
  async function handleDeleteProfile(p) {
    if (profiles.length <= 1) { notify?.({ kind: 'warn', title: "Can't delete your only profile", detail: '' }); return; }
    await deleteCareerProfileDoc(uid, p.id);
    setDeleteTarget(null); setMenuOpen(null);
    await load();
    notify?.({ kind: '', title: 'Profile deleted', detail: p.name });
  }

  async function handleSaveDetails() {
    setSaving(true);
    await updateProfileDetails(uid, detailsForm, activeId);
    patchActive({ details: detailsForm });
    setDetailsOpen(false); setSaving(false);
  }

  /* ---------------- experience ---------------- */
  function openExpEdit(e) {
    setExpEditingId(e.id); setExpAdding(false);
    setExpForm({
      title: e.title || '', company: e.company || '', location: e.location || '',
      startDate: e.startDate || '', endDate: e.endDate || '', current: !e.endDate,
      bullets: (e.bullets || []).join('\n'), skills: (e.skills || []).join(', '),
    });
  }
  function expPayload() {
    return {
      title: expForm.title.trim(), company: expForm.company.trim(),
      location: expForm.location.trim(),
      startDate: expForm.startDate.trim(),
      endDate: expForm.current ? '' : expForm.endDate.trim(),
      bullets: expForm.bullets.split('\n').map(s => s.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean),
      skills: expForm.skills.split(',').map(s => s.trim()).filter(Boolean),
    };
  }
  async function saveExp() {
    const p = expPayload();
    if (!p.title || !p.company || !p.startDate || (!p.endDate && !expForm.current)) {
      notify?.({ kind: 'warn', title: 'Role, company, start and end date are required', detail: '' });
      return;
    }
    setSaving(true);
    if (expEditingId) {
      await updateExperience(uid, expEditingId, p, activeId);
      patchActive({ experience: (profile.experience || []).map(e => e.id === expEditingId ? { ...e, ...p } : e) });
    } else {
      const item = await addExperience(uid, p, activeId);
      patchActive({ experience: [...(profile.experience || []), item] });
    }
    setExpEditingId(null); setExpAdding(false); setExpForm(EMPTY_EXP); setSaving(false);
  }
  async function removeExp(id) {
    await deleteExperience(uid, id, activeId);
    patchActive({ experience: (profile.experience || []).filter(e => e.id !== id) });
  }
  async function duplicateExp(e) {
    const item = await addExperience(uid, { ...e, id: undefined }, activeId);
    patchActive({ experience: [...(profile.experience || []), item] });
  }

  /* ---------------- education ---------------- */
  function openEduEdit(e) {
    setEduEditingId(e.id); setEduAdding(false);
    setEduForm({
      school: e.school || '', degree: e.degree || '', fieldOfStudy: e.fieldOfStudy || '',
      startDate: e.startDate || '', endDate: e.endDate || '', location: e.location || '', gpa: e.gpa || '',
    });
  }
  async function saveEdu() {
    if (!eduForm.school.trim() || !eduForm.degree.trim() || !eduForm.fieldOfStudy.trim() || !eduForm.endDate.trim()) {
      notify?.({ kind: 'warn', title: 'Institution, degree, field of study and graduation date are required', detail: '' });
      return;
    }
    setSaving(true);
    const payload = { ...eduForm };
    if (eduEditingId) {
      await updateEducation(uid, eduEditingId, payload, activeId);
      patchActive({ education: (profile.education || []).map(e => e.id === eduEditingId ? { ...e, ...payload } : e) });
    } else {
      const item = await addEducation(uid, payload, activeId);
      patchActive({ education: [...(profile.education || []), item] });
    }
    setEduEditingId(null); setEduAdding(false); setEduForm(EMPTY_EDU); setSaving(false);
  }
  async function removeEdu(id) {
    await deleteEducation(uid, id, activeId);
    patchActive({ education: (profile.education || []).filter(e => e.id !== id) });
  }

  /* ---------------- certifications ---------------- */
  function openCertEdit(c) {
    setCertEditingId(c.id); setCertAdding(false);
    setCertForm({ name: c.name || '', issuer: c.issuer || '', issueDate: c.issueDate || '', expiryDate: c.expiryDate || '', url: c.url || '' });
  }
  async function saveCert() {
    if (!certForm.name.trim() || !certForm.issuer.trim() || !certForm.issueDate.trim()) {
      notify?.({ kind: 'warn', title: 'Name, issuer and issue date are required', detail: '' });
      return;
    }
    setSaving(true);
    const payload = { ...certForm };
    if (certEditingId) {
      await updateCertification(uid, certEditingId, payload, activeId);
      patchActive({ certifications: (profile.certifications || []).map(c => c.id === certEditingId ? { ...c, ...payload } : c) });
    } else {
      const item = await addCertification(uid, payload, activeId);
      patchActive({ certifications: [...(profile.certifications || []), item] });
    }
    setCertEditingId(null); setCertAdding(false); setCertForm(EMPTY_CERT); setSaving(false);
  }
  async function removeCert(id) {
    await deleteCertification(uid, id, activeId);
    patchActive({ certifications: (profile.certifications || []).filter(c => c.id !== id) });
  }

  /* ---------------- skills ---------------- */
  async function handleAddSkill() {
    const v = skillInput.trim();
    if (!v) return;
    const item = await addSkill(uid, v, activeId);
    patchActive({ skills: [...(profile.skills || []), item] });
    setSkillInput('');
  }
  async function handleDeleteSkill(id) {
    await deleteSkill(uid, id, activeId);
    patchActive({ skills: (profile.skills || []).filter(s => s.id !== id) });
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading career profile…</div>;

  /* ============================================================
     1. Career Profiles — multi-profile grid
     ============================================================ */
  if (view === 'list') {
    return (
      <section>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
          <div>
            <h1 className="page-title">Career Profiles</h1>
            <p className="page-sub" style={{ margin: 0 }}>Your professional source of truth — resumes are built and tailored from these.</p>
          </div>
          <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => setNewProfileOpen(true)}>+ New Profile</button>
        </div>

        <div className="profile-grid">
          {profiles.map(p => {
            const pct = completenessOf(p);
            return (
              <div className="card profile-card" key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  {renamingId === p.id ? (
                    <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                      onBlur={() => handleRename(p.id)} style={{ flex: 1 }} />
                  ) : (
                    <>
                      <span className="profile-card-name">{p.name}</span>
                      {p.isDefault && <span className="badge badge-primary">PRIMARY</span>}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="progress-bar" style={{ height: 8, flex: 1 }}>
                    <div className="progress-fill" style={{ width: `${pct}%`, height: '100%' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)' }}>{pct}%</span>
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {p.experience?.length || 0} experience · {p.skills?.length || 0} skills
                </div>
                {/* Always shown, even at zero — it's what makes delete safe. */}
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3 }}>
                  {p.linkedResumes || 0} linked resume{(p.linkedResumes || 0) === 1 ? '' : 's'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 16 }}>
                  <button className="btn btn-sm" onClick={() => { setActiveId(p.id); setView('detail'); setTab('Overview'); }}>Open Profile</button>
                  <div style={{ position: 'relative', marginLeft: 'auto' }}>
                    <button className="card-overflow-btn" onClick={() => setMenuOpen(menuOpen === p.id ? null : p.id)}>•••</button>
                    {menuOpen === p.id && (
                      <>
                        <div className="dd-backdrop show" onClick={() => setMenuOpen(null)} />
                        <div className="card-overflow-menu">
                          <div className="card-overflow-item" onClick={() => { setRenamingId(p.id); setRenameValue(p.name); setMenuOpen(null); }}>Rename</div>
                          <div className="card-overflow-item" onClick={() => handleDuplicate(p)}>Duplicate</div>
                          {!p.isDefault && <div className="card-overflow-item" onClick={() => handleSetPrimary(p.id)}>Set as Primary</div>}
                          <div className="card-overflow-item" onClick={() => setMenuOpen(null)}>Archive</div>
                          <div className="card-overflow-sep" />
                          <div className="card-overflow-item danger" onClick={() => { setDeleteTarget(p); setMenuOpen(null); }}>Delete</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <button className="profile-card-new" onClick={() => setNewProfileOpen(true)}>
            <span style={{ fontSize: 26 }}>+</span>
            <span>Create Career Profile</span>
          </button>
        </div>

        <Modal open={newProfileOpen} onClose={() => setNewProfileOpen(false)} title="New Career Profile">
          <div className="field">
            <span className="field-label">Profile name</span>
            <input autoFocus type="text" value={newProfileName} onChange={e => setNewProfileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateProfile()} placeholder="e.g. Program Manager roles" />
            <div className="field-hint">Name profiles by the kind of role they target, so you can tell them apart at a glance.</div>
          </div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {PROFILE_NAME_IDEAS.filter(n => !profiles.some(p => p.name === n)).map(n => (
              <div key={n} className="chip add" onClick={() => setNewProfileName(n)}>+ {n}</div>
            ))}
          </div>
          <div className="toolbar">
            <button className="btn btn-ghost" onClick={() => setNewProfileOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreateProfile}>Create profile</button>
          </div>
        </Modal>

        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete profile?">
          {(deleteTarget?.linkedResumes || 0) > 0 ? (
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--navy)' }}>{deleteTarget?.name}</strong> is linked to {deleteTarget.linkedResumes} resume
              {deleteTarget.linkedResumes === 1 ? '' : 's'}. Deleting it won't remove those resumes, but they'll lose their source profile.
            </p>
          ) : (
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              Delete <strong style={{ color: 'var(--navy)' }}>{deleteTarget?.name}</strong>? This can't be undone.
            </p>
          )}
          <div className="toolbar">
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ background: 'var(--bad)', boxShadow: '0 10px 22px var(--bad-shadow)' }}
              onClick={() => handleDeleteProfile(deleteTarget)}>Delete profile</button>
          </div>
        </Modal>
      </section>
    );
  }

  /* ============================================================
     2. Career Profile detail
     ============================================================ */
  const exp = profile?.experience || [];
  const edu = profile?.education || [];
  const certs = profile?.certifications || [];

  return (
    <section>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => setView('list')}>← All profiles</button>

      {/* §2 Personal Details — always visible, above the tabs */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div className="identity-card">
          <div className="identity-avatar">
            {(details.fullName || profile?.name || 'P').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="identity-name">{details.fullName || 'Add your name'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>{profile?.name}</span>
              {profile?.isDefault && <span className="badge badge-primary">PRIMARY</span>}
            </div>
            {details.tagline && <div className="identity-tagline">{details.tagline}</div>}
            <div className="identity-contact">
              {details.location && <span>📍 {details.location}</span>}
              {details.email && <span>✉ {details.email}</span>}
              {details.phone && <span>☎ {details.phone}</span>}
            </div>
            {(details.linkedin || details.github || details.portfolio) && (
              <div className="chip-row" style={{ marginTop: 10 }}>
                <LinkChip icon="in" label="LinkedIn" href={details.linkedin} />
                <LinkChip icon="◈" label="GitHub" href={details.github} />
                <LinkChip icon="🌐" label="Portfolio" href={details.portfolio} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn-sm" onClick={() => notify?.({ kind: '', title: 'Recruiter preview', detail: 'Coming soon' })}>View as Recruiter</button>
            <button className="btn btn-sm btn-primary" onClick={() => { setDetailsForm(details); setDetailsOpen(true); }}>Edit Profile</button>
          </div>
        </div>
      </div>

      {/* §4 Sticky tabs — text + underline, never a filled pill */}
      <div className="cp-tabs">
        {TABS.map(t => (
          <button key={t} className={`cp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div style={{ paddingTop: 18 }}>
        {/* ---------- Overview ---------- */}
        {tab === 'Overview' && (
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head"><h2>Profile completeness</h2></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div className="completeness-pct">{completenessOf(profile)}%</div>
              <span className={`badge badge-${completenessOf(profile) >= 80 ? 'success' : completenessOf(profile) >= 50 ? 'warning' : 'danger'}`}>
                {completenessOf(profile) >= 80 ? 'Excellent' : completenessOf(profile) >= 50 ? 'Getting there' : 'Needs work'}
              </span>
            </div>
            <div className="progress-bar" style={{ height: 8 }}>
              <div className="progress-fill" style={{ width: `${completenessOf(profile)}%`, height: '100%' }} />
            </div>
            <div className="check-list">
              {[
                { id: 'exp', label: 'Add your work experience', done: exp.length > 0, go: () => { setTab('Experience'); setExpAdding(true); } },
                { id: 'exp2', label: 'Add a second role for stronger context', done: exp.length > 1, go: () => { setTab('Experience'); setExpAdding(true); } },
                { id: 'edu', label: 'Add your education', done: edu.length > 0, go: () => { setTab('Education'); setEduAdding(true); } },
                { id: 'skills', label: 'List at least 3 skills', done: (profile?.skills?.length || 0) >= 3, go: () => setTab('Skills') },
                { id: 'cert', label: 'Add a certification', done: certs.length > 0, go: () => { setTab('Certifications'); setCertAdding(true); } },
                { id: 'details', label: 'Complete your personal details', done: Boolean(details.fullName && details.email), go: () => { setDetailsForm(details); setDetailsOpen(true); } },
              ].map(item => (
                <button key={item.id} className={`check-item ${item.done ? 'done' : 'todo'}`} disabled={item.done} onClick={item.go}>
                  <span className="check-mark">{item.done ? '✓' : '○'}</span>
                  <span>{item.label}</span>
                  {!item.done && <span className="check-arrow">→</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------- Experience ---------- */}
        {tab === 'Experience' && (
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head">
              <h2>Experience</h2>
              <button className="btn btn-sm btn-primary" onClick={() => { setExpAdding(a => !a); setExpEditingId(null); setExpForm(EMPTY_EXP); }}>
                {expAdding ? '✕ Cancel' : '+ Add Experience'}
              </button>
            </div>

            {expAdding && <ExperienceForm form={expForm} setForm={setExpForm} onSave={saveExp} onCancel={() => { setExpAdding(false); setExpForm(EMPTY_EXP); }} saving={saving} />}

            {exp.length === 0 && !expAdding ? (
              <EmptyState icon="💼" title="No experience yet"
                text="The Agent needs at least one role before it can build a resume."
                actionLabel="+ Add Experience" onAction={() => setExpAdding(true)} />
            ) : (
              <div className="timeline">
                {exp.map(e => (
                  <div className="timeline-entry" key={e.id}>
                    {expEditingId === e.id ? (
                      <ExperienceForm form={expForm} setForm={setExpForm} onSave={saveExp}
                        onCancel={() => { setExpEditingId(null); setExpForm(EMPTY_EXP); }} saving={saving} />
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="timeline-role">{e.title}</div>
                            <div className="timeline-company">{e.company}</div>
                            <div className="timeline-dates">
                              {fmtMonth(e.startDate)} – {e.endDate ? fmtMonth(e.endDate) : 'Present'}
                              {e.location ? ` · ${e.location}` : ''}
                            </div>
                          </div>
                          {!e.endDate && <span className="badge badge-success">Current</span>}
                        </div>
                        {(e.bullets || []).length > 0 && (
                          <ul style={{ margin: '10px 0 0 18px', padding: 0 }}>
                            {e.bullets.map((b, i) => (
                              <li key={i} style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 3 }}>{b}</li>
                            ))}
                          </ul>
                        )}
                        {(e.skills || []).length > 0 && (
                          <div className="chips" style={{ marginTop: 10 }}>
                            {e.skills.map((s, i) => <span key={i} className="data-chip">{s}</span>)}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                          <a className="row-link" onClick={() => openExpEdit(e)}>Edit</a>
                          <a className="row-link" onClick={() => duplicateExp(e)}>Duplicate</a>
                          <a className="row-link danger" onClick={() => removeExp(e.id)}>Delete</a>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- Education ---------- */}
        {tab === 'Education' && (
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head">
              <h2>Education</h2>
              <button className="btn btn-sm btn-primary" onClick={() => { setEduAdding(a => !a); setEduEditingId(null); setEduForm(EMPTY_EDU); }}>
                {eduAdding ? '✕ Cancel' : '+ Add Education'}
              </button>
            </div>

            {eduAdding && <EducationForm form={eduForm} setForm={setEduForm} onSave={saveEdu} onCancel={() => { setEduAdding(false); setEduForm(EMPTY_EDU); }} saving={saving} />}

            {edu.length === 0 && !eduAdding ? (
              <EmptyState icon="🎓" title="No education yet"
                text="Many ATS filters screen on degree and institution before a human reads the resume."
                actionLabel="+ Add Education" onAction={() => setEduAdding(true)} />
            ) : edu.map(e => (
              <div className="entry-card" key={e.id}>
                {eduEditingId === e.id ? (
                  <EducationForm form={eduForm} setForm={setEduForm} onSave={saveEdu}
                    onCancel={() => { setEduEditingId(null); setEduForm(EMPTY_EDU); }} saving={saving} />
                ) : (
                  <>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy)' }}>{e.school}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
                      {e.degree}{e.fieldOfStudy ? ` — ${e.fieldOfStudy}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                      Graduated {fmtMonth(e.endDate)}
                      {e.location ? ` · ${e.location}` : ''}
                      {e.gpa ? ` · GPA ${e.gpa}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                      <a className="row-link" onClick={() => openEduEdit(e)}>Edit</a>
                      <a className="row-link danger" onClick={() => removeEdu(e.id)}>Delete</a>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ---------- Skills ---------- */}
        {tab === 'Skills' && (
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head"><h2>Skills</h2><span className="count">{profile?.skills?.length || 0}</span></div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <input type="text" value={skillInput} onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSkill()} placeholder="Add a skill…" style={{ flex: 1 }} />
              <button className="btn btn-sm btn-primary" onClick={handleAddSkill}>+ Add</button>
            </div>
            {groupSkills(profile?.skills).map(([group, items]) => (
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
            {!(profile?.skills?.length) && (
              <EmptyState icon="◈" title="No skills yet" text="Add at least 3 so the Agent has something to match against." />
            )}
          </div>
        )}

        {/* ---------- Certifications ---------- */}
        {tab === 'Certifications' && (
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head">
              <h2>Certifications</h2>
              <button className="btn btn-sm btn-primary" onClick={() => { setCertAdding(a => !a); setCertEditingId(null); setCertForm(EMPTY_CERT); }}>
                {certAdding ? '✕ Cancel' : '+ Add Certification'}
              </button>
            </div>

            {certAdding && <CertForm form={certForm} setForm={setCertForm} onSave={saveCert} onCancel={() => { setCertAdding(false); setCertForm(EMPTY_CERT); }} saving={saving} />}

            {certs.length === 0 && !certAdding ? (
              <EmptyState icon="🏅" title="No certifications yet"
                text="Certifications are strong ATS signal for cloud, security and PM roles."
                actionLabel="+ Add Certification" onAction={() => setCertAdding(true)} />
            ) : certs.map(c => (
              <div className="cert-row" key={c.id}>
                {certEditingId === c.id ? (
                  <CertForm form={certForm} setForm={setCertForm} onSave={saveCert}
                    onCancel={() => { setCertEditingId(null); setCertForm(EMPTY_CERT); }} saving={saving} />
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--navy)' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>
                          {c.issuer} · Issued {fmtMonth(c.issueDate)}
                          {c.expiryDate ? ` · Expires ${fmtMonth(c.expiryDate)}` : ''}
                        </span>
                        {c.expiryDate && isPast(c.expiryDate) && <span className="badge badge-warning">Expired</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <LinkChip icon="↗" label="View credential" href={c.url} />
                      <a className="row-link" onClick={() => openCertEdit(c)}>Edit</a>
                      <a className="row-link danger" onClick={() => removeCert(c.id)}>Delete</a>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Personal details editor */}
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Edit personal details" wide>
        <div className="row-2">
          <div className="field"><label className="field-label">Full name</label>
            <input type="text" value={detailsForm.fullName || ''} onChange={e => setDetailsForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Bhanu Cheryala" /></div>
          <div className="field"><label className="field-label">Location</label>
            <input type="text" value={detailsForm.location || ''} onChange={e => setDetailsForm(f => ({ ...f, location: e.target.value }))} placeholder="Dallas, TX" /></div>
        </div>
        <div className="field"><label className="field-label">Tagline</label>
          <input type="text" value={detailsForm.tagline || ''} onChange={e => setDetailsForm(f => ({ ...f, tagline: e.target.value }))}
            placeholder="Software Engineer | Full Stack | Cloud | Distributed Systems" /></div>
        <div className="row-2">
          <div className="field"><label className="field-label">Email</label>
            <input type="email" value={detailsForm.email || ''} onChange={e => setDetailsForm(f => ({ ...f, email: e.target.value }))} placeholder="name@email.com" /></div>
          <div className="field"><label className="field-label">Phone</label>
            <input type="text" value={detailsForm.phone || ''} onChange={e => setDetailsForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-0134" /></div>
        </div>
        <div className="field"><label className="field-label">LinkedIn</label>
          <input type="text" value={detailsForm.linkedin || ''} onChange={e => setDetailsForm(f => ({ ...f, linkedin: e.target.value }))} placeholder="linkedin.com/in/you" /></div>
        <div className="row-2">
          <div className="field"><label className="field-label">GitHub</label>
            <input type="text" value={detailsForm.github || ''} onChange={e => setDetailsForm(f => ({ ...f, github: e.target.value }))} placeholder="github.com/you" /></div>
          <div className="field"><label className="field-label">Portfolio</label>
            <input type="text" value={detailsForm.portfolio || ''} onChange={e => setDetailsForm(f => ({ ...f, portfolio: e.target.value }))} placeholder="yoursite.com" /></div>
        </div>
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => setDetailsOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSaveDetails}>{saving ? 'Saving…' : 'Save details'}</button>
        </div>
      </Modal>
    </section>
  );
}

/* ============================================================
   Inline forms — every Edit expands in place, never navigates (§6)
   ============================================================ */
function ExperienceForm({ form, setForm, onSave, onCancel, saving }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="inline-form">
      <div className="row-2">
        <div className="field"><label className="field-label">Job title *</label>
          <input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Software Engineer" /></div>
        <div className="field"><label className="field-label">Company *</label>
          <input type="text" value={form.company} onChange={e => set('company', e.target.value)} placeholder="Microsoft" /></div>
      </div>
      <div className="row-2">
        <div className="field"><label className="field-label">Start date * (YYYY-MM)</label>
          <input type="text" value={form.startDate} onChange={e => set('startDate', e.target.value)} placeholder="2023-06" /></div>
        <div className="field"><label className="field-label">End date * (YYYY-MM)</label>
          <input type="text" value={form.endDate} onChange={e => set('endDate', e.target.value)} disabled={form.current} placeholder="2025-01" /></div>
      </div>
      <label className="field-check" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={form.current} onChange={e => set('current', e.target.checked)} style={{ width: 'auto', accentColor: 'var(--brand)' }} />
        I currently work here
      </label>
      <div className="field"><label className="field-label">Location</label>
        <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Dallas, TX" /></div>
      <div className="field"><label className="field-label">Achievements <span className="count">(one per line)</span></label>
        <textarea rows={4} value={form.bullets} onChange={e => set('bullets', e.target.value)}
          placeholder={'Built internal developer platform used by 200+ engineers.\nImproved deploy reliability from 91% to 99.2%.'} /></div>
      <div className="field"><label className="field-label">Skills used <span className="count">(comma separated)</span></label>
        <input type="text" value={form.skills} onChange={e => set('skills', e.target.value)} placeholder="Kubernetes, Azure, Java, Spring Boot" /></div>
      <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function EducationForm({ form, setForm, onSave, onCancel, saving }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="inline-form">
      <div className="field"><label className="field-label">Institution *</label>
        <input type="text" value={form.school} onChange={e => set('school', e.target.value)} placeholder="University of Texas at Dallas" /></div>
      <div className="row-2">
        <div className="field"><label className="field-label">Degree *</label>
          <input type="text" value={form.degree} onChange={e => set('degree', e.target.value)} placeholder="Bachelor of Science" /></div>
        <div className="field"><label className="field-label">Field of study *</label>
          <input type="text" value={form.fieldOfStudy} onChange={e => set('fieldOfStudy', e.target.value)} placeholder="Computer Science" /></div>
      </div>
      <div className="row-2">
        <div className="field"><label className="field-label">Graduation date * (YYYY-MM)</label>
          <input type="text" value={form.endDate} onChange={e => set('endDate', e.target.value)} placeholder="2019-05" /></div>
        <div className="field"><label className="field-label">Location</label>
          <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Dallas, TX" /></div>
      </div>
      <div className="field"><label className="field-label">GPA</label>
        <input type="text" value={form.gpa} onChange={e => set('gpa', e.target.value)} placeholder="3.8" style={{ maxWidth: 120 }} /></div>
      <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CertForm({ form, setForm, onSave, onCancel, saving }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="inline-form">
      <div className="field"><label className="field-label">Certificate name *</label>
        <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="AWS Certified Solutions Architect — Professional" /></div>
      <div className="field"><label className="field-label">Issuing organization *</label>
        <input type="text" value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="Amazon Web Services" /></div>
      <div className="row-2">
        <div className="field"><label className="field-label">Issue date * (YYYY-MM)</label>
          <input type="text" value={form.issueDate} onChange={e => set('issueDate', e.target.value)} placeholder="2024-03" /></div>
        <div className="field"><label className="field-label">Expiration date</label>
          <input type="text" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} placeholder="2027-03" /></div>
      </div>
      <div className="field"><label className="field-label">Credential URL</label>
        <input type="text" value={form.url} onChange={e => set('url', e.target.value)} placeholder="credly.com/badges/…" /></div>
      <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
