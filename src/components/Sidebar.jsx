import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

const NAV = [
  { key: 'profile', tag: '01', label: 'Profile' },
  { key: 'dashboard', tag: '02', label: 'Dashboard' }
];

export default function Sidebar({ view, setView, sendingEmail, resumeCount }) {
  const { user, logout } = useAuth();
  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark"></div>
        <div className="brand-text">TalentLens<small>APPLICATION ASSEMBLY</small></div>
      </div>

      <div>
        <div className="nav-group-label">WORKSPACE</div>
        <nav className="nav">
          {NAV.map(n => (
            <button key={n.key} className={view === n.key ? 'active' : ''} onClick={() => setView(n.key)}>
              <span className="tag">{n.tag}</span> {n.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="side-foot">
        <div className="profile-chip">
          <div className="avatar"></div>
          <div>
            <div className="name">{user?.displayName || user?.email}</div>
            <div className="role">{resumeCount} resumes · sends from {sendingEmail || '—'}</div>
            <div className="role" onClick={logout}>Sign out</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
