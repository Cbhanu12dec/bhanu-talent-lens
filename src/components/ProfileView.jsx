import React, { useRef, useState } from 'react';
import mammoth from 'mammoth';
import {
  saveProfileInfo, saveResume, deleteResume, uploadResumeFile,
  updateResumePrompts, updateResumeAtsTarget
} from '../lib/firestore.js';

export default function ProfileView({ uid, state }) {
  const { profileInfo, setProfileInfo, resumes, setResumes, activeResumeId, setActiveResumeId } = state;
  const [mode, setMode] = useState('upload'); // 'upload' | 'paste'
  const [draftText, setDraftText] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [status, setStatus] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [newPromptText, setNewPromptText] = useState('');

  const activeResume = resumes.find(r => r.id === activeResumeId);

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
        setStatus({ kind: 'warn', msg: "Can't auto-read this format — switch to Paste text below. Original file is still saved." });
      }
    } catch (err) {
      console.error(err);
      setStatus({ kind: 'error', msg: "Couldn't extract text automatically. Switch to Paste text and enter it manually." });
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  }

  async function handleSaveInfo() {
    await saveProfileInfo(uid, profileInfo);
  }

  async function handleSaveResume() {
    if (!draftText.trim()) { alert('Add resume text (upload or paste) before saving.'); return; }
    let fileUrl = null, fileName = null;
    if (pendingFileRef.current) {
      try {
        const uploaded = await uploadResumeFile(uid, pendingFileRef.current);
        fileUrl = uploaded.url;
        fileName = pendingFileRef.current.name;
      } catch (err) {
        console.error('File upload failed (text still saved):', err);
      }
    }
    const record = await saveResume(uid, {
      label: draftLabel.trim() || 'Untitled resume',
      text: draftText.trim(),
      fileUrl, fileName,
      prompts: [
        'Keep to one page',
        'Favor metrics-driven bullets (%, numbers, outcomes)'
      ],
      atsTarget: 90
    });
    setResumes([record, ...resumes]);
    setActiveResumeId(record.id);
    setDraftText(''); setDraftLabel(''); setStatus(null);
    pendingFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleDelete(id) {
    await deleteResume(uid, id);
    const remaining = resumes.filter(r => r.id !== id);
    setResumes(remaining);
    if (activeResumeId === id) setActiveResumeId(remaining[0]?.id || null);
  }

  async function addPrompt() {
    if (!newPromptText.trim() || !activeResume) return;
    const updated = [...(activeResume.prompts || []), newPromptText.trim()];
    await updateResumePrompts(uid, activeResume.id, updated);
    setResumes(resumes.map(r => r.id === activeResume.id ? { ...r, prompts: updated } : r));
    setNewPromptText('');
  }
  async function removePrompt(idx) {
    if (!activeResume) return;
    const updated = (activeResume.prompts || []).filter((_, i) => i !== idx);
    await updateResumePrompts(uid, activeResume.id, updated);
    setResumes(resumes.map(r => r.id === activeResume.id ? { ...r, prompts: updated } : r));
  }
  async function changeAtsTarget(val) {
    if (!activeResume) return;
    const num = Number(val);
    await updateResumeAtsTarget(uid, activeResume.id, num);
    setResumes(resumes.map(r => r.id === activeResume.id ? { ...r, atsTarget: num } : r));
  }

  return (
    <section>
      <h1 className="page-title">01 · Profile</h1>
      <p className="page-sub">Your info, sending email, resume library, and how TalentLens should tailor for you.</p>

      <div className="panel">
        <div className="panel-head"><h2>Basic info &amp; sending email</h2></div>
        <div className="row-2">
          <div className="field"><span className="field-label">Full name</span>
            <input type="text" value={profileInfo.name || ''} onChange={e => setProfileInfo({ ...profileInfo, name: e.target.value })} placeholder="Alex Rivera" />
          </div>
          <div className="field"><span className="field-label">Sending email — used as "From" on drafts</span>
            <input type="email" value={profileInfo.sendingEmail || ''} onChange={e => setProfileInfo({ ...profileInfo, sendingEmail: e.target.value })} placeholder="alex@rivera.dev" />
          </div>
          <div className="field"><span className="field-label">Phone</span>
            <input type="text" value={profileInfo.phone || ''} onChange={e => setProfileInfo({ ...profileInfo, phone: e.target.value })} placeholder="+1 555 010 1234" />
          </div>
          <div className="field"><span className="field-label">LinkedIn / site</span>
            <input type="text" value={profileInfo.link || ''} onChange={e => setProfileInfo({ ...profileInfo, link: e.target.value })} placeholder="linkedin.com/in/alexrivera" />
          </div>
        </div>
        <div className="anno">Emails you send from the Dashboard use this address as the Gmail draft's From/Reply-to — it must match the Google account you signed in with.</div>
        <div className="toolbar"><button className="btn btn-primary" onClick={handleSaveInfo}>Save info</button></div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Upload or paste resume</h2><span className="count">{resumes.length} saved</span></div>

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
              <div className="dropzone-sub">.docx and .txt/.md are read automatically · other formats saved as-is, paste text manually</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".docx,.txt,.md,.pdf" style={{ display: 'none' }}
              onChange={e => e.target.files.length && handleFile(e.target.files[0])} />
            {status && (
              status.kind === 'loading' ? <div className="loading"><span className="spinner"></span> {status.msg}</div> :
              status.kind === 'error' ? <div className="error-box">{status.msg}</div> :
              <div className="row-card" style={{ marginTop: 10 }}>
                <div className="row-main"><div className="row-icon">{status.kind === 'ok' ? '✓' : '!'}</div><div className="row-title">{status.msg}</div></div>
              </div>
            )}
          </>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">{mode === 'paste' ? 'Paste resume text' : 'Extracted text — editable'}</span>
          <textarea rows={10} value={draftText} onChange={e => setDraftText(e.target.value)}
            placeholder={mode === 'paste' ? 'Paste your resume text here...' : 'Resume text will appear here after upload, or switch to Paste text.'} />
        </div>
        <div className="field">
          <span className="field-label">Label this resume</span>
          <input type="text" value={draftLabel} onChange={e => setDraftLabel(e.target.value)} placeholder="e.g. Backend Engineer — Master" />
        </div>
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => { setDraftText(''); setDraftLabel(''); setStatus(null); pendingFileRef.current = null; }}>Clear</button>
          <button className="btn btn-primary" onClick={handleSaveResume}>Save to library →</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Resume library</h2></div>
        {resumes.length === 0 ? <div className="empty">No resumes saved yet.</div> : resumes.map(r => (
          <div className="row-card" key={r.id}>
            <div className="row-main">
              <div className="row-icon">{r.id === activeResumeId ? '●' : '○'}</div>
              <div>
                <div className="row-title">{r.label} {r.id === activeResumeId && <span className="chip match" style={{ marginLeft: 6 }}>active</span>}</div>
                <div className="row-sub">{r.text.length} chars {r.fileName ? `· ${r.fileName}` : ''}</div>
              </div>
            </div>
            <div className="row-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => setActiveResumeId(r.id)}>Set active</button>
              <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {activeResume && (
        <div className="panel">
          <div className="panel-head"><h2>Resume tailoring prompts</h2><span className="count">applies to: {activeResume.label}</span></div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: -6 }}>Standing instructions TalentLens follows whenever it tailors this resume for a JD.</p>
          <div className="chips">
            {(activeResume.prompts || []).map((p, i) => (
              <div className="chip editable" key={i}>{p} <span className="x" onClick={() => removePrompt(i)}>✕</span></div>
            ))}
          </div>
          <div className="row-2" style={{ marginTop: 12 }}>
            <input type="text" value={newPromptText} onChange={e => setNewPromptText(e.target.value)}
              placeholder="e.g. Emphasize leadership over IC work" onKeyDown={e => e.key === 'Enter' && addPrompt()} />
            <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={addPrompt}>+ Add prompt</button>
          </div>

          <div className="ats-card" style={{ marginTop: 20 }}>
            <div className="ats-ring" style={{ background: `conic-gradient(var(--primary-start) 0% ${activeResume.atsTarget || 90}%, var(--line) ${activeResume.atsTarget || 90}% 100%)` }}>
              <span>{activeResume.atsTarget || 90}%</span>
            </div>
            <div className="ats-copy">
              <div className="h">Target ATS match</div>
              <div className="s">Tailored resumes are generated to hit this score against the JD's keywords before you see them. Lower it if you'd rather stay closer to your original wording.</div>
              <div className="ats-target">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>60%</span>
                <input type="range" min="60" max="100" value={activeResume.atsTarget || 90} onChange={e => changeAtsTarget(e.target.value)} />
                <span className="val">{activeResume.atsTarget || 90}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
