import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getTheme, toggleTheme } from '../lib/theme.js';

const TITLES = {
  dashboard: 'Dashboard',
  agent: 'Tailor Resume',
  resumes: 'Resumes',
  careerprofile: 'Career Profile',
  insights: 'AI Insights',
  keywords: 'AI Insights',
  templates: 'Templates',
  billing: 'Billing',
  aiprefs: 'AI Preferences',
  settings: 'Settings',
  admin: 'Admin Console',
  library: 'Resume Library',
};

const BELL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>;
const SUN  = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>;
const MOON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>;
const ALERT = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>;

function initials(nameOrEmail) {
  if (!nameOrEmail) return '';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  return base.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

export default function Topbar({ view, setView, credits, notifications }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(null);
  const [theme, setThemeState] = useState(getTheme);
  const unread = (notifications || []).filter(n => n.unread).length;

  function toggle(w) { setOpen(o => o === w ? null : w); }

  return (
    <div className="topbar">
      <div className="topbar-title">{TITLES[view] || 'ResumeCraftPro'}</div>

      <div className="topbar-right">
        {/* Search trigger */}
        <div className="search-box" onClick={() => window.dispatchEvent(new Event('open-command-palette'))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          <span>Search or jump to...</span>
          <span className="kbd">⌘K</span>
        </div>

        {/* Credits pill */}
        <div className="credits-pill" onClick={() => setView('billing')} style={{ cursor: 'pointer' }}>
          ✦ {credits ?? '—'} credits
        </div>

        {/* Theme toggle */}
        <button className="icon-btn" onClick={() => setThemeState(toggleTheme())} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? MOON : SUN}
        </button>

        {/* Notifications */}
        <div className="dd-wrap">
          <button className="icon-btn" onClick={() => toggle('notif')}>
            {BELL}
            {unread > 0 && <span className="dot-badge" />}
          </button>
          <div className={`notif-panel ${open === 'notif' ? 'show' : ''}`} style={{ width: 320 }}>
            <div className="notif-panel-head">Notifications</div>
            {(!notifications || notifications.length === 0) ? (
              <div className="empty-notif">Nothing yet — activity shows up here as you use the app.</div>
            ) : notifications.slice(0, 6).map((n, i) => (
              <div key={i} className={`notif-item${n.unread ? ' unread' : ''}`} style={{ display: 'flex', gap: 10 }}>
                <div className={`notif-icon ${n.kind || ''}`}>{n.kind === 'good' ? CHECK : ALERT}</div>
                <div>
                  <div className="notif-title">{n.title}</div>
                  <div className="d">{n.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Profile */}
        <div className="dd-wrap">
          <div className="avatar" style={{ cursor: 'pointer', borderRadius: 8, width: 32, height: 32, fontSize: 12 }}
            onClick={() => toggle('profile')}>
            {initials(user?.displayName || user?.email)}
          </div>
          <div className={`notif-panel ${open === 'profile' ? 'show' : ''}`} style={{ width: 220 }}>
            <div className="dd-profile-head">
              <div className="avatar" style={{ borderRadius: 8 }}>{initials(user?.displayName || user?.email)}</div>
              <div>
                <div className="notif-title">{user?.displayName || 'Account'}</div>
                <div className="d" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user?.email}</div>
              </div>
            </div>
            <div className="dd-menu-item" onClick={() => { setView('settings'); setOpen(null); }}>Settings</div>
            <div className="dd-menu-item" onClick={() => { setView('aiprefs'); setOpen(null); }}>AI Preferences</div>
            <div className="dd-menu-item" onClick={() => { setView('billing'); setOpen(null); }}>Billing</div>
            <div className="dd-menu-item danger" onClick={logout}>Sign out</div>
          </div>
        </div>
      </div>

      {open && <div className="dd-backdrop show" onClick={() => setOpen(null)} />}
    </div>
  );
}
