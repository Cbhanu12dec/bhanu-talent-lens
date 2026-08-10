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
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [newName, setNewName] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newSkill, setNewSkill] = useState({ catId: '', label: '', weight: 3 });
  const [newSp, setNewSp] = useState({ catId: '', text: '' });

  async function load() {
    setLoading(true);
    const data = await listDomainsAdmin();
    setDomains(data);
    if (selected) setSelected(data.find(d => d.id === selected.id) || null);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    await domainAdminAction('create', null, { name: newName.trim(), summary: newSummary.trim() });
    setNewName(''); setNewSummary(''); await load(); setSaving(false);
    notify?.({ kind: 'good', title: 'Domain created', detail: newName });
  }

  async function handlePublish(dom) {
    const newStatus = dom.status === 'published' ? 'draft' : 'published';
    await domainAdminAction('publish', dom.id, { status: newStatus });
    await load();
  }

  async function handleDelete(dom) {
    if (!confirm(`Delete "${dom.name}"?`)) return;
    await domainAdminAction('delete', dom.id, {});
    setSelected(null); await load();
  }

  async function handleAddCat() {
    if (!newCat.trim() || !selected) return;
    setSaving(true);
    const cats = [...(selected.categories || []), { id: 'cat_' + Date.now(), name: newCat.trim(), skills: [], strongPoints: [] }];
    await domainAdminAction('update', selected.id, { categories: cats });
    setNewCat(''); await load(); setSaving(false);
  }

  async function handleAddSkill() {
    if (!newSkill.label.trim() || !newSkill.catId || !selected) return;
    setSaving(true);
    const cats = (selected.categories || []).map(c =>
      c.id === newSkill.catId ? { ...c, skills: [...(c.skills || []), { id: 'sk_' + Date.now(), label: newSkill.label.trim(), weight: newSkill.weight }] } : c
    );
    await domainAdminAction('update', selected.id, { categories: cats });
    setNewSkill(s => ({ ...s, label: '' })); await load(); setSaving(false);
  }

  async function handleDeleteSkill(catId, skillId) {
    const cats = (selected.categories || []).map(c =>
      c.id === catId ? { ...c, skills: (c.skills || []).filter(s => s.id !== skillId) } : c
    );
    await domainAdminAction('update', selected.id, { categories: cats });
    await load();
  }

  async function handleAddSp() {
    if (!newSp.text.trim() || !newSp.catId || !selected) return;
    setSaving(true);
    const cats = (selected.categories || []).map(c =>
      c.id === newSp.catId ? { ...c, strongPoints: [...(c.strongPoints || []), { id: 'sp_' + Date.now(), text: newSp.text.trim() }] } : c
    );
    await domainAdminAction('update', selected.id, { categories: cats });
    setNewSp(s => ({ ...s, text: '' })); await load(); setSaving(false);
  }

  async function handleDeleteSp(catId, spId) {
    const cats = (selected.categories || []).map(c =>
      c.id === catId ? { ...c, strongPoints: (c.strongPoints || []).filter(s => s.id !== spId) } : c
    );
    await domainAdminAction('update', selected.id, { categories: cats });
    await load();
  }

  const dom = selected ? domains.find(d => d.id === selected.id) || selected : null;

  return (
    <div>
      <div className="admin-banner">🔒 Sub-domains, skills and style directives are hidden from all users — only the domain name and summary are ever shown to them.</div>
      {loading ? <div className="loading"><span className="spinner" /> Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, alignItems: 'start' }}>
          {/* Domain list */}
          <div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="panel-head"><h2>New domain</h2></div>
              <div className="field"><input type="text" placeholder="e.g. Software Engineering" value={newName} onChange={e => setNewName(e.target.value)} /></div>
              <div className="field"><input type="text" placeholder="Summary (visible to users)" value={newSummary} onChange={e => setNewSummary(e.target.value)} /></div>
              <button className="btn btn-admin btn-sm btn-full" disabled={saving} onClick={handleCreate}>+ Create</button>
              <p className="field-hint" style={{ marginTop: 8 }}>A domain is a broad field. Add sub-domains like "Full Stack Developer" or "React Developer" once it's created.</p>
            </div>
            {domains.map(d => (
              <div key={d.id} className="card" style={{ marginBottom: 8, cursor: 'pointer', border: dom?.id === d.id ? '1.5px solid var(--primary)' : undefined, padding: 14 }} onClick={() => setSelected(d)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>{d.name}</div>
                  <span className={`badge badge-${d.status === 'published' ? 'success' : 'neutral'}`}>{d.status}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{d.summary}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>{(d.categories || []).length} sub-domain{(d.categories || []).length === 1 ? '' : 's'}</div>
              </div>
            ))}
            {!domains.length && <div className="empty">No domains yet</div>}
          </div>

          {/* Domain detail */}
          {dom ? (
            <div>
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{dom.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{dom.summary}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={`btn btn-sm ${dom.status === 'published' ? 'btn-ghost' : 'btn-admin'}`} onClick={() => handlePublish(dom)}>
                      {dom.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(dom)}>Delete</button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="e.g. Full Stack Developer, React Developer, Java Developer…" value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCat()} />
                  <button className="btn btn-sm" disabled={saving} onClick={handleAddCat}>+ Sub-domain</button>
                </div>
                <p className="field-hint" style={{ marginTop: 8 }}>
                  Sub-domains are specializations within <strong>{dom.name}</strong> — each gets its own tech skills and style directives the Agent draws on when it builds a resume for that specialty.
                </p>
              </div>

              {!dom.categories?.length && (
                <div className="empty-state" style={{ marginBottom: 12 }}>
                  <div className="empty-state-icon">🧩</div>
                  <div className="empty-state-title">No sub-domains yet</div>
                  <p>Add specializations like "Full Stack Developer" or "React Developer" above — each one carries its own skill set and positioning guidance.</p>
                </div>
              )}

              {(dom.categories || []).map(cat => (
                <div key={cat.id} className="card domain-card" style={{ marginBottom: 12 }}>
                  <div className="domain-head" onClick={() => setExpanded(expanded === cat.id ? null : cat.id)}>
                    <div>
                      <div className="domain-name">{expanded === cat.id ? '▾' : '▸'} {cat.name}</div>
                      <div className="domain-meta">Sub-domain of {dom.name} · {cat.skills?.length || 0} skills · {cat.strongPoints?.length || 0} style directives</div>
                    </div>
                  </div>
                  {expanded === cat.id && (
                    <div className="domain-body">
                      {/* Skills */}
                      <div className="cat-block">
                        <div className="cat-title">Skills <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(used for evidence scoring)</span></div>
                        <div className="chip-row" style={{ marginBottom: 8 }}>
                          {(cat.skills || []).map(s => (
                            <div key={s.id} className="chip editable" onClick={() => handleDeleteSkill(cat.id, s.id)} title="Click to remove">
                              {s.label}<span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 3 }}>w{s.weight}</span> <span className="x">✕</span>
                            </div>
                          ))}
                          {!cat.skills?.length && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No skills yet</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input type="text" placeholder="Skill label" value={newSkill.catId === cat.id ? newSkill.label : ''} onFocus={() => setNewSkill(s => ({ ...s, catId: cat.id }))} onChange={e => setNewSkill(s => ({ ...s, catId: cat.id, label: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAddSkill()} style={{ flex: 1 }} />
                          <select value={newSkill.catId === cat.id ? newSkill.weight : 3} onChange={e => setNewSkill(s => ({ ...s, catId: cat.id, weight: Number(e.target.value) }))} style={{ width: 70 }}>
                            {[1,2,3,4,5].map(w => <option key={w} value={w}>w:{w}</option>)}
                          </select>
                          <button className="btn btn-sm" disabled={saving} onClick={handleAddSkill}>+ Skill</button>
                        </div>
                      </div>

                      {/* Strong Points */}
                      <div className="cat-block">
                        <div className="cat-title lock-note">🔒 Style directives <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>(AI writing instructions — never shown to users)</span></div>
                        {(cat.strongPoints || []).map(sp => (
                          <div key={sp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)', gap: 8 }}>
                            <span>{sp.text}</span>
                            <button className="btn btn-xs btn-ghost" style={{ color: 'var(--danger)', flexShrink: 0 }} onClick={() => handleDeleteSp(cat.id, sp.id)}>✕</button>
                          </div>
                        ))}
                        {!cat.strongPoints?.length && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No directives yet</div>}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <input type="text" placeholder="e.g. Lead with scale metrics (requests/sec, regions)" value={newSp.catId === cat.id ? newSp.text : ''} onFocus={() => setNewSp(s => ({ ...s, catId: cat.id }))} onChange={e => setNewSp(s => ({ ...s, catId: cat.id, text: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAddSp()} style={{ flex: 1 }} />
                          <button className="btn btn-sm" disabled={saving} onClick={handleAddSp}>+ Point</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!dom.categories?.length && null}
            </div>
          ) : (
            <div className="empty">Select a domain to edit its sub-domains, skills, and style directives.</div>
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
