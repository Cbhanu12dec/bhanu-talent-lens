import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { domainLibraryApi, validateDomainForPublish } from '../lib/domainLibraryApi.js';
import { Skeleton, EmptyState, StatusBadge, Menu } from './domain/DomainPrimitives.jsx';
import {
  DomainOverview, SubDomainsWorkspace, SkillsWorkspace,
  BulletPointsWorkspace, InstructionsWorkspace, PreviewUsageTab, SettingsTab,
} from './domain/DomainTabs.jsx';
import {
  CreateDomainModal, PublishDomainDialog, UnpublishDomainDialog, DeleteDomainDialog,
  SubDomainDrawer, AddSkillsModal, BulletPointDrawer, InstructionDrawer,
} from './domain/DomainDialogs.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'sub-domains', label: 'Sub-Domains', count: c => c.subDomains },
  { key: 'skills', label: 'Skills', count: c => c.skills },
  { key: 'bullets', label: 'Bullet Points', count: c => c.bulletPoints },
  { key: 'instructions', label: 'Agent Instructions', count: c => c.instructions },
  { key: 'preview', label: 'Preview & Usage' },
  { key: 'settings', label: 'Settings' },
];

const FILTERS = ['all', 'published', 'draft', 'archived'];

export default function DomainLibraryView({ notify }) {
  const [stats, setStats] = useState(null);
  const [domains, setDomains] = useState([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem('dl-selected') || null; } catch { return null; }
  });
  const [tabByDomain, setTabByDomain] = useState({});

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuFor, setMenuFor] = useState(null);

  const [subDomains, setSubDomains] = useState([]);
  const [skills, setSkills] = useState([]);
  const [bullets, setBullets] = useState([]);
  const [instructions, setInstructions] = useState([]);
  const [loadingContent, setLoadingContent] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [subDrawer, setSubDrawer] = useState({ open: false, subDomain: null });
  const [skillsModal, setSkillsModal] = useState(false);
  const [bulletDrawer, setBulletDrawer] = useState({ open: false, bullet: null });
  const [instrDrawer, setInstrDrawer] = useState({ open: false, instruction: null });

  const refreshStats = useCallback(() => { domainLibraryApi.getStats().then(setStats); }, []);

  const loadDomains = useCallback(async (selectId) => {
    setLoadingDomains(true);
    const list = await domainLibraryApi.getDomains();
    setDomains(list);
    setSelectedId(prev => {
      const want = selectId || prev;
      return list.some(d => d.id === want) ? want : (list[0]?.id || null);
    });
    setLoadingDomains(false);
    refreshStats();
  }, [refreshStats]);

  useEffect(() => { loadDomains(); }, [loadDomains]);

  useEffect(() => {
    if (!selectedId) return;
    try { localStorage.setItem('dl-selected', selectedId); } catch { /* non-fatal */ }
  }, [selectedId]);

  const loadContent = useCallback(async (domainId) => {
    if (!domainId) return;
    setLoadingContent(true);
    const [s, sk, bp, ins] = await Promise.all([
      domainLibraryApi.getSubDomains(domainId),
      domainLibraryApi.getSkills(domainId),
      domainLibraryApi.getBulletPoints(domainId),
      domainLibraryApi.getInstructions(domainId),
    ]);
    setSubDomains(s); setSkills(sk); setBullets(bp); setInstructions(ins);
    setLoadingContent(false);
  }, []);

  useEffect(() => { loadContent(selectedId); }, [selectedId, loadContent]);

  const domain = domains.find(d => d.id === selectedId) || null;
  // §5 DomainWorkspace: active tab is remembered per domain.
  const activeTab = (domain && tabByDomain[domain.id]) || 'overview';
  const setActiveTab = key => setTabByDomain(m => ({ ...m, [domain.id]: key }));

  const filteredDomains = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return domains.filter(d =>
      (filter === 'all' || d.status === filter) &&
      (!needle || d.name.toLowerCase().includes(needle)));
  }, [domains, q, filter]);

  const filterCounts = useMemo(() => ({
    all: domains.length,
    published: domains.filter(d => d.status === 'published').length,
    draft: domains.filter(d => d.status === 'draft').length,
    archived: domains.filter(d => d.status === 'archived').length,
  }), [domains]);

  const validation = useMemo(
    () => validateDomainForPublish(domain, { subDomains, skills, instructions }),
    [domain, subDomains, skills, instructions]);

  const counts = domain?.counts || { subDomains: 0, skills: 0, bulletPoints: 0, instructions: 0 };

  async function refreshAll() {
    await loadContent(selectedId);
    await loadDomains(selectedId);
  }

  async function handleCreateDomain(data) {
    const d = await domainLibraryApi.createDomain(data);
    setCreateOpen(false);
    await loadDomains(d.id);
    notify?.({ kind: 'good', title: 'Domain created', detail: d.name });
  }

  async function handleVisibilityToggle() {
    if (!domain) return;
    if (domain.status === 'published') setUnpublishOpen(true);
    else setPublishOpen(true);
  }

  async function doPublish() {
    await domainLibraryApi.updateDomain(domain.id, { status: 'published' });
    setPublishOpen(false); refreshAll();
    notify?.({ kind: 'good', title: 'Domain published', detail: domain.name });
  }
  async function doUnpublish() {
    await domainLibraryApi.updateDomain(domain.id, { status: 'draft' });
    setUnpublishOpen(false); refreshAll();
  }
  async function doDelete() {
    await domainLibraryApi.deleteDomain(domain.id);
    setDeleteOpen(false);
    await loadDomains();
    notify?.({ kind: '', title: 'Domain deleted', detail: domain.name });
  }

  const domainMenu = d => [
    { label: 'Edit', run: () => { setSelectedId(d.id); setTabByDomain(m => ({ ...m, [d.id]: 'settings' })); } },
    { label: 'Duplicate', run: async () => { await domainLibraryApi.createDomain({ ...d, name: `${d.name} (copy)`, status: 'draft' }); loadDomains(); } },
    { label: d.status === 'published' ? 'Unpublish' : 'Publish', run: () => { setSelectedId(d.id); d.status === 'published' ? setUnpublishOpen(true) : setPublishOpen(true); } },
    { label: 'Archive', run: async () => { await domainLibraryApi.updateDomain(d.id, { status: 'archived' }); loadDomains(); } },
    { sep: true },
    { label: 'Delete', danger: true, run: () => { setSelectedId(d.id); setDeleteOpen(true); } },
  ];

  const topSkills = useMemo(
    () => [...skills].sort((a, b) => b.usageScore - a.usageScore).slice(0, 6),
    [skills]);

  return (
    <section className="dl-root">
      <header className="dl-page-head">
        <div>
          <h1 className="dl-title">Domain Library</h1>
          <p className="dl-sub">Internal knowledge the tailoring agent draws on. Never shown to end users.</p>
        </div>
        <div className="dl-row-gap">
          <span className="dl-tip-wrap">
            <button className="dl-btn" disabled title="Coming soon">Import from template</button>
          </span>
          <button className="dl-btn">Manage order</button>
        </div>
      </header>

      <div className="dl-statsbar">
        {[
          ['Domains', stats?.totalDomains], ['Sub-domains', stats?.totalSubDomains],
          ['Skills', stats?.totalSkills], ['Bullet points', stats?.totalBulletPoints],
          ['Published', stats?.publishedCount], ['Drafts', stats?.draftCount],
        ].map(([label, value], i) => (
          <React.Fragment key={label}>
            {i > 0 && <span className="dl-statsbar-div" />}
            <div className="dl-stat">
              <b>{value == null ? <Skeleton w={28} h={18} r={6} /> : value}</b>
              <span>{label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {!loadingDomains && domains.length === 0 ? (
        <EmptyState icon="🗂" title="No domains yet"
          text="Create your first one to start building the knowledge the tailoring agent uses."
          actionLabel="+ New Domain" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="dl-layout">
          {/* ---------------- Sidebar ---------------- */}
          <aside className="dl-side">
            <input className="dl-input dl-input-sm" placeholder="Search domains…" value={q} onChange={e => setQ(e.target.value)} />
            <div className="dl-filters">
              {FILTERS.map(f => (
                <button key={f} className={`dl-filter${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)} <span>{filterCounts[f]}</span>
                </button>
              ))}
            </div>

            <div className="dl-domain-list">
              {loadingDomains
                ? [0, 1, 2].map(i => <Skeleton key={i} w="100%" h={56} r={10} />)
                : filteredDomains.length === 0
                  ? <p className="dl-muted dl-sm dl-pad">No domains match.</p>
                  : filteredDomains.map(d => (
                    <div key={d.id} className={`dl-domain-item${d.id === selectedId ? ' sel' : ''}`}
                      onClick={() => setSelectedId(d.id)}>
                      <div className="dl-domain-item-top">
                        <span className="dl-domain-name">{d.icon} {d.name}</span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="dl-domain-item-meta">
                        {d.counts.subDomains} sub-domains · {d.counts.skills} skills
                      </div>
                      <div className="dl-rel dl-domain-item-menu">
                        <button className="dl-icon-btn" onClick={e => { e.stopPropagation(); setMenuFor(menuFor === d.id ? null : d.id); }}>•••</button>
                        {menuFor === d.id && <Menu onClose={() => setMenuFor(null)} items={domainMenu(d)} />}
                      </div>
                    </div>
                  ))}
            </div>

            <button className="dl-btn dl-btn-primary dl-full" onClick={() => setCreateOpen(true)}>+ New Domain</button>
          </aside>

          {/* ---------------- Workspace ---------------- */}
          <main className="dl-work">
            {!domain ? (
              <EmptyState icon="🗂" title="Select a domain" text="Pick a domain on the left to view its sub-domains, skills and agent instructions." />
            ) : (
              <>
                <div className="dl-work-head">
                  <div className="dl-work-title">
                    <span className="dl-work-icon">{domain.icon}</span>
                    <div>
                      <div className="dl-row-gap">
                        <h2>{domain.name}</h2>
                        <StatusBadge status={domain.status} />
                      </div>
                      <p className="dl-muted dl-sm">{domain.description}</p>
                      <div className="dl-meta-row">
                        <span>{counts.subDomains} sub-domains</span>
                        <span>{counts.skills} skills</span>
                        <span>{counts.bulletPoints} bullet points</span>
                      </div>
                    </div>
                  </div>
                  <div className="dl-row-gap">
                    <button className="dl-btn dl-btn-sm" onClick={() => setActiveTab('settings')}>Edit</button>
                    <div className="dl-rel">
                      <button className="dl-icon-btn" onClick={() => setMenuFor(menuFor === 'head' ? null : 'head')}>•••</button>
                      {menuFor === 'head' && <Menu onClose={() => setMenuFor(null)} items={domainMenu(domain)} />}
                    </div>
                  </div>
                </div>

                <nav className="dl-tabs">
                  {TABS.map(t => (
                    <button key={t.key} className={`dl-tab${activeTab === t.key ? ' on' : ''}`} onClick={() => setActiveTab(t.key)}>
                      {t.label}{t.count ? <span className="dl-tab-count">{t.count(counts)}</span> : null}
                    </button>
                  ))}
                </nav>

                <div className="dl-tab-body">
                  {activeTab === 'overview' && (
                    <DomainOverview domain={domain} subDomains={subDomains} loading={loadingContent}
                      onEdit={() => setActiveTab('settings')} onGoToTab={setActiveTab}
                      onAddSubDomain={() => setSubDrawer({ open: true, subDomain: null })} />
                  )}
                  {activeTab === 'sub-domains' && (
                    <SubDomainsWorkspace domain={domain} subDomains={subDomains} loading={loadingContent}
                      reload={refreshAll} onEdit={s => setSubDrawer({ open: true, subDomain: s })}
                      onCreate={() => setSubDrawer({ open: true, subDomain: null })} />
                  )}
                  {activeTab === 'skills' && (
                    <SkillsWorkspace domain={domain} skills={skills} subDomains={subDomains}
                      loading={loadingContent} reload={refreshAll} onAdd={() => setSkillsModal(true)} />
                  )}
                  {activeTab === 'bullets' && (
                    <BulletPointsWorkspace bullets={bullets} subDomains={subDomains} loading={loadingContent}
                      reload={refreshAll} onEdit={b => setBulletDrawer({ open: true, bullet: b })}
                      onCreate={() => setBulletDrawer({ open: true, bullet: null })} />
                  )}
                  {activeTab === 'instructions' && (
                    <InstructionsWorkspace instructions={instructions} loading={loadingContent} domainId={domain.id}
                      reload={refreshAll} onEdit={i => setInstrDrawer({ open: true, instruction: i })}
                      onCreate={() => setInstrDrawer({ open: true, instruction: null })} />
                  )}
                  {activeTab === 'preview' && <PreviewUsageTab domain={domain} subDomains={subDomains} skills={skills} />}
                  {activeTab === 'settings' && (
                    <SettingsTab domain={domain}
                      onSave={async patch => { await domainLibraryApi.updateDomain(domain.id, patch); refreshAll(); notify?.({ kind: 'good', title: 'Domain updated', detail: '' }); }}
                      onDelete={() => setDeleteOpen(true)} />
                  )}
                </div>
              </>
            )}
          </main>

          {/* ---------------- Right panel ---------------- */}
          {domain && (
            <aside className="dl-right">
              <section className="dl-card">
                <div className="dl-card-head"><h3>Quick actions</h3></div>
                <div className="dl-actions">
                  <button onClick={() => { setActiveTab('sub-domains'); setSubDrawer({ open: true, subDomain: null }); }}>+ Add sub-domain</button>
                  <button onClick={() => { setActiveTab('skills'); setSkillsModal(true); }}>+ Add skills</button>
                  <button onClick={() => { setActiveTab('bullets'); setBulletDrawer({ open: true, bullet: null }); }}>+ Add bullet point</button>
                  <button onClick={() => { setActiveTab('instructions'); setInstrDrawer({ open: true, instruction: null }); }}>+ Add instruction</button>
                  <button onClick={async () => { await domainLibraryApi.createDomain({ ...domain, name: `${domain.name} (copy)`, status: 'draft' }); loadDomains(); }}>Duplicate domain</button>
                </div>
                {/* Danger action is its own group, not just the last row. */}
                <div className="dl-actions danger">
                  <button onClick={() => setDeleteOpen(true)}>Delete domain</button>
                </div>
              </section>

              <section className="dl-card">
                <div className="dl-card-head"><h3>Visibility</h3></div>
                <label className="dl-switch-row">
                  <span className={`dl-switch${domain.status === 'published' ? ' on' : ''}`} onClick={handleVisibilityToggle}>
                    <span className="dl-switch-knob" />
                  </span>
                  <span className="dl-sm">{domain.status === 'published' ? 'Published — live for tailoring' : 'Draft — internal only'}</span>
                </label>
              </section>

              <section className="dl-card">
                <div className="dl-card-head"><h3>Top skills</h3></div>
                {topSkills.length === 0 ? <p className="dl-muted dl-sm">No skills yet.</p> : (
                  <ol className="dl-topskills">
                    {topSkills.map(s => <li key={s.id}><span>{s.name}</span><b>{s.usageScore}</b></li>)}
                  </ol>
                )}
                <button className="dl-link" onClick={() => setActiveTab('skills')}>View all skills →</button>
              </section>
            </aside>
          )}
        </div>
      )}

      {/* ---------------- Modals & drawers ---------------- */}
      <CreateDomainModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreateDomain} />

      <PublishDomainDialog open={publishOpen} onClose={() => setPublishOpen(false)} domain={domain}
        validation={validation} counts={counts} onPublish={doPublish}
        onFixIssues={tab => { setPublishOpen(false); if (tab) setActiveTab(tab); }} />

      <UnpublishDomainDialog open={unpublishOpen} onClose={() => setUnpublishOpen(false)} onConfirm={doUnpublish} />

      <DeleteDomainDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} domain={domain}
        counts={counts} onConfirm={doDelete} />

      <SubDomainDrawer open={subDrawer.open} onClose={() => setSubDrawer({ open: false, subDomain: null })}
        domain={domain} subDomain={subDrawer.subDomain}
        onSave={async data => {
          if (subDrawer.subDomain) await domainLibraryApi.updateSubDomain(subDrawer.subDomain.id, data);
          else await domainLibraryApi.createSubDomain({ domainId: domain.id, ...data });
          setSubDrawer({ open: false, subDomain: null }); refreshAll();
        }} />

      <AddSkillsModal open={skillsModal} onClose={() => setSkillsModal(false)} subDomains={subDomains}
        onAdd={async (names, meta) => {
          await domainLibraryApi.addSkills(domain.id, names, meta);
          setSkillsModal(false); refreshAll();
          notify?.({ kind: 'good', title: `${names.length} skills added`, detail: domain.name });
        }} />

      <BulletPointDrawer open={bulletDrawer.open} onClose={() => setBulletDrawer({ open: false, bullet: null })}
        bullet={bulletDrawer.bullet} subDomains={subDomains}
        onSave={async data => {
          await domainLibraryApi.saveBulletPoint({ ...data, domainId: domain.id, subDomainId: data.subDomainId || null });
          setBulletDrawer({ open: false, bullet: null }); refreshAll();
        }} />

      <InstructionDrawer open={instrDrawer.open} onClose={() => setInstrDrawer({ open: false, instruction: null })}
        instruction={instrDrawer.instruction} domain={domain} subDomains={subDomains}
        onSave={async data => {
          await domainLibraryApi.saveInstruction({ ...data, domainId: domain.id, subDomainId: data.subDomainId || null });
          setInstrDrawer({ open: false, instruction: null }); refreshAll();
        }} />
    </section>
  );
}
