import React, { useEffect, useMemo, useState } from 'react';
import { domainLibraryApi } from '../../lib/domainLibraryApi.js';
import {
  Skeleton, EmptyState, StatusBadge, PriorityBadge, Drawer, Menu, TemplateText,
} from './DomainPrimitives.jsx';

const fmt = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/* Rendered only when at least one row is selected. Shared by Sub-Domains and
   Skills — §4 Phase D explicitly forbids a second implementation. */
export function BulkActionBar({ selectedCount, onPublish, onUnpublish, onArchive, onDelete }) {
  if (!selectedCount) return null;
  return (
    <div className="dl-bulkbar">
      <span className="dl-bulkbar-count">{selectedCount} selected</span>
      <button className="dl-btn dl-btn-sm" onClick={onPublish}>Publish</button>
      <button className="dl-btn dl-btn-sm" onClick={onUnpublish}>Unpublish</button>
      <button className="dl-btn dl-btn-sm" onClick={onArchive}>Archive</button>
      <button className="dl-btn dl-btn-sm dl-btn-danger" onClick={onDelete}>Delete</button>
    </div>
  );
}

/* ===================== PHASE B — OVERVIEW ===================== */
export function DomainOverview({ domain, subDomains, loading, onEdit, onGoToTab, onAddSubDomain }) {
  const [q, setQ] = useState('');
  const preview = useMemo(() => {
    const sorted = [...subDomains].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
    const needle = q.trim().toLowerCase();
    return needle ? sorted.filter(s => s.name.toLowerCase().includes(needle)) : sorted;
  }, [subDomains, q]);

  return (
    <div className="dl-stack">
      <section className="dl-card">
        <div className="dl-card-head">
          <h3>Domain details</h3>
          <button className="dl-btn dl-btn-sm" onClick={onEdit}>Edit</button>
        </div>
        <dl className="dl-defs">
          <div><dt>Name</dt><dd>{domain.name}</dd></div>
          <div><dt>Status</dt><dd><StatusBadge status={domain.status} /></dd></div>
          <div><dt>Created</dt><dd>{fmt(domain.createdAt)}</dd></div>
          <div><dt>Last updated</dt><dd>{fmt(domain.updatedAt)}</dd></div>
          <div className="dl-defs-wide"><dt>Created by</dt><dd>{domain.createdBy}</dd></div>
          <div className="dl-defs-wide"><dt>Description</dt><dd>{domain.description || <span className="dl-muted">No description yet</span>}</dd></div>
        </dl>
      </section>

      <section className="dl-card dl-tips">
        <div className="dl-card-head"><h3>How the agent uses this domain</h3></div>
        <ul>
          <li><b>Skills</b> are matched against a candidate's evidence to score fit — they never get claimed on their own.</li>
          <li><b>Bullet points</b> are templates; bracketed placeholders are only filled when real evidence supports them.</li>
          <li><b>Agent instructions</b> shape tone and emphasis, and are never shown to end users.</li>
          <li>Only <b>published</b> sub-domains, skills and bullets reach live tailoring — drafts stay internal.</li>
        </ul>
      </section>

      <section className="dl-card">
        <div className="dl-card-head">
          <h3>Sub-domains</h3>
          <div className="dl-row-gap">
            <input className="dl-input dl-input-sm" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            <button className="dl-btn dl-btn-sm dl-btn-primary" onClick={onAddSubDomain}>+ Add Sub-Domain</button>
          </div>
        </div>

        {loading ? (
          <div className="dl-stack-sm">{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={34} r={8} />)}</div>
        ) : preview.length === 0 ? (
          <EmptyState compact icon="🧩" title="No sub-domains yet"
            text="Sub-domains are the specialities inside this domain — each carries its own skills and guidance."
            actionLabel="+ Add Sub-Domain" onAction={onAddSubDomain} />
        ) : (
          <>
            <table className="dl-table">
              <thead><tr><th>Name</th><th>Description</th><th>Skills</th><th>Bullets</th><th>Status</th></tr></thead>
              <tbody>
                {preview.map(s => (
                  <tr key={s.id}>
                    <td className="dl-strong">{s.name}</td>
                    <td className="dl-muted dl-clip">{s.description}</td>
                    <td>{s.counts.skills}</td>
                    <td>{s.counts.bulletPoints}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="dl-link" onClick={() => onGoToTab('sub-domains')}>View all sub-domains →</button>
          </>
        )}
      </section>
    </div>
  );
}

/* ===================== PHASE C — SUB-DOMAINS ===================== */
export function SubDomainsWorkspace({ domain, subDomains, loading, reload, onEdit, onCreate }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('list');
  const [selected, setSelected] = useState(new Set());
  const [menuFor, setMenuFor] = useState(null);

  const rows = useMemo(() => {
    let out = subDomains;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(needle));
    if (status !== 'all') out = out.filter(s => s.status === status);
    return [...out].sort((a, b) => sortBy === 'name'
      ? a.name.localeCompare(b.name)
      : sortBy === 'skills' ? b.counts.skills - a.counts.skills
      : new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [subDomains, q, status, sortBy]);

  const toggle = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id));

  async function bulk(patch) {
    await domainLibraryApi.bulkUpdateSubDomains(domain.id, [...selected], patch);
    setSelected(new Set()); reload();
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} sub-domain${selected.size === 1 ? '' : 's'}? This also deletes their skills, bullet points, and instructions.`)) return;
    await domainLibraryApi.deleteSubDomains(domain.id, [...selected]);
    setSelected(new Set()); reload();
  }

  return (
    <div className="dl-stack">
      <div className="dl-toolbar">
        <input className="dl-input" placeholder="Search sub-domains…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="dl-input dl-input-sm" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="published">Published</option>
          <option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
        <select className="dl-input dl-input-sm" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="recent">Last updated</option><option value="name">Name</option><option value="skills">Most skills</option>
        </select>
        <div className="dl-seg">
          <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>List</button>
          <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')}>Grid</button>
        </div>
        <button className="dl-btn dl-btn-primary dl-push" onClick={onCreate}>+ New Sub-Domain</button>
      </div>

      <BulkActionBar
        selectedCount={selected.size}
        onPublish={() => bulk({ status: 'published' })}
        onUnpublish={() => bulk({ status: 'draft' })}
        onArchive={() => bulk({ status: 'archived' })}
        onDelete={bulkDelete}
      />

      {loading ? (
        <div className="dl-card dl-stack-sm">{[0, 1, 2, 3].map(i => <Skeleton key={i} w="100%" h={38} r={8} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon="🧩" title="No sub-domains match"
          text={q || status !== 'all' ? 'Try clearing the search or status filter.' : 'Add the first speciality inside this domain.'}
          actionLabel="+ New Sub-Domain" onAction={onCreate} />
      ) : viewMode === 'grid' ? (
        <div className="dl-grid">
          {rows.map(s => (
            <div className="dl-card dl-subcard" key={s.id}>
              <div className="dl-row">
                <span className="dl-strong">{s.name}</span>
                <StatusBadge status={s.status} />
              </div>
              <p className="dl-muted">{s.description}</p>
              <div className="dl-meta-row">
                <span>{s.counts.skills} skills</span><span>{s.counts.bulletPoints} bullets</span><span>{s.counts.instructions} instructions</span>
              </div>
              <button className="dl-btn dl-btn-sm" onClick={() => onEdit(s)}>Edit</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dl-card dl-card-flush">
          <table className="dl-table">
            <thead>
              <tr>
                <th className="dl-check"><input type="checkbox" checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)))} /></th>
                <th>Name</th><th>Description</th><th>Skills</th><th>Bullets</th><th>Instr.</th>
                <th>Status</th><th>Updated</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className={selected.has(s.id) ? 'sel' : ''}>
                  <td className="dl-check"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                  <td className="dl-strong">{s.name}</td>
                  <td className="dl-muted dl-clip">{s.description}</td>
                  <td>{s.counts.skills}</td>
                  <td>{s.counts.bulletPoints}</td>
                  <td>{s.counts.instructions}</td>
                  {/* Independent of the parent domain's status — never derived. */}
                  <td><StatusBadge status={s.status} /></td>
                  <td className="dl-muted">{fmt(s.updatedAt)}</td>
                  <td className="dl-rel">
                    <button className="dl-icon-btn" onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}>•••</button>
                    {menuFor === s.id && (
                      <Menu onClose={() => setMenuFor(null)} items={[
                        { label: 'Edit', run: () => onEdit(s) },
                        { label: s.status === 'published' ? 'Unpublish' : 'Publish', run: async () => { await domainLibraryApi.updateSubDomain(domain.id, s.id, { status: s.status === 'published' ? 'draft' : 'published' }); reload(); } },
                        { label: 'Duplicate', run: async () => { await domainLibraryApi.createSubDomain({ domainId: domain.id, name: `${s.name} (copy)`, description: s.description }); reload(); } },
                        { label: 'Archive', run: async () => { await domainLibraryApi.updateSubDomain(domain.id, s.id, { status: 'archived' }); reload(); } },
                        { sep: true },
                        { label: 'Delete', danger: true, run: async () => { await domainLibraryApi.deleteSubDomains(domain.id, [s.id]); reload(); } },
                      ]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ===================== PHASE D — SKILLS ===================== */
const PREVIEW_LIMIT = 8;

export function SkillsWorkspace({ domain, skills, subDomains, loading, reload, onAdd }) {
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('all');
  const [sub, setSub] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('priority');
  const [expanded, setExpanded] = useState(new Set());
  const [selected, setSelected] = useState(new Set());

  const filtered = useMemo(() => {
    let out = skills;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter(s => s.name.toLowerCase().includes(needle));
    if (priority !== 'all') out = out.filter(s => s.priority === priority);
    if (sub !== 'all') out = out.filter(s => s.subDomainId === sub);
    if (status !== 'all') out = out.filter(s => s.status === status);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...out].sort((a, b) => sortBy === 'alphabetical' ? a.name.localeCompare(b.name)
      : sortBy === 'usage' ? b.usageScore - a.usageScore
      : rank[a.priority] - rank[b.priority]);
  }, [skills, q, priority, sub, status, sortBy]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const s of filtered) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category).push(s);
    }
    return [...m.entries()];
  }, [filtered]);

  const subName = id => subDomains.find(s => s.id === id)?.name || '—';
  const toggleSel = id => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  async function bulk(patch) {
    await domainLibraryApi.bulkUpdateSkills(domain.id, [...selected], patch);
    setSelected(new Set()); reload();
  }

  return (
    <div className="dl-stack">
      <div className="dl-toolbar">
        <input className="dl-input" placeholder="Search skills…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="dl-input dl-input-sm" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="all">All priorities</option><option value="critical">Critical</option>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="dl-input dl-input-sm" value={sub} onChange={e => setSub(e.target.value)}>
          <option value="all">All sub-domains</option>
          {subDomains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="dl-input dl-input-sm" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="published">Published</option>
          <option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
        <select className="dl-input dl-input-sm" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="priority">Priority</option><option value="alphabetical">A–Z</option><option value="usage">Usage</option>
        </select>
        <button className="dl-btn dl-btn-primary dl-push" onClick={onAdd}>+ Add Skills</button>
      </div>

      <BulkActionBar
        selectedCount={selected.size}
        onPublish={() => bulk({ status: 'published' })}
        onUnpublish={() => bulk({ status: 'draft' })}
        onArchive={() => bulk({ status: 'archived' })}
        onDelete={async () => { await domainLibraryApi.deleteSkills(domain.id, [...selected]); setSelected(new Set()); reload(); }}
      />

      {loading ? (
        <div className="dl-card dl-stack-sm">{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={56} r={10} />)}</div>
      ) : grouped.length === 0 ? (
        <EmptyState icon="◈" title="No skills match" text="Adjust the filters, or add skills to this domain."
          actionLabel="+ Add Skills" onAction={onAdd} />
      ) : grouped.map(([category, items]) => {
        const isOpen = expanded.has(category);
        const preview = items.slice(0, PREVIEW_LIMIT);
        const more = items.length - preview.length;
        return (
          <section className="dl-card" key={category}>
            <div className="dl-card-head">
              <div>
                <div className="dl-eyebrow">{category}</div>
                <div className="dl-muted dl-sm">{items.length} skill{items.length === 1 ? '' : 's'}</div>
              </div>
              <button className="dl-link" onClick={() => setExpanded(prev => {
                const n = new Set(prev); n.has(category) ? n.delete(category) : n.add(category); return n;
              })}>{isOpen ? 'Collapse' : 'View all →'}</button>
            </div>

            {/* Never a flat wall of every skill — preview truncates at 8. */}
            {!isOpen ? (
              <p className="dl-preview-line">
                {preview.map(s => s.name).join(' · ')}
                {more > 0 && <span className="dl-more"> +{more} more</span>}
              </p>
            ) : (
              <table className="dl-table">
                <thead><tr><th className="dl-check" /><th>Skill</th><th>Priority</th><th>Sub-domain</th><th>Evidence</th><th>Status</th><th>Usage</th></tr></thead>
                <tbody>
                  {items.map(s => (
                    <tr key={s.id} className={selected.has(s.id) ? 'sel' : ''}>
                      <td className="dl-check"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSel(s.id)} /></td>
                      <td className="dl-strong">{s.name}</td>
                      <td><PriorityBadge value={s.priority} /></td>
                      <td className="dl-muted">{subName(s.subDomainId)}</td>
                      <td className="dl-muted">{s.evidenceWeight}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="dl-muted">{s.usageScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ===================== PHASE E — BULLET POINTS ===================== */
export function BulletPointsWorkspace({ bullets, subDomains, loading, reload, onEdit, onCreate, domainId }) {
  const [q, setQ] = useState('');
  const [sub, setSub] = useState('all');
  const [priority, setPriority] = useState('all');
  const [status, setStatus] = useState('all');
  const [menuFor, setMenuFor] = useState(null);

  const rows = useMemo(() => {
    let out = bullets;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter(b => b.text.toLowerCase().includes(needle));
    if (sub !== 'all') out = out.filter(b => b.subDomainId === sub);
    if (priority !== 'all') out = out.filter(b => b.priority === priority);
    if (status !== 'all') out = out.filter(b => b.status === status);
    return out;
  }, [bullets, q, sub, priority, status]);

  const subName = id => subDomains.find(s => s.id === id)?.name || 'Domain-wide';

  return (
    <div className="dl-stack">
      <div className="dl-toolbar">
        <input className="dl-input" placeholder="Search bullet templates…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="dl-input dl-input-sm" value={sub} onChange={e => setSub(e.target.value)}>
          <option value="all">All sub-domains</option>
          {subDomains.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="dl-input dl-input-sm" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="all">All priorities</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="dl-input dl-input-sm" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option>
        </select>
        <button className="dl-btn dl-btn-primary dl-push" onClick={onCreate}>+ Add Bullet Point</button>
      </div>

      {loading ? (
        <div className="dl-stack-sm">{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={92} r={12} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon="✎" title="No bullet points yet"
          text="Bullet templates give the agent proven phrasing, with placeholders it only fills from real evidence."
          actionLabel="+ Add Bullet Point" onAction={onCreate} />
      ) : rows.map(b => (
        <article className="dl-card dl-bullet" key={b.id}>
          <p className="dl-bullet-text"><TemplateText text={b.text} /></p>
          <div className="dl-row-gap dl-wrap">
            <span className="dl-badge neutral">{b.category}</span>
            <span className="dl-badge muted">{subName(b.subDomainId)}</span>
            <PriorityBadge value={b.priority} />
            <StatusBadge status={b.status} />
            <div className="dl-push dl-rel">
              <button className="dl-icon-btn" onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}>•••</button>
              {menuFor === b.id && (
                <Menu onClose={() => setMenuFor(null)} items={[
                  { label: 'Edit', run: () => onEdit(b) },
                  { label: b.status === 'published' ? 'Unpublish' : 'Publish', run: async () => { await domainLibraryApi.saveBulletPoint(domainId, { ...b, status: b.status === 'published' ? 'draft' : 'published' }); reload(); } },
                  { sep: true },
                  { label: 'Delete', danger: true, run: async () => { await domainLibraryApi.deleteBulletPoint(domainId, b.id); reload(); } },
                ]} />
              )}
            </div>
          </div>
          <div className="dl-usage-note"><b>Agent usage:</b> {b.evidenceRequirement}</div>
        </article>
      ))}
    </div>
  );
}

/* ===================== PHASE F — AGENT INSTRUCTIONS ===================== */
export function InstructionsWorkspace({ instructions, loading, reload, onEdit, onCreate, domainId }) {
  const [dragId, setDragId] = useState(null);

  const groups = useMemo(() => {
    const m = new Map();
    for (const i of instructions) {
      if (!m.has(i.category)) m.set(i.category, []);
      m.get(i.category).push(i);
    }
    return [...m.entries()];
  }, [instructions]);

  async function onDrop(targetId) {
    if (!dragId || dragId === targetId) return;
    const ordered = [...instructions];
    const from = ordered.findIndex(i => i.id === dragId);
    const to = ordered.findIndex(i => i.id === targetId);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setDragId(null);
    await domainLibraryApi.reorderInstructions(domainId, ordered.map(i => i.id));
    reload();
  }

  return (
    <div className="dl-stack">
      {/* Stated once per tab — repeating it per row would be noise. */}
      <div className="dl-confidential">
        🔒 Private instructions controlling how AI should use this domain. These instructions are never shown directly to end users.
      </div>

      <div className="dl-toolbar">
        <span className="dl-muted dl-sm">{instructions.length} instruction{instructions.length === 1 ? '' : 's'}</span>
        <button className="dl-btn dl-btn-primary dl-push" onClick={onCreate}>+ Add Instruction</button>
      </div>

      {loading ? (
        <div className="dl-card dl-stack-sm">{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={46} r={8} />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon="🔒" title="No agent instructions yet"
          text="Instructions tell the agent how to write for this domain — tone, emphasis and what to avoid."
          actionLabel="+ Add Instruction" onAction={onCreate} />
      ) : groups.map(([category, items]) => (
        <section className="dl-card" key={category}>
          <div className="dl-card-head"><div className="dl-eyebrow">{category}</div></div>
          {items.map(ins => (
            <div className="dl-instr" key={ins.id}
              draggable onDragStart={() => setDragId(ins.id)}
              onDragOver={e => e.preventDefault()} onDrop={() => onDrop(ins.id)}>
              <span className="dl-drag" title="Drag to reorder">⋮⋮</span>
              {/* Ordinal comes from sortOrder so it survives filtering. */}
              <span className="dl-ordinal">{ins.sortOrder}</span>
              <div className="dl-instr-body">
                <div className="dl-instr-text">{ins.instruction}</div>
                <div className="dl-instr-meta">Applies to: {ins.appliesTo}</div>
              </div>
              <StatusBadge status={ins.status} />
              <button className="dl-link" onClick={() => onEdit(ins)}>Edit</button>
              <button className="dl-link" onClick={async () => {
                await domainLibraryApi.saveInstruction(domainId, { ...ins, status: ins.status === 'active' ? 'disabled' : 'active' });
                reload();
              }}>{ins.status === 'active' ? 'Disable' : 'Enable'}</button>
              <button className="dl-link danger" onClick={async () => { await domainLibraryApi.deleteInstruction(domainId, ins.id); reload(); }}>Delete</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ===================== PHASE G — PREVIEW & USAGE / SETTINGS ===================== */
export function PreviewUsageTab({ domain, subDomains, skills }) {
  const [usage, setUsage] = useState(null);
  const [jobTitle, setJobTitle] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => { domainLibraryApi.getUsage(domain.id).then(setUsage); }, [domain.id]);

  function simulate() {
    const t = jobTitle.trim().toLowerCase();
    if (!t) return;
    const matchedSubs = subDomains.filter(s => t.split(/\s+/).some(w => s.name.toLowerCase().includes(w))) ;
    const pool = matchedSubs.length ? matchedSubs : subDomains.slice(0, 2);
    setResult({
      subs: pool.map(s => s.name),
      skills: skills.filter(s => pool.some(p => p.id === s.subDomainId)).slice(0, 10).map(s => s.name),
    });
  }

  return (
    <div className="dl-stack">
      <div className="dl-note">Usage analytics aren't tracked yet, so these figures stay empty until the pipeline is wired up.</div>
      <section className="dl-card">
        <div className="dl-card-head"><h3>Usage</h3></div>
        <div className="dl-stats-inline">
          <div><b>{usage ? (usage.runs ?? '—') : <Skeleton w={40} />}</b><span>Used in runs</span></div>
          <div><b>{usage ? (usage.matchedJobs ?? '—') : <Skeleton w={40} />}</b><span>Matched jobs</span></div>
          <div><b>{usage ? (usage.avgMatch == null ? '—' : `${usage.avgMatch}%`) : <Skeleton w={40} />}</b><span>Avg match</span></div>
          <div><b>{usage ? (usage.lastUsed ? fmt(usage.lastUsed) : '—') : <Skeleton w={60} />}</b><span>Last used</span></div>
        </div>
      </section>

      <section className="dl-card">
        <div className="dl-card-head"><h3>Preview simulator</h3></div>
        <div className="dl-row-gap">
          <input className="dl-input" placeholder="Paste a job title, e.g. Senior Checkout Engineer"
            value={jobTitle} onChange={e => setJobTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && simulate()} />
          <button className="dl-btn dl-btn-primary" onClick={simulate}>Simulate</button>
        </div>
        {result && (
          <div className="dl-sim">
            <div><span className="dl-eyebrow">Detected sub-domains</span>
              <div className="dl-chips">{result.subs.map(s => <span className="dl-chip" key={s}>{s}</span>)}</div></div>
            <div><span className="dl-eyebrow">Skills the agent would prioritise</span>
              <div className="dl-chips">{result.skills.map(s => <span className="dl-chip" key={s}>{s}</span>)}</div></div>
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsTab({ domain, onSave, onDelete }) {
  const [form, setForm] = useState({ name: domain.name, description: domain.description, icon: domain.icon });
  useEffect(() => setForm({ name: domain.name, description: domain.description, icon: domain.icon }), [domain.id]);
  return (
    <div className="dl-stack">
      <section className="dl-card">
        <div className="dl-card-head"><h3>General</h3></div>
        <label className="dl-field"><span>Name</span>
          <input className="dl-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label className="dl-field"><span>Icon</span>
          <input className="dl-input" style={{ maxWidth: 90 }} value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} /></label>
        <label className="dl-field"><span>Description</span>
          <textarea className="dl-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></label>
        <button className="dl-btn dl-btn-primary" onClick={() => onSave(form)}>Save changes</button>
      </section>

      <section className="dl-card dl-danger-zone">
        <div className="dl-card-head"><h3>Danger zone</h3></div>
        <p className="dl-muted">Deleting this domain permanently removes its sub-domains, skills, bullet points and instructions.</p>
        <button className="dl-btn dl-btn-danger" onClick={onDelete}>Delete domain</button>
      </section>
    </div>
  );
}

export { Drawer };
