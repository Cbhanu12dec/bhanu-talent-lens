import React, { useEffect, useId, useRef, useState } from 'react';

/* ------------------------------------------------------------------ layout */

export function ModulePage({ title, description, actions, children }) {
  return (
    <div className="mod">
      <header className="mod-head">
        <div className="mod-head-text">
          <h1 className="mod-title">{title}</h1>
          {description && <p className="mod-desc">{description}</p>}
        </div>
        {actions && <div className="mod-head-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, description, action, children, className = '', tone }) {
  return (
    <section className={`sec${tone ? ` sec--${tone}` : ''} ${className}`.trim()}>
      {(title || action) && (
        <div className="sec-head">
          <div className="sec-head-text">
            {title && <h2 className="sec-title">{title}</h2>}
            {description && <p className="sec-desc">{description}</p>}
          </div>
          {action && <div className="sec-head-action">{action}</div>}
        </div>
      )}
      <div className="sec-body">{children}</div>
    </section>
  );
}

/** [information] [control] — the standard settings line. */
export function Row({ title, description, control, id, stack }) {
  return (
    <div className={`srow${stack ? ' srow--stack' : ''}`}>
      <div className="srow-text">
        {id
          ? <label className="srow-title" htmlFor={id}>{title}</label>
          : <div className="srow-title">{title}</div>}
        {description && <div className="srow-desc">{description}</div>}
      </div>
      <div className="srow-control">{control}</div>
    </div>
  );
}

/** Label/value pair for read-only detail blocks. */
export function DetailRow({ label, value }) {
  return (
    <div className="drow">
      <div className="drow-label">{label}</div>
      <div className="drow-value">{value ?? <span className="drow-empty">Not set</span>}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- controls */

export function Toggle({ id, checked, onChange, disabled, lockedReason, label }) {
  return (
    <button
      type="button" id={id} role="switch"
      aria-checked={!!checked} aria-label={label}
      disabled={disabled} title={lockedReason || undefined}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}

export function ToggleRow({ title, description, checked, onChange, disabled, lockedReason }) {
  const id = useId();
  return (
    <Row
      id={id} title={title}
      description={lockedReason ? `${description ? description + ' ' : ''}${lockedReason}` : description}
      control={<Toggle id={id} checked={checked} onChange={onChange} disabled={disabled} lockedReason={lockedReason} label={title} />}
    />
  );
}

export function SelectRow({ title, description, value, onChange, options }) {
  const id = useId();
  return (
    <Row
      id={id} title={title} description={description}
      control={
        <select id={id} className="sel" value={value} onChange={e => onChange(e.target.value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      }
    />
  );
}

/** Radio group rendered as cards. Arrow keys move between options. */
export function ChoiceGroup({ legend, hint, value, onChange, options, columns = 3 }) {
  const name = useId();
  return (
    <fieldset className="choice-set" style={{ '--choice-cols': columns }}>
      {legend && <legend className="choice-legend">{legend}</legend>}
      {hint && <p className="choice-hint">{hint}</p>}
      <div className="choice-grid">
        {options.map(o => (
          <label key={o.value} className={`choice${value === o.value ? ' is-on' : ''}`}>
            <input
              type="radio" name={name} value={o.value}
              checked={value === o.value} onChange={() => onChange(o.value)}
            />
            {o.preview && <span className="choice-preview" aria-hidden="true">{o.preview}</span>}
            <span className="choice-text">
              <span className="choice-label">{o.label}</span>
              {o.description && <span className="choice-desc">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Field({ label, hint, error, children, wide }) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : null, error ? `${id}-e` : null].filter(Boolean).join(' ');
  return (
    <div className={`ffield${wide ? ' ffield--wide' : ''}${error ? ' has-error' : ''}`}>
      <label className="ffield-label" htmlFor={id}>{label}</label>
      {React.cloneElement(children, {
        id,
        'aria-invalid': error ? 'true' : undefined,
        'aria-describedby': describedBy || undefined
      })}
      {hint && !error && <span className="ffield-hint" id={`${id}-h`}>{hint}</span>}
      {error && <span className="ffield-error" id={`${id}-e`}>{error}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ display */

const TONES = { paid: 'ok', active: 'ok', ok: 'ok', pending: 'warn', failed: 'bad', refunded: 'neutral' };

export function StatusBadge({ status, tone, children }) {
  const t = tone || TONES[String(status || '').toLowerCase()] || 'neutral';
  return (
    // The dot carries the same meaning as the colour, so status is never
    // communicated by hue alone.
    <span className={`sbadge sbadge--${t}`}>
      <span className="sbadge-dot" aria-hidden="true" />
      {children || status}
    </span>
  );
}

export function Meter({ value, max, thresholds = [0.7, 0.9] }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const state = ratio >= thresholds[1] ? 'crit' : ratio >= thresholds[0] ? 'warn' : 'ok';
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`meter-fill meter-fill--${state}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, body, action, compact }) {
  return (
    <div className={`estate${compact ? ' estate--compact' : ''}`}>
      {icon && <div className="estate-icon" aria-hidden="true">{icon}</div>}
      <div className="estate-title">{title}</div>
      {body && <p className="estate-body">{body}</p>}
      {action && <div className="estate-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 3 }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          <Skeleton w="38%" />
          <Skeleton w="18%" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ actions */

/** Sticky footer that only appears once a form is dirty. */
export function SaveBar({ dirty, saving, onSave, onDiscard, label = 'You have unsaved changes.' }) {
  if (!dirty) return null;
  return (
    <div className="savebar" role="region" aria-label="Unsaved changes">
      <span className="savebar-text">{label}</span>
      <div className="savebar-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={saving}>Discard</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

/**
 * Confirmation dialog. When `confirmWord` is set the action stays disabled
 * until the user types it, which is the guard for irreversible operations.
 */
export function ConfirmModal({
  open, onClose, title, body, confirmWord, confirmLabel = 'Confirm',
  onConfirm, tone = 'danger', busy
}) {
  const [typed, setTyped] = useState('');
  const dialogRef = useRef(null);
  const firstRef = useRef(null);

  useEffect(() => { if (open) setTyped(''); }, [open]);

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      // Focus trap: keep Tab inside the dialog while it is open.
      const nodes = dialogRef.current?.querySelectorAll('button, input, [href], select, textarea');
      if (!nodes?.length) return;
      const list = Array.from(nodes).filter(n => !n.disabled);
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const ready = !confirmWord || typed.trim() === confirmWord;

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card cmodal" role="dialog" aria-modal="true" aria-labelledby="cm-title" ref={dialogRef}>
        <div className="modal-head">
          <h2 id="cm-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog" ref={firstRef}>✕</button>
        </div>
        <div className="modal-body">
          <div className="cmodal-body">{body}</div>
          {confirmWord && (
            <label className="cmodal-confirm">
              <span>Type <code>{confirmWord}</code> to confirm</span>
              <input
                type="text" value={typed} autoComplete="off"
                onChange={e => setTyped(e.target.value)} placeholder={confirmWord}
              />
            </label>
          )}
          <div className="cmodal-actions">
            <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className={`btn ${tone === 'danger' ? 'btn-destructive' : 'btn-primary'}`}
              disabled={!ready || busy} onClick={onConfirm}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
