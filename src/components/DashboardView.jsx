import React, { useRef, useState } from 'react';
import { tailorResume, draftEmail, ocrImage } from '../lib/claude.js';
import { buildResumePdf, downloadBlob } from '../lib/pdf.js';
import { buildResumeDocx } from '../lib/docx.js';
import { createGmailDraft } from '../lib/gmail.js';
import { flattenResume } from '../lib/resumeFormat.js';
import { spendCredit } from '../lib/firestore.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import Modal from './Modal.jsx';
import LoaderOverlay from './LoaderOverlay.jsx';
import ResumePreview from './ResumePreview.jsx';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DashboardView({ uid, state, credits, onCreditsChange, notify, goToBilling, goToLibrary }) {
  const { ensureGmailToken } = useAuth();
  const { profileInfo, resumes, activeResumeId } = state;
  const activeResume = resumes.find(r => r.id === activeResumeId);

  const [jdMode, setJdMode] = useState('text');
  const [jdText, setJdText] = useState('');
  const [imgStatus, setImgStatus] = useState(null);
  const fileInputRef = useRef(null);

  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState(null);
  const [tailoredResume, setTailoredResume] = useState(null); // structured { name, contact, sections }
  const [atsScore, setAtsScore] = useState(null);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCompany, setEmailCompany] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  async function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImgStatus({ kind: 'loading', msg: 'Reading text from image...' });
    try {
      const base64 = await fileToBase64(file);
      const text = await ocrImage({ base64, mediaType: file.type || 'image/png' });
      setJdText(text);
      setJdMode('text');
      setImgStatus({ kind: 'ok', msg: `${file.name} — text extracted, review in the text tab` });
    } catch (err) {
      console.error(err);
      setImgStatus({ kind: 'error', msg: "Couldn't read the image. Try a clearer screenshot, or paste text instead." });
    }
  }

  async function handleTailor() {
    if (!jdText.trim()) { alert('Paste or extract a JD first.'); return; }
    if (!activeResume) { alert('Save and activate a resume in Resume library first.'); return; }
    if ((credits ?? 0) <= 0) {
      notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep tailoring' });
      goToBilling?.();
      return;
    }
    setTailoring(true); setTailorError(null);
    try {
      const result = await tailorResume({
        jdText, resumeText: activeResume.text,
        prompts: activeResume.prompts || [],
        atsTarget: activeResume.atsTarget || 90
      });
      setTailoredResume(result.resume);
      setAtsScore(result.atsScore ?? null);

      const remaining = await spendCredit(uid);
      onCreditsChange?.(remaining);
      notify?.({ kind: 'good', title: `Resume tailored for ${emailCompany || 'this JD'}`, detail: `Just now · scored ${result.atsScore}% ATS match` });
      if (remaining <= 3) {
        notify?.({ kind: 'warn', title: 'Credits running low', detail: `${remaining} credits left` });
      }
    } catch (err) {
      console.error(err);
      setTailorError(err.message || 'Tailoring failed. Please try again.');
    }
    setTailoring(false);
  }

  function exportTitle() {
    return `${profileInfo.name || tailoredResume?.name || 'Resume'}_${emailCompany || 'tailored'}`;
  }

  function handleDownloadPdf() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    const { blob, filename } = buildResumePdf(tailoredResume, exportTitle());
    downloadBlob(blob, filename);
  }
  async function handleDownloadDocx() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    const { blob, filename } = await buildResumeDocx(tailoredResume, exportTitle());
    downloadBlob(blob, filename);
  }

  function openEmailModal() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    setSendSuccess(false); setSendError(null);
    setEmailModalOpen(true);
  }

  async function handleGenerateDraft() {
    setDrafting(true); setDraftError(null);
    try {
      const result = await draftEmail({
        jdText, resumeText: flattenResume(tailoredResume),
        company: emailCompany || 'the company',
        contactName: 'Hiring Manager',
        senderName: profileInfo.name || 'Applicant'
      });
      setEmailSubject(result.subject || '');
      setEmailBody(result.body || '');
    } catch (err) {
      console.error(err);
      setDraftError('Draft generation failed. Please try again.');
    }
    setDrafting(false);
  }

  async function handleSend() {
    if (!emailTo.trim()) { alert('Add a recipient email address.'); return; }
    if (!profileInfo.sendingEmail) { alert('Set your sending email in Profile first.'); return; }
    setSending(true); setSendError(null); setSendSuccess(false);
    try {
      const token = await ensureGmailToken();
      if (!token) throw new Error('Gmail authorization was not granted.');
      const { base64, filename, mimeType } = buildResumePdf(tailoredResume, exportTitle());
      await createGmailDraft({
        accessToken: token,
        from: profileInfo.sendingEmail,
        to: emailTo,
        subject: emailSubject,
        body: emailBody,
        attachment: { filename, mimeType, base64 }
      });
      setSendSuccess(true);
    } catch (err) {
      console.error(err);
      setSendError('Could not create the Gmail draft. Make sure you granted Gmail permission at sign-in, then try again.');
    }
    setSending(false);
  }

  return (
    <section>
      <h1 className="page-title">Tailor a resume</h1>
      <p className="page-sub">Drop in a JD — see your tailored resume appear right here, then download or send it.</p>

      <div className="dash-grid">

        {/* LEFT — JD input, active resume, actions. Stays put; doesn't scroll away. */}
        <div>
          <div className="panel">
            <div className="panel-head"><h2>Job description</h2></div>
            <div className="mode-toggle">
              <button className={`mode-btn ${jdMode === 'text' ? 'active' : ''}`} onClick={() => setJdMode('text')}>✎ Paste text</button>
              <button className={`mode-btn ${jdMode === 'image' ? 'active' : ''}`} onClick={() => setJdMode('image')}>⇪ Upload image</button>
            </div>
            {jdMode === 'text' ? (
              <textarea rows={11} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the full job description here..." />
            ) : (
              <div>
                <div className="dropzone" onClick={() => fileInputRef.current.click()}>
                  <div className="dropzone-icon">⇪</div>
                  <div className="dropzone-text">Drag a screenshot here, or <span className="link">browse files</span></div>
                  <div className="dropzone-sub">PNG / JPG — text is read out automatically</div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImage} />
                {imgStatus && (
                  imgStatus.kind === 'loading' ? <div className="loading"><span className="spinner"></span> {imgStatus.msg}</div> :
                  imgStatus.kind === 'error' ? <div className="error-box">{imgStatus.msg}</div> :
                  <div className="row-card" style={{ marginTop: 10 }}><div className="row-main"><div className="row-icon">✓</div><div className="row-title">{imgStatus.msg}</div></div></div>
                )}
              </div>
            )}
            <div className="toolbar">
              <button className="btn btn-ghost btn-sm" onClick={() => { setJdText(''); setTailoredResume(null); setAtsScore(null); }}>Clear</button>
              <button className="btn btn-primary btn-sm" disabled={tailoring} onClick={handleTailor}>
                {tailoring ? 'Tailoring…' : 'Tailor resume →'}
              </button>
            </div>
            {tailorError && <div className="error-box">{tailorError}</div>}
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Active base resume</h2></div>
            <div className="row-card"><div className="row-main"><div className="row-icon">●</div>
              <div className="row-title">{activeResume ? activeResume.label : 'No resume active — set one in Resume library'}</div></div>
              <button className="btn btn-sm btn-ghost" onClick={goToLibrary}>Change →</button>
            </div>
            <div className="anno">Uploading a JD screenshot works the same way — text is read out automatically and dropped in.</div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Send to</h2><span className="count">optional now, required to send</span></div>
            <div className="row-2">
              <div className="field"><span className="field-label">Company</span>
                <input type="text" value={emailCompany} onChange={e => setEmailCompany(e.target.value)} placeholder="Stripe" />
              </div>
              <div className="field"><span className="field-label">Recipient email</span>
                <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="priya.nair@stripe.com" />
              </div>
            </div>
            <div className="action-row">
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleDownloadPdf}>⇩ Download PDF</button>
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleDownloadDocx}>⇩ Download DOCX</button>
              <button className="btn btn-primary" disabled={!tailoredResume} onClick={openEmailModal}>✉ Send email →</button>
            </div>
          </div>
        </div>

        {/* RIGHT — pinned preview. Scrolls internally so a long resume never
            buries the actions on the left below the fold. Renders from the
            exact same structured data the PDF/DOCX exports use, so what you
            see here is what downloads — no reformatting surprises. */}
        <div className="dash-col-right">
          <div className="panel">
            <div className="panel-head"><h2>Tailored resume — live preview</h2><span className="count">{emailCompany || 'untitled application'}</span></div>
            {tailoredResume ? (
              <div className="doc-wrap">
                {atsScore != null && <div className="doc-badge"><span className="dot"></span> {atsScore}% ATS match</div>}
                <div className="doc"><ResumePreview resume={tailoredResume} /></div>
              </div>
            ) : (
              <div className="empty">Tailor a resume on the left to see the preview here.</div>
            )}
          </div>
        </div>

      </div>

      <LoaderOverlay open={tailoring} title="Tailoring your resume" subtitle="This uses 1 credit" />

      <Modal open={emailModalOpen} onClose={() => setEmailModalOpen(false)} title="Email draft">
        <div className="mail-shell">
          <div className="mail-field"><div className="k">From</div><div className="v">{profileInfo.sendingEmail || '— set in Profile —'}</div></div>
          <div className="mail-field"><div className="k">To</div>
            <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="priya.nair@stripe.com" style={{ border: 'none', background: 'transparent' }} />
          </div>
          <div className="mail-field"><div className="k">Subject</div>
            <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Application — Senior Backend Engineer" style={{ border: 'none', background: 'transparent' }} />
          </div>
          <div className="mail-body-wrap">
            <textarea rows={8} style={{ fontFamily: 'var(--sans)', fontSize: '12.5px' }} value={emailBody}
              onChange={e => setEmailBody(e.target.value)} placeholder="Email body will appear here — click Generate draft, or write your own." />
          </div>
          <div className="attach-chip">📎 Tailored resume — attached as PDF on send</div>
        </div>

        <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-ghost btn-sm" disabled={drafting} onClick={handleGenerateDraft}>
            {drafting ? 'Drafting…' : 'Generate draft'}
          </button>
        </div>
        {draftError && <div className="error-box">{draftError}</div>}

        <div className="toolbar">
          <button className="btn btn-primary btn-sm" disabled={sending} onClick={handleSend}>
            {sending ? 'Creating draft…' : 'Send →'}
          </button>
        </div>
        {sending && <div className="loading"><span className="spinner"></span> Creating Gmail draft with attachment...</div>}
        {sendError && <div className="error-box">{sendError}</div>}
        {sendSuccess && <div className="success-box">Draft created in your Gmail account with the resume attached — check your Drafts folder to review and hit send.</div>}
      </Modal>
    </section>
  );
}
