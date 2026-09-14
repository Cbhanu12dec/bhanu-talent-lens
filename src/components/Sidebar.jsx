import React from 'react';
import {
  LayoutDashboard, WandSparkles, Files, UserRound,
  CreditCard, Settings, LibraryBig, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Logo from './Logo.jsx';

const ADMIN_EMAIL = 'cbhanu12dec@gmail.com';

// `key` values are the existing view keys consumed by setView in App.jsx.
// Changing one of these breaks routing, so they are intentionally untouched.
const NAVIGATION = [
  {
    section: 'Workspace',
    items: [
      { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
      { key: 'agent', label: 'Tailor Resume', Icon: WandSparkles }
    ]
  },
  {
    section: 'Library',
    items: [
      { key: 'resumes', label: 'Resumes', Icon: Files },
      { key: 'careerprofile', label: 'Career Profile', Icon: UserRound }
    ]
  },
  {
    section: 'Account',
    items: [
      { key: 'billing', label: 'Billing', Icon: CreditCard },
      { key: 'settings', label: 'Settings', Icon: Settings }
    ]
  },
  {
    section: 'Admin',
    adminOnly: true,
    items: [
      { key: 'domainlibrary', label: 'Domain Library', Icon: LibraryBig },
      { key: 'admin', label: 'Admin Console', Icon: ShieldCheck, badge: 'Admin' }
    ]
  }
];

// 'resumes' and 'agent' each answer to a second legacy key elsewhere in the
// app, so the active check cannot be a plain equality test on one key.
const ALIASES = { resumes: ['library'], agent: ['tailor'], settings: ['aiprefs'] };

function SidebarBadge({ children }) {
  // Collapses to a dot in the narrow sidebar, where the word would otherwise
  // squeeze the label into an ellipsis. The text stays in the accessibility
  // tree at every width.
  return (
    <span className="sb-badge">
      <span className="sb-badge-text">{children}</span>
      <span className="sr-only">{children} only</span>
    </span>
  );
}

function SidebarNavItem({ item, active, onSelect }) {
  const { Icon, label, badge } = item;
  return (
    <li>
      <button
        type="button"
        className={`sb-item${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        title={label}
        onClick={() => onSelect(item.key)}
      >
        <Icon className="sb-icon" size={19} strokeWidth={1.8} aria-hidden="true" />
        <span className="sb-label">{label}</span>
        {badge && <SidebarBadge>{badge}</SidebarBadge>}
      </button>
    </li>
  );
}

function SidebarSection({ section, items, view, onSelect }) {
  return (
    <div className="sb-group">
      <h2 className="sb-group-label">{section}</h2>
      <ul className="sb-list">
        {items.map(item => (
          <SidebarNavItem
            key={item.key}
            item={item}
            active={item.key === view || (ALIASES[item.key] || []).includes(view)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function initials(nameOrEmail) {
  if (!nameOrEmail) return '';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  return base.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

export default function Sidebar({ view, setView, credits, creditsMax }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const creditsTotal = creditsMax ?? 500;
  const creditsPct = creditsTotal > 0 ? Math.round(((credits ?? 0) / creditsTotal) * 100) : 0;

  return (
    <aside className="side">
      <div className="logo">
        <Logo variant="full" size="sm" />
      </div>

      <nav className="sb-nav" aria-label="Main">
        {NAVIGATION
          .filter(group => !group.adminOnly || isAdmin)
          .map(group => (
            <SidebarSection
              key={group.section}
              section={group.section}
              items={group.items}
              view={view}
              onSelect={setView}
            />
          ))}
      </nav>

      <div className="side-foot">
        <div className="credit-mini">
          <div className="credit-mini-top">
            <span className="credit-mini-label">Credits Left</span>
            <b className="credit-mini-val">{credits ?? '—'} / {creditsTotal}</b>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${creditsPct}%` }} />
          </div>
          <button className="credit-mini-buy primary" onClick={() => setView('billing')}>
            + Buy More Credits
          </button>
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
