import React, { useEffect, useState } from 'react';

/* Shared loading/empty primitives — used by every tab, never re-implemented. */
export function Skeleton({ w = 60, h = 14, r = 999, style }) {
  return <span className="dl-skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function EmptyState({ icon = '◇', title, text, actionLabel, onAction, compact }) {
  return (
    <div className={`dl-empty${compact ? ' compact' : ''}`}>
      <div className="dl-empty-icon">{icon}</div>
      <div className="dl-empty-title">{title}</div>
      {text && <p className="dl-empty-text">{text}</p>}
      {actionLabel && <button className="dl-btn dl-btn-primary" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

/* §1 rule 2: status colours are fixed regardless of context. */
export function StatusBadge({ status }) {
  const map = {
    published: ['dl-badge ok', 'Published'],
    draft: ['dl-badge neutral', 'Draft'],
    archived: ['dl-badge muted', 'Archived'],
    active: ['dl-badge ok', 'Active'],
    disabled: ['dl-badge muted', 'Disabled'],
  };
  const [cls, label] = map[status] || map.draft;
  return <span className={cls}>{label}</span>;
}

export function PriorityBadge({ value }) {
  const cls = value === 'critical' ? 'danger' : value === 'high' ? 'warn' : value === 'medium' ? 'neutral' : 'muted';
  return <span className={`dl-badge ${cls}`}>{value}</span>;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dl-drawer-overlay" onClick={onClose}>
      <aside className="dl-drawer" onClick={e => e.stopPropagation()}>
        <header className="dl-drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="dl-drawer-sub">{subtitle}</div>}
          </div>
          <button className="dl-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="dl-drawer-body">{children}</div>
        {footer && <footer className="dl-drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, width = 460 }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dl-dialog-overlay" onClick={onClose}>
      <div className="dl-dialog" style={{ width }} onClick={e => e.stopPropagation()}>
        <header className="dl-dialog-head">
          <h2>{title}</h2>
          <button className="dl-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="dl-dialog-body">{children}</div>
        {footer && <footer className="dl-dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Menu({ items, onClose }) {
  return (
    <>
      <div className="dl-menu-backdrop" onClick={onClose} />
      <div className="dl-menu">
        {items.map((it, i) => it.sep
          ? <div key={i} className="dl-menu-sep" />
          : <button key={i} className={`dl-menu-item${it.danger ? ' danger' : ''}`}
              onClick={() => { it.run(); onClose(); }}>{it.label}</button>)}
      </div>
    </>
  );
}

/* Bracketed placeholders are what the agent fills in — show them distinctly. */
export function TemplateText({ text }) {
  const parts = String(text || '').split(/(\[[^\]]+\])/g);
  return (
    <span>
      {parts.map((p, i) => /^\[.+\]$/.test(p)
        ? <span key={i} className="dl-placeholder">{p}</span>
        : <React.Fragment key={i}>{p}</React.Fragment>)}
    </span>
  );
}

export function useDebounced(value, ms = 180) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
