import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

const BELL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
const CREDIT_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8 10h5.5a2.5 2.5 0 0 1 0 5H8" /></svg>;
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>;
const ALERT = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>;
const DOC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;

function initials(nameOrEmail) {
  if (!nameOrEmail) return '';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  return base.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

const TITLES = { dashboard: 'Dashboard', library: 'Resume library', billing: 'Billing and credits', profile: 'Profile and settings' };

export default function Topbar({ view, setView, credits, notifications }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(null); // 'notif' | 'profile' | null

  function toggle(which) {
    setOpen(o => o === which ? null : which);
  }

  const unreadCount = notifications.filter(n => n.unread).length;

  return (
    <div className="topbar">
      <div className="topbar-title">{TITLES[view] || ''}</div>
      <div className="topbar-right">
        <div className="credit-pill" onClick={() => setView('billing')}>
          {CREDIT_ICON} {credits ?? '—'} credits
        </div>

        <div className="dd-wrap">
          <button className="icon-btn" onClick={() => toggle('notif')}>
            {BELL}
            {unreadCount > 0 && <span className="dot-ping"></span>}
          </button>
          <div className={`dropdown-panel ${open === 'notif' ? 'show' : ''}`}>
            <div className="dd-head">Notifications</div>
            {notifications.length === 0 ? (
              <div className="empty-notif">Nothing yet — activity shows up here as you use TalentLens.</div>
            ) : notifications.slice(0, 8).map((n, i) => (
              <div className={`notif-item ${n.unread ? 'unread' : ''}`} key={i}>
                <div className={`notif-icon ${n.kind || ''}`}>{n.kind === 'good' ? CHECK : n.kind === 'warn' ? ALERT : DOC}</div>
                <div><div className="notif-title">{n.title}</div><div className="notif-time">{n.detail}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="dd-wrap">
          <button className="icon-btn avatar-btn" onClick={() => toggle('profile')}>
            <div className="avatar avatar-sm">{initials(user?.displayName || user?.email)}</div>
          </button>
          <div className={`dropdown-panel ${open === 'profile' ? 'show' : ''}`} style={{ width: 220 }}>
            <div className="dd-profile-head">
              <div className="avatar avatar-sm">{initials(user?.displayName || user?.email)}</div>
              <div><div className="notif-title">{user?.displayName || 'Your account'}</div><div className="notif-time">{user?.email}</div></div>
            </div>
            <div className="dd-menu-item" onClick={() => { setView('profile'); setOpen(null); }}>Profile and settings</div>
            <div className="dd-menu-item" onClick={() => { setView('billing'); setOpen(null); }}>Billing and credits</div>
            <div className="dd-menu-item danger" onClick={logout}>Sign out</div>
          </div>
        </div>
      </div>

      {open && <div className="dd-backdrop show" onClick={() => setOpen(null)}></div>}
    </div>
  );
}
