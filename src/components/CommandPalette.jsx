import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getTheme, toggleTheme } from '../lib/theme.js';

const NAV_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>;

export default function CommandPalette({ setView }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [theme, setThemeState] = useState(getTheme);
  const inputRef = useRef(null);

  const commands = [
    { id: 'dashboard', label: 'Go to Dashboard', group: 'Navigate', run: () => setView('dashboard') },
    { id: 'agent', label: 'Go to Tailor Resume', group: 'Navigate', run: () => setView('agent') },
    { id: 'careerprofile', label: 'Go to Career Profile', group: 'Navigate', run: () => setView('careerprofile') },
    { id: 'resumes', label: 'Go to Resumes', group: 'Navigate', run: () => setView('resumes') },
    { id: 'billing', label: 'Go to Billing', group: 'Navigate', run: () => setView('billing') },
    { id: 'settings', label: 'Go to Settings', group: 'Navigate', run: () => setView('settings') },
    { id: 'theme', label: theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode', group: 'Actions', run: () => setThemeState(toggleTheme()) },
    { id: 'signout', label: 'Sign out', group: 'Actions', run: logout }
  ];

  const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function onKeyDown(e) {
      const isK = e.key === 'k' || e.key === 'K';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    function onCustomOpen() { setOpen(true); }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onCustomOpen);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onCustomOpen);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(''); setActiveIndex(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function runCommand(cmd) {
    cmd.run();
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[activeIndex]) { runCommand(filtered[activeIndex]); }
  }

  if (!open) return null;

  let lastGroup = null;
  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-card" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span className="cmdk-input-icon">⌘</span>
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Type a command or search..." className="cmdk-input" />
          <span className="cmdk-esc">ESC</span>
        </div>
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cmdk-empty">No matching commands</div>}
          {filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <React.Fragment key={cmd.id}>
                {showGroup && <div className="cmdk-group-label">{cmd.group}</div>}
                <div className={`cmdk-item ${i === activeIndex ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)} onClick={() => runCommand(cmd)}>
                  {NAV_ICON} {cmd.label}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
