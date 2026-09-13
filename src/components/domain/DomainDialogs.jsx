import React, { useMemo, useState } from 'react';
import { Dialog, Drawer, StatusBadge, PriorityBadge, TemplateText } from './DomainPrimitives.jsx';

export function CreateDomainModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', description: '', icon: '📁' });
  const canCreate = form.name.trim().length > 0;
  function reset() { setForm({ name: '', description: '', icon: '📁' }); }
  return (
    <Dialog open={open} onClose={onClose} title="New domain" footer={
      <>
        <button className="dl-btn" onClick={onClose}>Cancel</button>
        <button className="dl-btn" disabled={!canCreate} onClick={() => { onCreate({ ...form, status: 'draft' }); reset(); }}>Create as Draft</button>
        {/* A brand-new domain can never pass publish validation (0 sub-domains). */}
        <span className="dl-tip-wrap">
          <button className="dl-btn dl-btn-primary" disabled title="A new domain needs at least 1 sub-domain, 3 skills and 1 instruction before it can be published">
            Create &amp; Publish
          </button>
        </span>
      </>
    }>
      <label className="dl-field"><span>Name *</span>
        <input className="dl-input" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Cybersecurity" /></label>
      <label className="dl-field"><span>Icon</span>
        <input className="dl-input" style={{ maxWidth: 90 }} value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} /></label>
      <label className="dl-field"><span>Description</span>
        <textarea className="dl-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="What kind of roles and work does this domain cover?" /></label>
    </Dialog>
  );
}

export function PublishDomainDialog({ open, onClose, domain, validation, counts, onPublish, onFixIssues }) {
  if (!domain) return null;
  return (
    <Dialog open={open} onClose={onClose} title={validation.ok ? 'Publish domain' : 'Not ready to publish'} footer={
      <>
        <button className="dl-btn" onClick={onClose}>Cancel</button>
        {validation.ok
          ? <button className="dl-btn dl-btn-primary" onClick={onPublish}>Publish Domain</button>
          : <button className="dl-btn dl-btn-primary" onClick={() => onFixIssues(validation.checks.find(c => !c.pass)?.tab)}>Fix Issues</button>}
      </>
    }>
      {validation.ok ? (
        <>
          <p className="dl-muted">Publishing makes this domain available to live resume tailoring.</p>
          <div className="dl-summary">
            <div><b>{counts.subDomains}</b><span>Sub-domains</span></div>
            <div><b>{counts.skills}</b><span>Skills</span></div>
            <div><b>{counts.bulletPoints}</b><span>Bullet points</span></div>
            <div><b>{counts.instructions}</b><span>Instructions</span></div>
          </div>
        </>
      ) : (
        <ul className="dl-checklist">
          {validation.checks.map(c => (
            <li key={c.id} className={c.pass ? 'pass' : 'fail'}>
              <span>{c.pass ? '✓' : '✕'}</span>{c.label}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function UnpublishDomainDialog({ open, onClose, onConfirm }) {
  return (
    <Dialog open={open} onClose={onClose} title="Unpublish domain" footer={
      <>
        <button className="dl-btn" onClick={onClose}>Cancel</button>
        <button className="dl-btn dl-btn-primary" onClick={onConfirm}>Unpublish</button>
      </>
    }>
      <p className="dl-muted">
        This domain will no longer be used for new AI resume tailoring or domain suggestions. Existing resumes will not be changed.
      </p>
    </Dialog>
  );
}

export function DeleteDomainDialog({ open, onClose, domain, counts, onConfirm }) {
  const [typed, setTyped] = useState('');
  // Case-sensitive exact match, not merely non-empty.
  const armed = domain && typed === domain.name;
  if (!domain) return null;
  return (
    <Dialog open={open} onClose={() => { setTyped(''); onClose(); }} title="Delete domain" footer={
      <>
        <button className="dl-btn" onClick={() => { setTyped(''); onClose(); }}>Cancel</button>
        <button className="dl-btn dl-btn-danger" disabled={!armed} onClick={() => { setTyped(''); onConfirm(); }}>Delete Domain</button>
      </>
    }>
      <p className="dl-muted">This permanently deletes:</p>
      <ul className="dl-dellist">
        <li><b>{counts.subDomains}</b> sub-domains</li>
        <li><b>{counts.skills}</b> skills</li>
        <li><b>{counts.bulletPoints}</b> bullet points</li>
        <li><b>{counts.instructions}</b> agent instructions</li>
      </ul>
      <label className="dl-field"><span>Type <b>{domain.name}</b> to confirm</span>
        <input className="dl-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder={domain.name} /></label>
    </Dialog>
  );
}

export function SubDomainDrawer({ open, onClose, domain, subDomain, onSave, skills = [], bullets = [], instructions = [] }) {
  const editing = Boolean(subDomain);
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState({ name: '', description: '', status: 'draft' });

  React.useEffect(() => {
    setForm(subDomain
      ? { name: subDomain.name, description: subDomain.description || '', status: subDomain.status }
      : { name: '', description: '', status: 'draft' });
    setTab('details');
  }, [subDomain, open]);

  // Name is the only hard requirement — imported sub-domains can arrive without
  // a description, and blocking Save on those made them uneditable.
  const valid = form.name.trim();

  const scoped = useMemo(() => {
    if (!subDomain) return { skills: [], bullets: [], instructions: [] };
    const mine = list => list.filter(x => x.subDomainId === subDomain.id);
    return { skills: mine(skills), bullets: mine(bullets), instructions: mine(instructions) };
  }, [subDomain, skills, bullets, instructions]);

  const counts = { skills: scoped.skills.length, bullets: scoped.bullets.length, instructions: scoped.instructions.length };

  return (
    <Drawer open={open} onClose={onClose}
      title={editing ? 'Edit sub-domain' : 'New sub-domain'}
      subtitle={domain?.name}
      footer={
        <>
          <button className="dl-btn" onClick={onClose}>Cancel</button>
          <button className="dl-btn" disabled={!valid} onClick={() => onSave({ ...form, status: 'draft' })}>Save Draft</button>
          <button className="dl-btn dl-btn-primary" disabled={!valid} onClick={() => onSave({ ...form, status: 'published' })}>Publish</button>
        </>
      }>
      <div className="dl-subtabs">
        {['details', 'skills', 'bullets', 'instructions'].map(t => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'details' ? 'Details' : t === 'skills' ? 'Skills' : t === 'bullets' ? 'Bullet Points' : 'Agent Instructions'}
            {editing && t !== 'details' && <span className="dl-subtab-count">{counts[t === 'bullets' ? 'bullets' : t]}</span>}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <>
          {/* Read-only: moving a sub-domain between domains is a separate action. */}
          <label className="dl-field"><span>Parent domain</span>
            <input className="dl-input" value={domain?.name || ''} readOnly disabled /></label>
          <label className="dl-field"><span>Name *</span>
            <input className="dl-input" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Checkout & Payments" /></label>
          <label className="dl-field"><span>Description</span>
            <textarea className="dl-input" rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What work does this speciality cover?" /></label>
          <p className="dl-hint">Recommended — the agent uses this to decide when the sub-domain applies.</p>
        </>
      )}

      {tab !== 'details' && !editing && (
        <div className="dl-drawer-placeholder">Save this sub-domain first, then add scoped content here.</div>
      )}

      {tab === 'skills' && editing && (
        scoped.skills.length === 0
          ? <div className="dl-drawer-placeholder">No skills scoped to this sub-domain yet. Add them from the Skills tab.</div>
          : <ScopedList items={scoped.skills} render={s => (
              <>
                <span className="dl-strong">{s.name}</span>
                <span className="dl-badge muted">{s.category}</span>
                <PriorityBadge value={s.priority} />
                <StatusBadge status={s.status} />
              </>
            )} />
      )}

      {tab === 'bullets' && editing && (
        scoped.bullets.length === 0
          ? <div className="dl-drawer-placeholder">No bullet points scoped to this sub-domain yet. Add them from the Bullet Points tab.</div>
          : <div className="dl-stack-sm">
              {scoped.bullets.map(b => (
                <article className="dl-scoped-bullet" key={b.id}>
                  <p className="dl-bullet-text"><TemplateText text={b.text} /></p>
                  <div className="dl-row-gap dl-wrap">
                    <span className="dl-badge neutral">{b.category}</span>
                    <PriorityBadge value={b.priority} />
                    <StatusBadge status={b.status} />
                  </div>
                  {b.evidenceRequirement && <div className="dl-usage-note"><b>Agent usage:</b> {b.evidenceRequirement}</div>}
                </article>
              ))}
            </div>
      )}

      {tab === 'instructions' && editing && (
        scoped.instructions.length === 0
          ? <div className="dl-drawer-placeholder">No instructions are scoped to this sub-domain. Domain-wide instructions still apply — see the Agent Instructions tab.</div>
          : <ScopedList items={scoped.instructions} render={i => (
              <>
                <span className="dl-instr-text">{i.instruction}</span>
                <span className="dl-badge neutral">{i.category}</span>
                <StatusBadge status={i.status} />
              </>
            )} />
      )}
    </Drawer>
  );
}

function ScopedList({ items, render }) {
  return (
    <ul className="dl-scoped-list">
      {items.map(it => <li key={it.id}>{render(it)}</li>)}
    </ul>
  );
}

/* Live-parses on every keystroke: trim, drop blanks, case-insensitive dedupe. */
export function AddSkillsModal({ open, onClose, subDomains, onAdd }) {
  const [raw, setRaw] = useState('');
  const [meta, setMeta] = useState({ category: 'Primary Skills', priority: 'medium', subDomainId: '', evidenceWeight: 'moderate' });

  const parsed = useMemo(() => {
    const lines = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const unique = [];
    for (const l of lines) {
      const k = l.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); unique.push(l);
    }
    return { unique, duplicates: lines.length - unique.length };
  }, [raw]);

  return (
    <Dialog open={open} onClose={onClose} title="Add skills" width={520} footer={
      <>
        <button className="dl-btn" onClick={onClose}>Cancel</button>
        <button className="dl-btn dl-btn-primary" disabled={!parsed.unique.length}
          onClick={() => { onAdd(parsed.unique, meta); setRaw(''); }}>
          Add {parsed.unique.length} Skill{parsed.unique.length === 1 ? '' : 's'}
        </button>
      </>
    }>
      <label className="dl-field"><span>Paste skills — one per line, or comma separated</span>
        <textarea className="dl-input" rows={7} autoFocus value={raw} onChange={e => setRaw(e.target.value)}
          placeholder={'Kubernetes\nTerraform\nPostgreSQL'} /></label>
      <div className="dl-parse-line">
        <b>{parsed.unique.length}</b> skill{parsed.unique.length === 1 ? '' : 's'} detected
        {parsed.duplicates > 0 && <> · <b>{parsed.duplicates}</b> duplicate{parsed.duplicates === 1 ? '' : 's'} removed</>}
      </div>
      <div className="dl-field-row">
        <label className="dl-field"><span>Category</span>
          <select className="dl-input" value={meta.category} onChange={e => setMeta(m => ({ ...m, category: e.target.value }))}>
            {['Primary Skills', 'Platforms', 'Analytics', 'Payments', 'Operations', 'Compliance', 'Billing'].map(c => <option key={c}>{c}</option>)}
          </select></label>
        <label className="dl-field"><span>Priority</span>
          <select className="dl-input" value={meta.priority} onChange={e => setMeta(m => ({ ...m, priority: e.target.value }))}>
            <option value="critical">Critical</option><option value="high">High</option>
            <option value="medium">Medium</option><option value="low">Low</option>
          </select></label>
      </div>
      <div className="dl-field-row">
        <label className="dl-field"><span>Sub-domain</span>
          <select className="dl-input" value={meta.subDomainId} onChange={e => setMeta(m => ({ ...m, subDomainId: e.target.value }))}>
            <option value="">Domain-wide</option>
            {subDomains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="dl-field"><span>Evidence weight</span>
          <select className="dl-input" value={meta.evidenceWeight} onChange={e => setMeta(m => ({ ...m, evidenceWeight: e.target.value }))}>
            <option value="strong">Strong</option><option value="moderate">Moderate</option><option value="weak">Weak</option>
          </select></label>
      </div>
    </Dialog>
  );
}

export function BulletPointDrawer({ open, onClose, bullet, subDomains, onSave }) {
  const [form, setForm] = useState({ text: '', category: 'Achievement', subDomainId: '', priority: 'medium', evidenceRequirement: '', status: 'draft' });
  React.useEffect(() => {
    setForm(bullet
      ? { ...bullet, subDomainId: bullet.subDomainId || '' }
      : { text: '', category: 'Achievement', subDomainId: '', priority: 'medium', evidenceRequirement: '', status: 'draft' });
  }, [bullet, open]);
  const valid = form.text.trim().length > 0;
  return (
    <Drawer open={open} onClose={onClose} title={bullet ? 'Edit bullet point' : 'New bullet point'}
      footer={
        <>
          <button className="dl-btn" onClick={onClose}>Cancel</button>
          <button className="dl-btn" disabled={!valid} onClick={() => onSave({ ...form, status: 'draft' })}>Save Draft</button>
          <button className="dl-btn dl-btn-primary" disabled={!valid} onClick={() => onSave({ ...form, status: 'published' })}>Publish</button>
        </>
      }>
      <label className="dl-field"><span>Template *</span>
        <textarea className="dl-input" rows={4} autoFocus value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
          placeholder="Reduced checkout drop-off from [before]% to [after]% across [N]M sessions." /></label>
      <div className="dl-hint">Wrap agent-filled values in square brackets, e.g. <code>[N]</code>, <code>[platform]</code>.</div>
      <div className="dl-field-row">
        <label className="dl-field"><span>Category</span>
          <select className="dl-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {['Achievement', 'Leadership', 'Delivery', 'Technical', 'Product Impact'].map(c => <option key={c}>{c}</option>)}
          </select></label>
        <label className="dl-field"><span>Priority</span>
          <select className="dl-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select></label>
      </div>
      <label className="dl-field"><span>Sub-domain</span>
        <select className="dl-input" value={form.subDomainId} onChange={e => setForm(f => ({ ...f, subDomainId: e.target.value }))}>
          <option value="">Domain-wide</option>
          {subDomains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      <label className="dl-field"><span>Evidence requirement</span>
        <textarea className="dl-input" rows={3} value={form.evidenceRequirement} onChange={e => setForm(f => ({ ...f, evidenceRequirement: e.target.value }))}
          placeholder="Use only when the candidate has real conversion figures." /></label>
    </Drawer>
  );
}

export function InstructionDrawer({ open, onClose, instruction, domain, subDomains, onSave }) {
  const [form, setForm] = useState({ instruction: '', category: 'Content Priority', priority: 'medium', subDomainId: '', status: 'active' });
  React.useEffect(() => {
    setForm(instruction
      ? { ...instruction, subDomainId: instruction.subDomainId || '' }
      : { instruction: '', category: 'Content Priority', priority: 'medium', subDomainId: '', status: 'active' });
  }, [instruction, open]);
  const valid = form.instruction.trim().length > 0;
  return (
    <Drawer open={open} onClose={onClose} title={instruction ? 'Edit instruction' : 'New instruction'}
      footer={
        <>
          <button className="dl-btn" onClick={onClose}>Cancel</button>
          <button className="dl-btn dl-btn-primary" disabled={!valid} onClick={() => {
            const sub = subDomains.find(s => s.id === form.subDomainId);
            onSave({ ...form, appliesTo: sub ? sub.name : domain.name });
          }}>Save</button>
        </>
      }>
      <label className="dl-field"><span>Instruction *</span>
        <textarea className="dl-input" rows={4} autoFocus value={form.instruction} onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))}
          placeholder="Lead every bullet with a conversion or revenue metric where evidence supports it." /></label>
      <div className="dl-field-row">
        <label className="dl-field"><span>Category</span>
          <select className="dl-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {['Content Priority', 'Leadership', 'Technical', 'Risk & Quality', 'Product Impact'].map(c => <option key={c}>{c}</option>)}
          </select></label>
        <label className="dl-field"><span>Priority</span>
          <select className="dl-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select></label>
      </div>
      <div className="dl-field-row">
        <label className="dl-field"><span>Applies to</span>
          <select className="dl-input" value={form.subDomainId} onChange={e => setForm(f => ({ ...f, subDomainId: e.target.value }))}>
            <option value="">Whole domain</option>
            {subDomains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="dl-field"><span>Status</span>
          <select className="dl-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option><option value="disabled">Disabled</option>
          </select></label>
      </div>
    </Drawer>
  );
}
