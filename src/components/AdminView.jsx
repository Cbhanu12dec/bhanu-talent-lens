import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { listDomainsAdmin, saveDomain } from '../lib/firestore.js';
import { domainAdminAction } from '../lib/claude.js';

const ADMIN_EMAIL = 'cbhanu12dec@gmail.com';
const getAdminStats     = httpsCallable(functions, 'getAdminStats');
const updateBillingSetting = httpsCallable(functions, 'updateBillingSettings');
const listCouponsF      = httpsCallable(functions, 'listCoupons');
const createCouponF     = httpsCallable(functions, 'createCoupon');
const updateCouponF     = httpsCallable(functions, 'updateCoupon');
const setCouponActiveF  = httpsCallable(functions, 'setCouponActive');

function formatDiscount(c) {
  return c.discountType === 'percent' ? `${c.discountValue}% off` : `$${(c.discountValue / 100).toFixed(2)} off`;
}
function formatExpiry(ts) {
  if (!ts) return 'Never';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ===================== OVERVIEW TAB ===================== */
function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [billing, setBilling] = useState({ tailoringFree: false, creditCostPerTailor: 1 });
  const [savingBilling, setSavingBilling] = useState(false);

  useEffect(() => {
    getAdminStats().then(r => setStats(r.data));
  }, []);

  async function handleSaveBilling() {
    setSavingBilling(true);
    await updateBillingSetting({ tailoringFree: billing.tailoringFree, creditCostPerTailor: Number(billing.creditCostPerTailor) });
    setSavingBilling(false);
  }

  return (
    <div>
      <div className="stat-card-grid" style={{ marginBottom: 24 }}>
        {[
          ['Users', stats?.userCount ?? '—'],
          ['Resumes', stats?.resumeCount ?? '—'],
          ['Active coupons', stats?.activeCouponCount ?? '—'],
          ['Total earned', stats?.totalRevenueCents != null ? `$${(stats.totalRevenueCents / 100).toFixed(2)}` : '—'],
        ].map(([label, val]) => (
          <div key={label} className="card stat-card">
            <div className="label">{label}</div>
            <div className="value" style={{ color: 'var(--primary)' }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="panel-head"><h2>Billing controls</h2></div>
        <label className="field-check" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={billing.tailoringFree} onChange={e => setBilling(b => ({ ...b, tailoringFree: e.target.checked }))} style={{ width: 'auto', accentColor: 'var(--primary)' }} />
          Free tailoring mode (no credits charged)
        </label>
        <div className="field">
          <label className="field-label">Credits per tailor (when not free)</label>
          <input type="number" min="0" value={billing.creditCostPerTailor} onChange={e => setBilling(b => ({ ...b, creditCostPerTailor: e.target.value }))} style={{ maxWidth: 100 }} />
        </div>
        <button className="btn btn-admin btn-sm" disabled={savingBilling} onClick={handleSaveBilling}>
          {savingBilling ? 'Saving…' : 'Save billing settings'}
        </button>
      </div>
    </div>
  );
}

/* ===================== USERS TAB ===================== */
function UsersTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { getAdminStats().then(r => setStats(r.data)); }, []);
  const users = stats?.recentUsers || [];
  return (
    <div>
      <div className="admin-banner">🔒 User data is read-only — credits and roles are managed server-side only.</div>
      {!stats ? <div className="loading"><span className="spinner" /> Loading…</div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Credits</th><th>Joined</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="cell-strong">{u.email}</td>
                  <td><span className={`badge badge-${u.role === 'admin' ? 'admin' : 'neutral'}`}>{u.role}</span></td>
                  <td>{u.credits}</td>
                  <td className="cell-muted">{u.createdAt ? new Date(u.createdAt._seconds * 1000).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No user data returned — ensure getAdminStats returns recentUsers[]</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ===================== COUPONS TAB ===================== */
const EMPTY = { code: '', discountType: 'percent', discountValue: 20, maxUses: '', expiresAt: '' };

function CouponsTab() {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editCode, setEditCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    const r = await listCouponsF();
    setCoupons(r.data?.coupons || []);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await createCouponF({
        code: form.code.trim().toUpperCase(), discountType: form.discountType,
        discountValue: Number(form.discountValue),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresAtMs: form.expiresAt ? new Date(form.expiresAt).getTime() : null,
      });
      setForm(EMPTY); setShowCreate(false); await load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function handleToggle(code, active) {
    await setCouponActiveF({ code, active: !active });
    await load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-admin btn-sm" onClick={() => setShowCreate(v => !v)}>
          {showCreate ? '✕ Cancel' : '+ New Coupon'}
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="panel-head"><h2>Create coupon</h2></div>
          {error && <div className="error-box">{error}</div>}
          <form onSubmit={handleCreate}>
            <div className="row-2">
              <div className="field"><label className="field-label">Code *</label>
                <input type="text" required value={form.code} placeholder="WELCOME20" onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
              </div>
              <div className="field"><label className="field-label">Type</label>
                <select value={form.discountType} onChange={e => setForm(f => ({ ...f, discountType: e.target.value }))}>
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed amount (USD cents)</option>
                </select>
              </div>
              <div className="field"><label className="field-label">{form.discountType === 'percent' ? 'Percent (1–100)' : 'Cents off'}</label>
                <input type="number" min="1" value={form.discountValue} onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} />
              </div>
              <div className="field"><label className="field-label">Max uses (blank = unlimited)</label>
                <input type="number" min="1" value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))} />
              </div>
              <div className="field"><label className="field-label">Expires (blank = never)</label>
                <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
            <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
              <button type="submit" className="btn btn-admin btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create coupon'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="coupon-list">
        {coupons.map(c => (
          <div key={c.code} className="coupon-row">
            <div className="coupon-row-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="coupon-code" style={{ fontFamily: 'var(--mono)' }}>{c.code}</span>
                <span className={`badge badge-${c.active ? 'success' : 'neutral'}`}>{c.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="coupon-meta">
                {formatDiscount(c)} · {c.usedCount || 0}/{c.maxUses ?? '∞'} uses · Expires {formatExpiry(c.expiresAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`btn btn-sm ${c.active ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => handleToggle(c.code, c.active)}>
                {c.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
        {!coupons.length && <div className="empty">No coupons yet — create one above.</div>}
      </div>
    </div>
  );
}

/* ===================== DOMAIN BUILDER TAB ===================== */
function DomainBuilderTab({ notify }) {
  const [domains, setDomains] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Domain creation
  const [newDomName, setNewDomName] = useState('');
  const [newDomSummary, setNewDomSummary] = useState('');

  // Inline domain summary editing
  const [editingSummaryId, setEditingSummaryId] = useState(null);
  const [editingSummaryVal, setEditingSummaryVal] = useState('');

  // New sub-domain inline form
  const [newSubOpen, setNewSubOpen] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubSkills, setNewSubSkills] = useState([]);
  const [newSubInstrs, setNewSubInstrs] = useState([]);
  const [newSubSkillInput, setNewSubSkillInput] = useState('');
  const [newSubInstrInput, setNewSubInstrInput] = useState('');
  const [newSubError, setNewSubError] = useState('');

  // Sub-domain expand / rename
  const [expandedId, setExpandedId] = useState(null);
  const [renamingSubId, setRenamingSubId] = useState(null);
  const [renameSubVal, setRenameSubVal] = useState('');

  // Per-sub-domain inline add controls
  const [addSkillState, setAddSkillState] = useState({ subId: '', val: '' });
  const [addInstrState, setAddInstrState] = useState({ subId: '', val: '' });

  async function load() {
    setLoading(true);
    const data = await listDomainsAdmin();
    setDomains(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const dom = domains.find(d => d.id === selectedId) || null;

  function subCounts(d) {
    const total = (d.categories || []).length;
    const published = (d.categories || []).filter(c => c.status === 'published').length;
    return { total, published };
  }

  /* ── Domain-level actions ── */
  async function handleCreateDomain() {
    if (!newDomName.trim()) return;
    setSaving(true);
    await domainAdminAction('create', null, { name: newDomName.trim(), summary: newDomSummary.trim() });
    setNewDomName(''); setNewDomSummary('');
    await load(); setSaving(false);
    notify?.({ kind: 'good', title: 'Domain created', detail: newDomName });
  }

  async function handleDeleteDomain() {
    if (domains.length <= 1) { notify?.({ kind: 'warn', title: "Can't delete the only domain", detail: 'Create another domain first.' }); return; }
    if (!confirm(`Delete "${dom.name}"?`)) return;
    await domainAdminAction('delete', dom.id, {});
    setSelectedId(null); await load();
    notify?.({ kind: '', title: 'Domain deleted', detail: '' });
  }

  async function handleSaveSummary() {
    if (!editingSummaryId || !dom) return;
    await domainAdminAction('update', editingSummaryId, { summary: editingSummaryVal.trim() });
    setEditingSummaryId(null);
    await load();
  }

  async function handleToggleDomainPublish() {
    const newStatus = dom.status === 'published' ? 'draft' : 'published';
    await domainAdminAction('publish', dom.id, { status: newStatus });
    await load();
  }

  /* ── New sub-domain creation ── */
  function addNewSubSkill() {
    const v = newSubSkillInput.trim();
    if (!v || newSubSkills.includes(v)) return;
    setNewSubSkills(s => [...s, v]);
    setNewSubSkillInput('');
  }

  function addNewSubInstr() {
    const v = newSubInstrInput.trim();
    if (!v) return;
    setNewSubInstrs(s => [...s, v]);
    setNewSubInstrInput('');
  }

  async function handleCreateSubDomain() {
    if (!newSubName.trim()) { setNewSubError('Please enter a name for the sub-domain.'); return; }
    if (!newSubSkills.length) { setNewSubError('Add at least one skill before creating.'); return; }
    if (!newSubInstrs.length) { setNewSubError('Add at least one agent instruction before creating.'); return; }
    setNewSubError('');
    setSaving(true);
    const ts = Date.now();
    const newCat = {
      id: 'cat_' + ts,
      name: newSubName.trim(),
      status: 'draft',
      skills: newSubSkills.map((label, i) => ({ id: 'sk_' + ts + i, label, weight: 3 })),
      strongPoints: newSubInstrs.map((text, i) => ({ id: 'sp_' + ts + i, text })),
    };
    await domainAdminAction('update', dom.id, { categories: [...(dom.categories || []), newCat] });
    setNewSubName(''); setNewSubSkills([]); setNewSubInstrs([]);
    setNewSubSkillInput(''); setNewSubInstrInput('');
    setNewSubOpen(false); setSaving(false);
    await load();
    notify?.({ kind: 'good', title: 'Sub-domain created (draft)', detail: newCat.name });
  }

  /* ── Per-sub-domain actions ── */
  async function handleToggleSubPublish(cat) {
    const newStatus = cat.status === 'published' ? 'draft' : 'published';
    const cats = (dom.categories || []).map(c => c.id === cat.id ? { ...c, status: newStatus } : c);
    await domainAdminAction('update', dom.id, { categories: cats });
    await load();
  }

  async function handleDeleteSub(catId) {
    if (!confirm('Delete this sub-domain?')) return;
    const cats = (dom.categories || []).filter(c => c.id !== catId);
    await domainAdminAction('update', dom.id, { categories: cats });
    if (expandedId === catId) setExpandedId(null);
    await load();
    notify?.({ kind: '', title: 'Sub-domain deleted', detail: '' });
  }

  async function handleRenameSub(catId) {
    if (!renameSubVal.trim()) return;
    const cats = (dom.categories || []).map(c => c.id === catId ? { ...c, name: renameSubVal.trim() } : c);
    await domainAdminAction('update', dom.id, { categories: cats });
    setRenamingSubId(null); setRenameSubVal('');
    await load();
  }

  async function handleAddSkill(catId) {
    const v = addSkillState.subId === catId ? addSkillState.val.trim() : '';
    if (!v) return;
    setSaving(true);
    const cats = (dom.categories || []).map(c =>
      c.id === catId ? { ...c, skills: [...(c.skills || []), { id: 'sk_' + Date.now(), label: v, weight: 3 }] } : c
    );
    await domainAdminAction('update', dom.id, { categories: cats });
    setAddSkillState({ subId: catId, val: '' }); setSaving(false);
    await load();
  }

  async function handleDeleteSkill(catId, skillId) {
    const cats = (dom.categories || []).map(c =>
      c.id === catId ? { ...c, skills: (c.skills || []).filter(s => s.id !== skillId) } : c
    );
    await domainAdminAction('update', dom.id, { categories: cats });
    await load();
  }

  async function handleAddInstr(catId) {
    const v = addInstrState.subId === catId ? addInstrState.val.trim() : '';
    if (!v) return;
    setSaving(true);
    const cats = (dom.categories || []).map(c =>
      c.id === catId ? { ...c, strongPoints: [...(c.strongPoints || []), { id: 'sp_' + Date.now(), text: v }] } : c
    );
    await domainAdminAction('update', dom.id, { categories: cats });
    setAddInstrState({ subId: catId, val: '' }); setSaving(false);
    await load();
  }

  async function handleDeleteSp(catId, spId) {
    const cats = (dom.categories || []).map(c =>
      c.id === catId ? { ...c, strongPoints: (c.strongPoints || []).filter(s => s.id !== spId) } : c
    );
    await domainAdminAction('update', dom.id, { categories: cats });
    await load();
  }

  return (
    <div>
      <div className="admin-banner">🔒 Sub-domains, skills, and agent instructions are hidden from all users — only the domain name and summary are ever shown to them.</div>
      {loading ? <div className="loading"><span className="spinner" /> Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'start' }}>

          {/* ── LEFT: Domain list ── */}
          <div>
            <div className="card" style={{ marginBottom: 12, padding: 16 }}>
              <div className="panel-head"><h2>New domain</h2></div>
              <div className="field">
                <input type="text" placeholder="e.g. Software Engineering" value={newDomName}
                  onChange={e => setNewDomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateDomain()} />
              </div>
              <div className="field">
                <input type="text" placeholder="Summary (visible to users)" value={newDomSummary}
                  onChange={e => setNewDomSummary(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateDomain()} />
              </div>
              <button className="btn btn-admin btn-sm btn-full" disabled={saving || !newDomName.trim()} onClick={handleCreateDomain}>+ Create domain</button>
            </div>

            {!domains.length && <div className="empty">No domains yet</div>}
            {domains.map(d => {
              const { total, published } = subCounts(d);
              return (
                <div key={d.id} className="card"
                  style={{ marginBottom: 8, padding: '12px 14px', cursor: 'pointer', border: selectedId === d.id ? '1.5px solid var(--primary)' : '1px solid var(--border)' }}
                  onClick={() => { setSelectedId(d.id); setNewSubOpen(false); setExpandedId(null); }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ fontWeight: 650, fontSize: 13.5, color: 'var(--text)' }}>{d.name}</div>
                    <span className={`badge badge-${d.status === 'published' ? 'success' : 'neutral'}`}>{d.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>{d.summary}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                    {total === 0 ? 'No sub-domains' : `${published} / ${total} published`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── RIGHT: Domain detail ── */}
          {dom ? (
            <div>
              {/* Domain header card */}
              <div className="card" style={{ marginBottom: 14, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 5 }}>{dom.name}</div>
                    {/* Inline summary edit — click to edit, blur/Enter to save */}
                    {editingSummaryId === dom.id ? (
                      <input autoFocus type="text" value={editingSummaryVal}
                        onChange={e => setEditingSummaryVal(e.target.value)}
                        onBlur={handleSaveSummary}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSummary(); if (e.key === 'Escape') setEditingSummaryId(null); }}
                        style={{ fontSize: 12.5, width: '100%' }} />
                    ) : (
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'text' }}
                        title="Click to edit summary"
                        onClick={() => { setEditingSummaryId(dom.id); setEditingSummaryVal(dom.summary || ''); }}>
                        {dom.summary || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Click to add a summary…</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginLeft: 16, flexShrink: 0 }}>
                    <button className={`btn btn-sm ${dom.status === 'published' ? 'btn-ghost' : 'btn-admin'}`} onClick={handleToggleDomainPublish}>
                      {dom.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={handleDeleteDomain}>Delete</button>
                  </div>
                </div>
                <button className="btn btn-admin btn-sm"
                  onClick={() => { setNewSubOpen(v => !v); setNewSubError(''); setNewSubName(''); setNewSubSkills([]); setNewSubInstrs([]); setNewSubSkillInput(''); setNewSubInstrInput(''); }}>
                  {newSubOpen ? '✕ Cancel' : '+ New Sub-domain'}
                </button>
              </div>

              {/* New sub-domain inline form */}
              {newSubOpen && (
                <div className="card" style={{ marginBottom: 14, padding: 18, border: '1.5px solid var(--admin)' }}>
                  <div style={{ fontWeight: 650, fontSize: 14, color: 'var(--text)', marginBottom: 14 }}>New Sub-domain <span style={{ fontSize: 11, color: 'var(--admin)', fontWeight: 400 }}>(starts as Draft)</span></div>

                  <div className="field">
                    <label className="field-label">Name</label>
                    <input type="text" placeholder="e.g. Full Stack Developer" value={newSubName} onChange={e => setNewSubName(e.target.value)} />
                  </div>

                  {/* ① Skills — violet */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--primary)', marginBottom: 7 }}>
                      ① Strong Keywords / Skills
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>evidence matching</span>
                    </div>
                    <div className="chip-row" style={{ marginBottom: 8, minHeight: 28 }}>
                      {newSubSkills.map((s, i) => (
                        <div key={i} className="chip" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)', border: '1px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {s}
                          <span style={{ cursor: 'pointer', fontSize: 10, marginLeft: 2 }} onClick={() => setNewSubSkills(arr => arr.filter((_, j) => j !== i))}>✕</span>
                        </div>
                      ))}
                      {!newSubSkills.length && <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>No skills added yet</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="text" placeholder="Type a skill, press Enter or + Add" value={newSubSkillInput}
                        onChange={e => setNewSubSkillInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addNewSubSkill()}
                        style={{ flex: 1 }} />
                      <button className="btn btn-sm" style={{ color: 'var(--primary)', border: '1px solid var(--primary)', background: 'transparent' }} onClick={addNewSubSkill}>+ Add</button>
                    </div>
                  </div>

                  {/* ② Agent Instructions — amber */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--admin)', marginBottom: 7 }}>
                      🔒 ② Agent Instructions
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>writing directives — never shown to users</span>
                    </div>
                    {newSubInstrs.map((t, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', gap: 8 }}>
                        <span>{t}</span>
                        <span style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }} onClick={() => setNewSubInstrs(arr => arr.filter((_, j) => j !== i))}>✕</span>
                      </div>
                    ))}
                    {!newSubInstrs.length && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0 8px' }}>No instructions added yet</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <input type="text" placeholder="e.g. Lead with scale metrics (requests/sec, regions)" value={newSubInstrInput}
                        onChange={e => setNewSubInstrInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addNewSubInstr()}
                        style={{ flex: 1 }} />
                      <button className="btn btn-sm" style={{ color: 'var(--admin)', border: '1px solid var(--admin)', background: 'transparent' }} onClick={addNewSubInstr}>+ Add</button>
                    </div>
                  </div>

                  {newSubError && <div className="error-box" style={{ marginBottom: 10 }}>{newSubError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-admin btn-sm" disabled={saving} onClick={handleCreateSubDomain}>Create Sub-domain (Draft)</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setNewSubOpen(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Empty domain state */}
              {!dom.categories?.length && !newSubOpen && (
                <div className="empty-state" style={{ marginBottom: 12 }}>
                  <div className="empty-state-icon">🧩</div>
                  <div className="empty-state-title">No sub-domains yet</div>
                  <p>Add specializations like "Full Stack Developer", "React Developer", or "Java Developer" — each carries its own skill keywords and agent writing instructions.</p>
                </div>
              )}

              {/* Sub-domain cards */}
              {(dom.categories || []).map(cat => (
                <div key={cat.id} className="card domain-card" style={{ marginBottom: 12 }}>
                  {/* Collapsed header */}
                  <div className="domain-head" onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cat.status === 'published' ? 'var(--success)' : 'var(--text-muted)' }} />
                      <div>
                        <div className="domain-name" style={{ fontSize: 14 }}>
                          {expandedId === cat.id ? '▾' : '▸'} {cat.name}
                        </div>
                        <div className="domain-meta">{cat.skills?.length || 0} skills · {cat.strongPoints?.length || 0} agent instructions</div>
                      </div>
                    </div>
                    <span className={`badge badge-${cat.status === 'published' ? 'success' : 'neutral'}`} style={{ flexShrink: 0 }}>
                      {cat.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                  </div>

                  {/* Expanded body */}
                  {expandedId === cat.id && (
                    <div className="domain-body">
                      {/* Skills block — violet */}
                      <div className="cat-block">
                        <div className="cat-title" style={{ color: 'var(--primary)' }}>
                          Strong Keywords / Skills
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>evidence scoring</span>
                        </div>
                        <div className="chip-row" style={{ marginBottom: 8 }}>
                          {(cat.skills || []).map(s => (
                            <div key={s.id} className="chip" style={{ background: 'var(--primary-subtle)', color: 'var(--primary)', border: '1px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {s.label}
                              <span style={{ cursor: 'pointer', fontSize: 10 }} title="Remove" onClick={() => handleDeleteSkill(cat.id, s.id)}>✕</span>
                            </div>
                          ))}
                          {!cat.skills?.length && <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>No skills yet — add one below</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input type="text" placeholder="Type a skill, press Enter or + Add"
                            value={addSkillState.subId === cat.id ? addSkillState.val : ''}
                            onFocus={() => setAddSkillState(s => ({ ...s, subId: cat.id }))}
                            onChange={e => setAddSkillState({ subId: cat.id, val: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && handleAddSkill(cat.id)}
                            style={{ flex: 1 }} />
                          <button className="btn btn-sm" style={{ color: 'var(--primary)', border: '1px solid var(--primary)', background: 'transparent' }} disabled={saving} onClick={() => handleAddSkill(cat.id)}>+ Add</button>
                        </div>
                      </div>

                      {/* Instructions block — amber */}
                      <div className="cat-block">
                        <div className="cat-title lock-note">
                          🔒 Agent Instructions
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>writing directives — never shown to users</span>
                        </div>
                        {(cat.strongPoints || []).map(sp => (
                          <div key={sp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', gap: 8 }}>
                            <span>{sp.text}</span>
                            <button className="btn btn-xs btn-ghost" style={{ color: 'var(--danger)', flexShrink: 0 }} onClick={() => handleDeleteSp(cat.id, sp.id)}>✕</button>
                          </div>
                        ))}
                        {!cat.strongPoints?.length && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0 8px' }}>No instructions yet — add one below</div>}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <input type="text" placeholder="e.g. Lead with scale metrics (requests/sec, regions)"
                            value={addInstrState.subId === cat.id ? addInstrState.val : ''}
                            onFocus={() => setAddInstrState(s => ({ ...s, subId: cat.id }))}
                            onChange={e => setAddInstrState({ subId: cat.id, val: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && handleAddInstr(cat.id)}
                            style={{ flex: 1 }} />
                          <button className="btn btn-sm" style={{ color: 'var(--admin)', border: '1px solid var(--admin)', background: 'transparent' }} disabled={saving} onClick={() => handleAddInstr(cat.id)}>+ Add</button>
                        </div>
                      </div>

                      {/* Footer: Rename / Publish-Unpublish / Delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
                        {renamingSubId === cat.id ? (
                          <>
                            <input autoFocus type="text" value={renameSubVal}
                              onChange={e => setRenameSubVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameSub(cat.id); if (e.key === 'Escape') setRenamingSubId(null); }}
                              style={{ flex: 1, fontSize: 13 }} />
                            <button className="btn btn-sm btn-admin" onClick={() => handleRenameSub(cat.id)}>Save</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setRenamingSubId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-sm btn-ghost" onClick={() => { setRenamingSubId(cat.id); setRenameSubVal(cat.name); }}>Rename</button>
                            <button className={`btn btn-sm ${cat.status === 'published' ? 'btn-ghost' : 'btn-admin'}`} onClick={() => handleToggleSubPublish(cat)}>
                              {cat.status === 'published' ? 'Unpublish' : 'Publish'}
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteSub(cat.id)}>Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ paddingTop: 40 }}>Select a domain from the left to edit its sub-domains, skills, and agent instructions.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================== MAIN ADMIN VIEW ===================== */
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'domains', label: 'Domain Builder' },
  { key: 'system', label: 'System' },
];

export default function AdminView({ notify }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');

  if (user?.email !== ADMIN_EMAIL) {
    return <div className="empty-state" style={{ padding: 80 }}><h3>Access denied</h3><p>Admin access only.</p></div>;
  }

  return (
    <section>
      <h1 className="page-title">Admin Console</h1>
      <p className="page-sub">Platform management — restricted to authorized admins.</p>
      <div className="admin-banner">🛡 Admin session active · {user.email}</div>

      <div className="tabs" style={{ marginBottom: 24 }}>
        {TABS.map(t => (
          <div key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'domains' && <DomainBuilderTab notify={notify} />}
      {tab === 'system' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="panel-head"><h2>System information</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div>Firebase project: <strong style={{ color: 'var(--text)' }}>bhanu-resume-jd-project</strong></div>
            <div>LLM model: <strong style={{ color: 'var(--text)' }}>claude-sonnet-4-6</strong></div>
            <div>Functions: <strong style={{ color: 'var(--text)' }}>claudeProxy (minInstances:1), agentProxy</strong></div>
            <div>Node runtime: <strong style={{ color: 'var(--text)' }}>Node 20 (upgrade to 22 recommended)</strong></div>
            <div>Hosting: <strong style={{ color: 'var(--text)' }}>bhanu-resume-jd-project.web.app</strong></div>
          </div>
        </div>
      )}
    </section>
  );
}
