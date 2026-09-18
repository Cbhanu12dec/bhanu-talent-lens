import React, { useEffect, useRef, useState } from 'react';
import { diffWords, hasPlaceholder } from '../lib/resumeBlocks.js';

const CHIPS = [
  'Add a quantified metric',
  'Match JD keywords',
  'Make it more concise',
  'Lead with the outcome',
  'Show more ownership',
  'Remove buzzwords',
];

function Diff({ before, after }) {
  return (
    <p className="be-diff">
      {diffWords(before, after).map((op, i) => (
        op.type === 'same' ? <span key={i}>{op.value}</span>
          : op.type === 'removed' ? <del key={i}>{op.value}</del>
            : <ins key={i}>{op.value}</ins>
      ))}
    </p>
  );
}

/**
 * Editor rail for one block. Rendered inline beneath the block it belongs to
 * rather than as a floating popover, so it never covers the text being edited.
 *
 * mode: 'menu' | 'manual' | 'ai'
 */
export default function BlockEditor({
  block, mode, onMode, onCancel,
  onCommit,                 // (text, source, instruction) => void
  onAskAi,                  // (instruction) => Promise<{rewrittenText, keywordsAdded, warnings}>
  onUnpin,
}) {
  const [draft, setDraft] = useState(block.text);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [suggestion, setSuggestion] = useState(null); // { rewrittenText, keywordsAdded, warnings, instruction }
  const taRef = useRef(null);

  useEffect(() => { setDraft(block.text); setSuggestion(null); setError(null); }, [block.id, block.text]);
  useEffect(() => { if (mode === 'manual') taRef.current?.focus(); }, [mode]);

  async function runAi(text) {
    const ask = String(text || '').trim();
    if (!ask) return;
    setBusy(true); setError(null); setSuggestion(null);
    try {
      const res = await onAskAi(ask);
      setSuggestion({ ...res, instruction: ask });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Could not rewrite this block. Try again.');
    }
    setBusy(false);
  }

  const dirty = draft.trim() !== block.text.trim();
  const placeholderPending = suggestion && hasPlaceholder(suggestion.rewrittenText);

  return (
    <div className="be" onClick={e => e.stopPropagation()}>
      {mode === 'menu' && (
        <div className="be-bar">
          <button className="btn btn-secondary btn-sm" onClick={() => onMode('manual')}>Edit manually</button>
          <button className="btn btn-primary btn-sm" onClick={() => onMode('ai')}>Ask AI to fix</button>
          {block.pinned && (
            <button className="btn btn-ghost btn-sm be-unpin" onClick={onUnpin} title="Allow this block to regenerate again">
              Unpin
            </button>
          )}
          <button className="btn btn-ghost btn-sm be-close" onClick={onCancel} aria-label="Close editor">Close</button>
        </div>
      )}

      {mode === 'manual' && (
        <div className="be-panel">
          <label className="be-label" htmlFor="be-ta">Edit this block</label>
          <textarea
            id="be-ta" ref={taRef} className="be-textarea" rows={3}
            value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onMode('menu');
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) onCommit(draft.trim(), 'manual');
            }}
          />
          <div className="be-actions">
            <span className="be-hint">{hasPlaceholder(draft) ? 'Contains a placeholder' : ''}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(block.text); onMode('menu'); }}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => onCommit(draft.trim(), 'manual')}>Save</button>
          </div>
        </div>
      )}

      {mode === 'ai' && (
        <div className="be-panel">
          {!suggestion && (
            <>
              <div className="be-label">Ask AI to fix this block</div>
              <div className="be-chips">
                {CHIPS.map(c => (
                  <button key={c} className="be-chip" disabled={busy} onClick={() => runAi(c)}>{c}</button>
                ))}
              </div>
              <div className="be-ask">
                <input
                  type="text" className="be-input" placeholder="Or describe the change you want…"
                  value={instruction} disabled={busy}
                  onChange={e => setInstruction(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runAi(instruction); if (e.key === 'Escape') onMode('menu'); }}
                />
                <button className="btn btn-primary btn-sm" disabled={busy || !instruction.trim()} onClick={() => runAi(instruction)}>
                  {busy ? 'Working…' : 'Send'}
                </button>
              </div>
              {busy && <div className="be-busy"><span className="spinner" /> Rewriting this block…</div>}
              {error && <div className="error-box be-error">{error}</div>}
              <div className="be-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => onMode('menu')}>Cancel</button>
              </div>
            </>
          )}

          {suggestion && (
            <>
              <div className="be-label">Suggested rewrite · {suggestion.instruction}</div>
              <Diff before={block.text} after={suggestion.rewrittenText} />

              {suggestion.keywordsAdded?.length > 0 && (
                <div className="be-kw">
                  Keywords worked in: {suggestion.keywordsAdded.map(k => <span className="be-kw-chip" key={k}>{k}</span>)}
                </div>
              )}

              {/* Acceptance is gated on this being visible: a bracketed
                  placeholder must never slip through unnoticed. */}
              {suggestion.warnings?.length > 0 && (
                <div className="be-warn" role="alert">
                  {suggestion.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}

              <div className="be-actions">
                {placeholderPending && <span className="be-hint be-hint--warn">Replace the placeholder before accepting</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => setSuggestion(null)}>Reject</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={placeholderPending}
                  onClick={() => onCommit(suggestion.rewrittenText, 'ai', suggestion.instruction)}
                >
                  Accept
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
