import React, { useRef, useState } from 'react';
import mammoth from 'mammoth';
import {
  saveResume, deleteResume, uploadResumeFile, updateResumeText,
  updateResumePrompts, updateResumeAtsTarget
} from '../lib/firestore.js';
import Modal from './Modal.jsx';

const DOC_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;

const SUGGESTED_PROMPTS = [
  'Keep to one page',
  'Mirror JD keywords exactly',
  'Prioritize metrics and impact',
  'Emphasize leadership over IC work',
  'Formal tone, no first-person "I"',
  'Shorten bullets to one line each',
  'Lead each bullet with the outcome, not the task',
  'Favor recent experience over older roles'
];

export default function ResumeLibraryView({ uid, state, setView, notify }) {
  const { resumes, setResumes, activeResumeId, setActiveResumeId } = state;
  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState('upload');
  const [draftText, setDraftText] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [status, setStatus] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const [overflowOpen, setOverflowOpen] = useState(null);
  const [newPromptText, setNewPromptText] = useState('');
  const [editingResume, setEditingResume] = useState(null); // resume being text-edited in modal
  const [editText, setEditText] = useState('');

  async function handleFile(file) {
    pendingFileRef.current = file;
    setDraftLabel(file.name.replace(/\.[^/.]+$/, ''));
    setStatus({ kind: 'loading', msg: `Reading ${file.name}...` });
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setDraftText(result.value.trim());
        setStatus({ kind: 'ok', msg: 'Text extracted from .docx' });
      } else if (ext === 'txt' || ext === 'md') {
        const text = await file.text();
        setDraftText(text.trim());
        setStatus({ kind: 'ok', msg: 'Text loaded' });
      } else {
        setStatus({ kind: 'warn', msg: "Can't auto-read this format — switch to Paste text below." });
      }
    } catch (err) {
      console.error(err);
      setStatus({ kind: 'error', msg: "Couldn't extract text automatically. Switch to Paste text." });
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  }

  function resetDraft() {
    setDraftText(''); setDraftLabel(''); setStatus(null);
    pendingFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSaveResume() {
    if (!draftText.trim()) { alert('Add resume text (upload or paste) before saving.'); return; }
    let fileUrl = null, fileName = null;
    if (pendingFileRef.current) {
      try {
        const uploaded = await uploadResumeFile(uid, pendingFileRef.current);
        fileUrl = uploaded.url; fileName = pendingFileRef.current.name;
      } catch (err) { console.error('File upload failed (text still saved):', err); }
    }
    const record = await saveResume(uid, {
      label: draftLabel.trim() || 'Untitled resume',
      text: draftText.trim(),
      fileUrl, fileName,
      prompts: ['Keep to one page', 'Favor metrics-driven bullets (%, numbers, outcomes)'],
      atsTarget: 92
    });
    setResumes([record, ...resumes]);
    setActiveResumeId(record.id);
    resetDraft();
    setAddOpen(false);
    notify?.({ kind: '', title: `${record.label} added to library`, detail: 'Just now' });
  }

  async function handleDelete(id) {
    if (!confirm('Delete this resume? This can\'t be undone.')) return;
    await deleteResume(uid, id);
    const remaining = resumes.filter(r => r.id !== id);
    setResumes(remaining);
    if (activeResumeId === id) setActiveResumeId(remaining[0]?.id || null);
  }

  async function addPrompt(resume, text) {
    const value = (text ?? newPromptText).trim();
    if (!value) return;
    if ((resume.prompts || []).includes(value)) { setNewPromptText(''); return; }
    const updated = [...(resume.prompts || []), value];
    await updateResumePrompts(uid, resume.id, updated);
    setResumes(resumes.map(r => r.id === resume.id ? { ...r, prompts: updated } : r));
    setNewPromptText('');
  }
  async function removePrompt(resume, idx) {
    const updated = (resume.prompts || []).filter((_, i) => i !== idx);
    await updateResumePrompts(uid, resume.id, updated);
    setResumes(resumes.map(r => r.id === resume.id ? { ...r, prompts: updated } : r));
  }
  async function changeAtsTarget(resume, val) {
    const num = Number(val);
    await updateResumeAtsTarget(uid, resume.id, num);
    setResumes(resumes.map(r => r.id === resume.id ? { ...r, atsTarget: num } : r));
  }

  function openEdit(resume) {
    setEditingResume(resume);
    setEditText(resume.text);
  }
  async function saveEdit() {
    await updateResumeText(uid, editingResume.id, editText);
    setResumes(resumes.map(r => r.id === editingResume.id ? { ...r, text: editText } : r));
    setEditingResume(null);
  }

  return (
    <section>
      <h1 className="page-title">Resume library</h1>
      <p className="page-sub">Manage base resumes and their AI tailoring preferences. The resume flagged <strong>Default for tailoring</strong> is the one the workspace starts from.</p>

      {addOpen && (
        <div className="panel">
          <div className="panel-head"><h2>Add a resume</h2></div>
          <div className="mode-toggle">
            <button className={`mode-btn ${mode === 'upload' ? 'active' : ''}`} onClick={() => setMode('upload')}>⇪ Upload file</button>
            <button className={`mode-btn ${mode === 'paste' ? 'active' : ''}`} onClick={() => setMode('paste')}>✎ Paste text</button>
          </div>
          {mode === 'upload' && (
            <>
              <div className={`dropzone ${dragOver ? 'drag' : ''}`}
                onClick={() => fileInputRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}>
                <div className="dropzone-icon">⇪</div>
                <div className="dropzone-text">Drag your resume here, or <span className="link">browse files</span></div>
                <div className="dropzone-sub">.docx and .txt/.md are read automatically · other formats saved as-is</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".docx,.txt,.md,.pdf" style={{ display: 'none' }}
                onChange={e => e.target.files.length && handleFile(e.target.files[0])} />
              {status && (
                status.kind === 'loading' ? <div className="loading"><span className="spinner"></span> {status.msg}</div> :
                status.kind === 'error' ? <div className="error-box">{status.msg}</div> :
                <div className="row-card" style={{ marginTop: 10 }}><div className="row-main"><div className="row-icon">{status.kind === 'ok' ? '✓' : '!'}</div><div className="row-title">{status.msg}</div></div></div>
              )}
            </>
          )}
          <div className="field" style={{ marginTop: 16 }}>
            <span className="field-label">Extracted text — editable</span>
            <textarea rows={8} value={draftText} onChange={e => setDraftText(e.target.value)}
              placeholder="Paste or upload a resume to see extracted text here." />
          </div>
          <div className="field">
            <span className="field-label">Label this resume</span>
            <input type="text" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="e.g. Backend Engineer — Master" />
          </div>
          <div className="toolbar">
            <button className="btn btn-ghost" onClick={() => { resetDraft(); setAddOpen(false); }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveResume}>Save to library →</button>
          </div>
        </div>
      )}

      <div className="lib-grid">
        {resumes.map(r => (
          <div className="resume-card" key={r.id}>
            <div className="resume-card-top" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="resume-card-icon">{DOC_ICON}</div>
                {r.id === activeResumeId && <span className="badge badge-success">Default for tailoring</span>}
              </div>
                {/* three-dot overflow menu for secondary + destructive actions */}
                <div style={{ position: 'relative' }}>
                  <button
                    className="card-overflow-btn"
                    onClick={e => { e.stopPropagation(); setOverflowOpen(overflowOpen === r.id ? null : r.id); }}
                    title="More options"
                  >···</button>
                  {overflowOpen === r.id && (
                    <>
                      <div className="dd-backdrop show" onClick={() => setOverflowOpen(null)} />
                      <div className="card-overflow-menu">
                        <div className="card-overflow-item" onClick={() => { openEdit(r); setOverflowOpen(null); }}>Edit text</div>
                        <div className="card-overflow-item" onClick={() => { setExpandedId(expandedId === r.id ? null : r.id); setOverflowOpen(null); }}>AI preferences</div>
                        {r.id !== activeResumeId && <div className="card-overflow-item" onClick={() => { setActiveResumeId(r.id); setOverflowOpen(null); }}>Set as default</div>}
                        <div className="card-overflow-item danger" onClick={() => { handleDelete(r.id); setOverflowOpen(null); }}>Delete</div>
                      </div>
                    </>
                  )}
                </div>
            </div>
            <div className="resume-card-name">{r.label}</div>
            <div className="resume-card-meta">
              {(r.text?.length || 0).toLocaleString()} chars{r.fileName ? ` · ${r.fileName}` : ''}
            </div>
            <div className="resume-card-actions">
              <button className="btn btn-sm btn-primary" onClick={() => { setActiveResumeId(r.id); setView?.('agent'); }}>Tailor this →</button>
              {r.id !== activeResumeId && <button className="btn btn-sm" onClick={() => setActiveResumeId(r.id)}>Set default</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => openEdit(r)}>Edit</button>
            </div>

            {expandedId === r.id && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <span className="field-label">Standing tailoring prompts</span>
                <div className="chips" style={{ marginBottom: 10 }}>
                  {(r.prompts || []).map((p, i) => (
                    <div className="chip editable" key={i}>{p} <span className="x" onClick={() => removePrompt(r, i)}>✕</span></div>
                  ))}
                </div>
                {SUGGESTED_PROMPTS.filter(s => !(r.prompts || []).includes(s)).length > 0 && (
                  <>
                    <span className="field-label" style={{ marginTop: 0 }}>Suggestions — click to add</span>
                    <div className="chips" style={{ marginBottom: 10 }}>
                      {SUGGESTED_PROMPTS.filter(s => !(r.prompts || []).includes(s)).map(s => (
                        <div className="chip add" key={s} onClick={() => addPrompt(r, s)}>+ {s}</div>
                      ))}
                    </div>
                  </>
                )}
                <div className="row-2" style={{ marginBottom: 16 }}>
                  <input type="text" value={newPromptText} onChange={e => setNewPromptText(e.target.value)}
                    placeholder="Or write your own..." onKeyDown={e => e.key === 'Enter' && addPrompt(r)} />
                  <button className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => addPrompt(r)}>+ Add</button>
                </div>
                <span className="field-label">Target ATS match — {r.atsTarget || 92}%</span>
                <input type="range" min="60" max="100" value={r.atsTarget || 92} onChange={e => changeAtsTarget(r, e.target.value)} style={{ width: '100%' }} />
              </div>
            )}
          </div>
        ))}

        <div className="upload-card" onClick={() => setAddOpen(true)}>
          <div className="dropzone-icon">⇪</div>
          <span>+ Add a resume</span>
        </div>
      </div>

      <Modal open={!!editingResume} onClose={() => setEditingResume(null)} title={`Edit — ${editingResume?.label || ''}`}>
        <textarea rows={14} value={editText} onChange={e => setEditText(e.target.value)} />
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => setEditingResume(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdit}>Save changes</button>
        </div>
      </Modal>
    </section>
  );
}
