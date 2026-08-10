import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

const WORKSPACE_NAV = [
  { key: 'dashboard',    icon: '▦', label: 'Dashboard' },
  { key: 'resumes',      icon: '▤', label: 'Resumes' },
  { key: 'agent',        icon: '✦', label: 'Build / Tailor Resume', badge: 'NEW' },
];
const CAREER_NAV = [
  { key: 'careerprofile', icon: '◈', label: 'Career Profile' },
];
const TOOLS_NAV = [
  { key: 'insights',   icon: '◉', label: 'AI Insights' },
  { key: 'templates',  icon: '▣', label: 'Templates' },
];
const ACCOUNT_NAV = [
  { key: 'billing',  icon: '▱', label: 'Billing' },
  { key: 'aiprefs',  icon: '⚙', label: 'AI Preferences' },
  { key: 'settings', icon: '⚙', label: 'Settings' },
];
const ADMIN_NAV = [
  { key: 'admin', icon: '🛡', label: 'Admin Console', badge: 'ADMIN', adminBadge: true },
];

const ADMIN_EMAIL = 'cbhanu12dec@gmail.com';

function initials(nameOrEmail) {
  if (!nameOrEmail) return '';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  return base.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

export default function Sidebar({ view, setView, resumeCount, credits, creditsMax }) {
  const { user, logout } = useAuth();

  function NavItem({ item, isAdmin = false }) {
    const active = view === item.key;
    return (
      <button className={`nav-item${active ? ' active' : ''}`} onClick={() => setView(item.key)}
        style={isAdmin && active ? { '--primary': 'var(--admin)' } : {}}>
        <span className="nav-icon">{item.icon}</span>
        <span>{item.label}</span>
        {item.badge && (
          <span className={`nav-badge${item.adminBadge ? ' admin' : ''}`}>{item.badge}</span>
        )}
      </button>
    );
  }

  function Section({ label, items, isAdmin = false }) {
    return (
      <div>
        <div className="nav-group-label" style={isAdmin ? { color: '#D2965A' } : {}}>
          {label}
        </div>
        <nav className="nav">
          {items.map(item => <NavItem key={item.key} item={item} isAdmin={isAdmin} />)}
        </nav>
      </div>
    );
  }

  const creditsTotal = creditsMax ?? 500;
  const creditsPct = creditsTotal > 0 ? Math.round(((credits ?? 0) / creditsTotal) * 100) : 0;

  return (
    <aside className="side">
      {/* Brand */}
      <div className="logo">
        <div className="logo-mark" style={{ fontSize: 13 }}>RC</div>
        <div className="logo-text">
          <span className="name">ResumeCraftPro</span>
          <span className="tag">AI Career Workspace</span>
        </div>
      </div>

      <Section label="Workspace" items={WORKSPACE_NAV} />
      <Section label="Career" items={CAREER_NAV} />
      <Section label="Tools" items={TOOLS_NAV} />
      <Section label="Account" items={ACCOUNT_NAV} />
      {user?.email === ADMIN_EMAIL && (
        <Section label="Admin" items={ADMIN_NAV} isAdmin />
      )}

      {/* Footer */}
      <div className="side-foot">
        <div className="credit-mini">
          <div className="credit-mini-top">
            <span className="credit-mini-label">Credits Left</span>
            <b style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>{credits ?? '—'} / {creditsTotal}</b>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${creditsPct}%` }} />
          </div>
          <div className="credit-mini-buy" onClick={() => setView('billing')}>
            + Buy More Credits
          </div>
        </div>

        <div className="profile-chip" style={{ cursor: 'default' }}>
          <div className="avatar">{initials(user?.displayName || user?.email)}</div>
          <div>
            <div className="name">{user?.displayName || user?.email}</div>
            <div className="role" onClick={logout}>Sign out</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
