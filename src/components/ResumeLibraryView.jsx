import React, { useRef, useState } from 'react';
import mammoth from 'mammoth';
import { extractPdfText } from '../lib/pdfText.js';
import {
  saveResume, deleteResume, uploadResumeFile, updateResumeText,
  updateResumePrompts, updateResumeAtsTarget
} from '../lib/firestore.js';
import Modal from './Modal.jsx';
import { buildResumePdf, downloadBlob } from '../lib/pdf.js';
import { buildResumeDocx } from '../lib/docx.js';

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
  const [addMode, setAddMode] = useState('upload');
  const [previewResume, setPreviewResume] = useState(null);
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
      } else if (ext === 'pdf') {
        const text = await extractPdfText(file);
        if (!text.trim()) {
          setStatus({ kind: 'warn', msg: 'This PDF has no selectable text (likely a scan) — switch to Paste text below.' });
        } else {
          setDraftText(text);
          setStatus({ kind: 'ok', msg: 'Text extracted from .pdf' });
        }
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

  const fmtDate = ts => {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  };

  function downloadAs(resume, format) {
    const doc = { name: resume.label, contact: '', sections: [{ heading: 'RESUME', paragraphs: (resume.text || '').split('\n').filter(Boolean) }] };
    if (format === 'pdf') {
      const { blob, filename } = buildResumePdf(doc, resume.label);
      downloadBlob(blob, filename);
    } else {
      buildResumeDocx(doc, resume.label).then(({ blob, filename }) => downloadBlob(blob, filename));
    }
    setOverflowOpen(null);
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
        <div>
          <h1 className="page-title">Resume library</h1>
          <p className="page-sub" style={{ margin: 0 }}>Every resume you've uploaded or created. The default is what the workspace starts from.</p>
        </div>
        <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => setAddOpen(true)}>⇧ Add Resume</button>
      </div>

      {resumes.length === 0 ? (
        <div className="es-card">
          <div className="es-icon">⇧</div>
          <div className="es-title">No resumes uploaded yet</div>
          <p className="es-text">Add your resume once, then tailor it to any job description in seconds.</p>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>⇧ Add Resume</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {resumes.map(r => (
            <div className="lib-row" key={r.id}>
              <div className="lib-icon">{DOC_ICON}</div>
              <div className="lib-body">
                <div className="lib-name">
                  {r.label}
                  {r.id === activeResumeId && <span className="badge badge-primary">Default</span>}
                </div>
                <div className="lib-meta">
                  {(r.text?.length || 0).toLocaleString()} chars
                  {r.fileName ? ` · ${r.fileName}` : ''}
                  {` · Uploaded ${fmtDate(r.createdAt)}`}
                </div>
              </div>
              <div className="lib-actions">
                <button className="btn btn-sm" onClick={() => setPreviewResume(r)}>Open</button>
                <button className="btn btn-sm btn-primary" onClick={() => { setActiveResumeId(r.id); setView?.('agent'); }}>Tailor →</button>
                <div style={{ position: 'relative' }}>
                  <button className="card-overflow-btn"
                    onClick={e => { e.stopPropagation(); setOverflowOpen(overflowOpen === r.id ? null : r.id); }}
                    title="More options">•••</button>
                  {overflowOpen === r.id && (
                    <>
                      <div className="dd-backdrop show" onClick={() => setOverflowOpen(null)} />
                      <div className="card-overflow-menu">
                        <div className="card-overflow-item" onClick={() => { openEdit(r); setOverflowOpen(null); }}>Rename / edit text</div>
                        <div className="card-overflow-item" onClick={() => { setExpandedId(expandedId === r.id ? null : r.id); setOverflowOpen(null); }}>AI preferences</div>
                        {r.id !== activeResumeId && (
                          <div className="card-overflow-item" onClick={() => { setActiveResumeId(r.id); setOverflowOpen(null); }}>Set as default</div>
                        )}
                        <div className="card-overflow-item" onClick={() => downloadAs(r, 'pdf')}>Download PDF</div>
                        <div className="card-overflow-item" onClick={() => downloadAs(r, 'docx')}>Download DOCX</div>
                        <div className="card-overflow-sep" />
                        <div className="card-overflow-item danger" onClick={() => { handleDelete(r.id); setOverflowOpen(null); }}>Delete</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI preferences drawer for a single resume */}
      {expandedId && resumes.find(r => r.id === expandedId) && (() => {
        const r = resumes.find(x => x.id === expandedId);
        return (
          <div className="card" style={{ padding: 20, marginTop: 16 }}>
            <div className="panel-head">
              <h2>AI preferences — {r.label}</h2>
              <button className="btn btn-xs btn-ghost" onClick={() => setExpandedId(null)}>✕</button>
            </div>
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
            <input type="range" min="60" max="100" value={r.atsTarget || 92}
              onChange={e => changeAtsTarget(r, e.target.value)} style={{ width: '100%' }} />
          </div>
        );
      })()}

      {/* §5 Add Resume — upload or paste, one straightforward flow */}
      <Modal open={addOpen} onClose={() => { resetDraft(); setAddOpen(false); }} title="Add Resume">
        <div className="seg-ctrl" style={{ width: '100%', marginBottom: 14 }}>
          <button className={addMode === 'upload' ? 'active' : ''} onClick={() => setAddMode('upload')}>⇧ Upload file</button>
          <button className={addMode === 'paste' ? 'active' : ''} onClick={() => setAddMode('paste')}>✎ Paste text</button>
        </div>

        {addMode === 'upload' ? (
          <>
            <div className={`upload-drop ${dragOver ? 'drag' : ''}`}
              onClick={() => fileInputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>⇧</div>
              <div className="upload-drop-text">Drag a file here, or <b>browse</b></div>
              <div className="upload-drop-sub">PDF, DOCX, TXT and MD are read automatically</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".docx,.txt,.md,.pdf" style={{ display: 'none' }}
              onChange={e => e.target.files.length && handleFile(e.target.files[0])} />
            {status && (
              status.kind === 'loading' ? <div className="loading" style={{ marginTop: 12 }}><span className="spinner"></span> {status.msg}</div> :
              status.kind === 'error' ? <div className="error-box" style={{ marginTop: 12 }}>{status.msg}</div> :
              <div className="row-card" style={{ marginTop: 12 }}><div className="row-main"><div className="row-icon">{status.kind === 'ok' ? '✓' : '!'}</div><div className="row-title">{status.msg}</div></div></div>
            )}
          </>
        ) : (
          <p className="page-sub" style={{ marginTop: -4 }}>Paste your resume text below — formatting is stripped, content is what matters.</p>
        )}

        {(addMode === 'paste' || draftText || status) && (
          <>
            <div className="field" style={{ marginTop: addMode === 'paste' ? 0 : 16 }}>
              <span className="field-label">{addMode === 'paste' ? 'Resume text' : 'Extracted text — editable'}</span>
              <textarea rows={addMode === 'paste' ? 12 : 7} value={draftText} onChange={e => setDraftText(e.target.value)}
                placeholder="Paste your resume text here." />
            </div>
            <div className="field">
              <span className="field-label">Label this resume</span>
              <input type="text" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="e.g. Backend Engineer — Master" />
            </div>
          </>
        )}

        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => { resetDraft(); setAddOpen(false); }}>Cancel</button>
          <button className="btn btn-primary" disabled={!draftText.trim()} onClick={handleSaveResume}>
            {addMode === 'paste' ? 'Save resume' : 'Upload'}
          </button>
        </div>
      </Modal>

      {/* Read-only full preview — opening a resume shouldn't drop you into a tiny editor */}
      <Modal open={!!previewResume} onClose={() => setPreviewResume(null)} title={previewResume?.label || 'Resume'} wide>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="badge badge-neutral">{(previewResume?.text?.length || 0).toLocaleString()} chars</span>
          {previewResume?.fileName && <span className="badge badge-neutral">{previewResume.fileName}</span>}
          {previewResume?.id === activeResumeId && <span className="badge badge-primary">Default</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => { const r = previewResume; setPreviewResume(null); openEdit(r); }}>Edit text</button>
            <button className="btn btn-sm" onClick={() => downloadAs(previewResume, 'pdf')}>PDF</button>
            <button className="btn btn-sm" onClick={() => downloadAs(previewResume, 'docx')}>DOCX</button>
            <button className="btn btn-sm btn-primary" onClick={() => { setActiveResumeId(previewResume.id); setPreviewResume(null); setView?.('agent'); }}>Tailor →</button>
          </div>
        </div>
        <div className="resume-preview-sheet">{previewResume?.text}</div>
      </Modal>

      <Modal open={!!editingResume} onClose={() => setEditingResume(null)} title={`Edit — ${editingResume?.label || ''}`} wide>
        <textarea rows={20} value={editText} onChange={e => setEditText(e.target.value)} style={{ fontSize: 13, lineHeight: 1.65 }} />
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => setEditingResume(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdit}>Save changes</button>
        </div>
      </Modal>
    </section>
  );
}
