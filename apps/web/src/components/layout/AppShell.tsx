import React from 'react';
import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores';

const WORKSPACE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { to: '/resumes', label: 'Resumes', icon: '📄' },
  { to: '/career-profile', label: 'Career Profile', icon: '👤' },
];
const ACCOUNT_NAV = [
  { to: '/billing', label: 'Billing', icon: '💳' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function initials(s: string) {
  return (s || '').split(/[\s@]+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

export default function AppShell() {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  function handleSignOut() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      {/* Fixed Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">TL</div>
          <div>
            <div className="sidebar-name">TalentLens</div>
            <div className="sidebar-tagline">AI Resume Intelligence</div>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">Workspace</div>
          <div className="nav-items">
            {WORKSPACE_NAV.map(item => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="nav-section" style={{ marginTop: 8 }}>
          <div className="nav-label">Account</div>
          <div className="nav-items">
            {ACCOUNT_NAV.map(item => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
            {user?.role === 'ADMIN' && (
              <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span>🛡</span>
                Admin
              </NavLink>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="credit-widget">
            <div className="credit-row">
              <span className="credit-label">Credits</span>
              <span className="credit-val">{user?.credits ?? '—'} / {user?.creditsMax ?? '—'}</span>
            </div>
            <div className="credit-bar">
              <div className="credit-bar-fill" style={{ width: `${user?.creditsMax ? (user.credits / user.creditsMax) * 100 : 0}%` }} />
            </div>
            <div className="credit-buy" onClick={() => navigate('/billing')}>+ Get credits</div>
          </div>

          <div className="user-chip">
            <div className="user-avatar">{initials(user?.fullName || user?.email || '')}</div>
            <div>
              <div className="user-name">{user?.fullName || 'Account'}</div>
              <div className="user-email" style={{ cursor: 'pointer' }} onClick={handleSignOut}>Sign out</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Scrollable Main */}
      <div className="main-content">
        <header className="topbar">
          <span className="topbar-title">
            {WORKSPACE_NAV.concat(ACCOUNT_NAV).find(n => location.pathname.startsWith(n.to))?.label || 'TalentLens'}
          </span>
          <div className="topbar-right">
            <button className="topbar-search" onClick={() => {}}>
              🔍 Search
              <span className="topbar-kbd">⌘K</span>
            </button>
          </div>
        </header>

        <div className="page">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
