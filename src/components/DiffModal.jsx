import React from 'react';
import { diffLines } from '../lib/diff.js';
import Modal from './Modal.jsx';

export default function DiffModal({ open, onClose, oldLines, newLines, oldLabel, highlights }) {
  if (!open) return null;
  const ops = diffLines(oldLines || [], newLines || []);
  const hasKeyword = (text) => (highlights || []).some(h => text.toLowerCase().includes(h.toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} title="Resume diff" wide>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: -8, marginBottom: 14 }}>
        Comparing against: <strong style={{ color: 'var(--text)' }}>{oldLabel}</strong>. Green = added, red = removed, amber = a JD keyword landed in this line.
      </p>
      <div className="diff-grid">
        <div className="diff-col-head">Before</div>
        <div className="diff-col-head">After</div>
        {ops.map((op, i) => (
          <React.Fragment key={i}>
            <div className={`diff-cell ${op.type === 'removed' ? 'diff-removed' : op.type === 'added' ? 'diff-blank' : ''}`}>
              {op.left && (op.left.startsWith('## ') ? <strong>{op.left.slice(3)}</strong> : op.left)}
            </div>
            <div className={`diff-cell ${op.type === 'added' ? (hasKeyword(op.right) ? 'diff-added diff-keyword' : 'diff-added') : op.type === 'removed' ? 'diff-blank' : ''}`}>
              {op.right && (op.right.startsWith('## ') ? <strong>{op.right.slice(3)}</strong> : op.right)}
            </div>
          </React.Fragment>
        ))}
        {ops.length === 0 && <div className="diff-cell" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--dim)' }}>Nothing to compare yet.</div>}
      </div>
    </Modal>
  );
}
