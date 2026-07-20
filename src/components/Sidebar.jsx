import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Logo from './Logo.jsx';

const ICONS = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  library: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  billing: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></svg>,
  profile: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.13.47.43.87.85 1.11.28.17.6.26.93.26H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
};

const WORKSPACE_NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'library', label: 'Resume library' }
];
const ACCOUNT_NAV = [
  { key: 'billing', label: 'Billing and credits' },
  { key: 'profile', label: 'Profile and settings' }
];

function initials(nameOrEmail) {
  if (!nameOrEmail) return '';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  return base.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

export default function Sidebar({ view, setView, resumeCount, credits, creditsTotal }) {
  const { user, logout } = useAuth();

  function NavButton({ item }) {
    return (
      <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => setView(item.key)}>
        {ICONS[item.key]} {item.label}
        {item.key === 'library' && resumeCount > 0 && <span className="nav-badge">{resumeCount}</span>}
      </button>
    );
  }

  return (
    <aside className="side">
      <div className="brand">
        <Logo size={32} />
        <div className="brand-text">TalentLens<small>APPLICATION ASSEMBLY</small></div>
      </div>

      <div>
        <div className="nav-group-label">WORKSPACE</div>
        <nav className="nav">{WORKSPACE_NAV.map(item => <NavButton item={item} key={item.key} />)}</nav>
        <div className="nav-group-label">ACCOUNT</div>
        <nav className="nav">{ACCOUNT_NAV.map(item => <NavButton item={item} key={item.key} />)}</nav>
      </div>

      <div className="side-foot">
        <div className="credit-mini">
          <div className="credit-mini-top">
            <span className="credit-mini-label">Credits left</span>
            <span className="credit-mini-val">{credits ?? '—'} / {creditsTotal ?? '—'}</span>
          </div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${creditsTotal ? (credits / creditsTotal) * 100 : 0}%` }}></div></div>
          <div className="credit-mini-buy" onClick={() => setView('billing')}>+ Buy credits</div>
        </div>

        <div className="profile-chip">
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
