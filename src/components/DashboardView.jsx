import React, { useRef, useState } from 'react';
import { tailorResume, draftEmail, draftThankYouEmail, generateCoverLetter, getJdBreakdown, ocrImages } from '../lib/claude.js';
import { buildResumePdf, downloadBlob } from '../lib/pdf.js';
import { buildResumeDocx } from '../lib/docx.js';
import { createGmailDraft } from '../lib/gmail.js';
import { flattenResume } from '../lib/resumeFormat.js';
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

const QUICK_SUGGESTIONS = [
  'Mirror JD keywords more exactly',
  'Make it punchier — shorter bullets',
  'Lead every bullet with the outcome',
  'Emphasize leadership over IC work',
  'Add more quantified metrics where possible',
  'Tone down the buzzwords'
];

export default function DashboardView({ uid, state, credits, onCreditsChange, notify, goToBilling, goToLibrary }) {
  const { ensureGmailToken } = useAuth();
  const { profileInfo, resumes, activeResumeId } = state;
  const activeResume = resumes.find(r => r.id === activeResumeId);

  const [jdMode, setJdMode] = useState('text');
  const [tailorMode, setTailorMode] = useState('ats');
  const [aggressiveness, setAggressiveness] = useState('complete');
  const [keywordDensity, setKeywordDensity] = useState('medium');
  const [bulletLength, setBulletLength] = useState('medium');
  const [jdText, setJdText] = useState('');
  const [imgStatus, setImgStatus] = useState(null);
  const fileInputRef = useRef(null);

  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState(null);
  const [tailoredResume, setTailoredResume] = useState(null); // structured { name, contact, sections, highlights }
  const [atsScore, setAtsScore] = useState(null);
  const [metTarget, setMetTarget] = useState(true);
  const [atsBreakdown, setAtsBreakdown] = useState(null);
  const [lockedSections, setLockedSections] = useState([]);
  const [previousVersion, setPreviousVersion] = useState(null); // { resume, atsScore } — one-step undo after a regenerate
  const [showHighlights, setShowHighlights] = useState(true);
  const [quickTweak, setQuickTweak] = useState('');
  const [pickedSuggestions, setPickedSuggestions] = useState([]);
  const [queuedKeywords, setQueuedKeywords] = useState([]);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailType, setEmailType] = useState('application'); // 'application' | 'thankyou'
  const [emailStyle, setEmailStyle] = useState('professional');
  const [roleTitle, setRoleTitle] = useState('');
  const [thankYouNotes, setThankYouNotes] = useState('');

  const [jdIntel, setJdIntel] = useState(null);
  const [jdIntelLoading, setJdIntelLoading] = useState(false);
  const [jdIntelError, setJdIntelError] = useState(null);

  const [coverLetterOpen, setCoverLetterOpen] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState('');
  const [coverLetterLoading, setCoverLetterLoading] = useState(false);
  const [coverLetterError, setCoverLetterError] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailCompany, setEmailCompany] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const MAX_JD_IMAGES = 5;

  async function handleImages(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_JD_IMAGES);
    if (!files.length) return;
    if (e.target.files.length > MAX_JD_IMAGES) {
      setImgStatus({ kind: 'warn', msg: `Only the first ${MAX_JD_IMAGES} images were used — that's the limit per JD.` });
    } else {
      setImgStatus({ kind: 'loading', msg: `Reading text from ${files.length} image${files.length > 1 ? 's' : ''}...` });
    }
    try {
      const images = await Promise.all(files.map(async f => ({
        base64: await fileToBase64(f), mediaType: f.type || 'image/png'
      })));
      const text = await ocrImages(images);
      setJdText(text);
      setJdMode('text');
      setImgStatus({ kind: 'ok', msg: `${files.length} image${files.length > 1 ? 's' : ''} — text extracted, review in the text tab` });
    } catch (err) {
      console.error(err);
      setImgStatus({ kind: 'error', msg: "Couldn't read the image(s). Try clearer screenshots, or paste text instead." });
    }
  }

  function toggleSuggestion(s) {
    setPickedSuggestions(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function toggleLockedSection(heading) {
    setLockedSections(prev => prev.includes(heading) ? prev.filter(x => x !== heading) : [...prev, heading]);
  }

  function toggleKeywordQueue(term) {
    setQueuedKeywords(prev => {
      const next = prev.includes(term) ? prev.filter(x => x !== term) : [...prev, term];
      notify?.({ kind: '', title: prev.includes(term) ? `Removed "${term}" from queue` : `Queued "${term}" for next regenerate`, detail: 'Click Regenerate in the panel below to apply' });
      return next;
    });
  }

  function restorePreviousVersion() {
    if (!previousVersion) return;
    setTailoredResume(previousVersion.resume);
    setAtsScore(previousVersion.atsScore);
    setMetTarget(previousVersion.metTarget !== false);
    setAtsBreakdown(previousVersion.breakdown || null);
    setPreviousVersion(null);
  }

  function handleRegenerate() {
    const keywordInstructions = queuedKeywords.map(k => `Explicitly work in the keyword "${k}" somewhere natural.`);
    const extra = [...pickedSuggestions, ...keywordInstructions, ...(quickTweak.trim() ? [quickTweak.trim()] : [])];
    handleTailor(extra);
  }

  async function handleTailor(extraPrompts = []) {
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
        prompts: [...(activeResume.prompts || []), ...extraPrompts],
        atsTarget: activeResume.atsTarget || 90,
        mode: tailorMode, aggressiveness, keywordDensity, bulletLength,
        lockedSections
      });
      // Keep the version being replaced as a one-step undo, so a
      // regenerate is visibly producing something new/comparable rather
      // than silently overwriting with no way to tell.
      if (tailoredResume) setPreviousVersion({ resume: tailoredResume, atsScore, metTarget, breakdown: atsBreakdown });
      setTailoredResume(result.resume);
      setAtsScore(result.atsScore ?? null);
      setMetTarget(result.metTarget !== false);
      setAtsBreakdown(result.breakdown || null);
      setQuickTweak(''); setPickedSuggestions([]); setQueuedKeywords([]);

      // Credits are spent server-side (functions/index.js) — this is just
      // reflecting the authoritative post-spend balance the function
      // returned, not performing the spend itself.
      if (result.creditsRemaining !== undefined) onCreditsChange?.(result.creditsRemaining);
      const verb = extraPrompts.length > 0 ? 'Resume regenerated' : 'Resume tailored';
      if (result.metTarget === false) {
        notify?.({ kind: 'warn', title: `${verb} — below target`, detail: `Scored ${result.atsScore}% ATS match, target is ${activeResume.atsTarget || 90}%. This is its best attempt — try Regenerate below, or adjust the target in Resume library.` });
      } else {
        notify?.({ kind: 'good', title: `${verb} for ${emailCompany || 'this JD'}`, detail: `Just now · scored ${result.atsScore}% ATS match` });
      }
      if (result.creditsRemaining !== undefined && result.creditsRemaining <= 3) {
        notify?.({ kind: 'warn', title: 'Credits running low', detail: `${result.creditsRemaining} credits left` });
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'OUT_OF_CREDITS') {
        notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep tailoring' });
        onCreditsChange?.(0);
        goToBilling?.();
      } else {
        setTailorError(err.message || 'Tailoring failed. Please try again.');
      }
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
      let result;
      if (emailType === 'thankyou') {
        result = await draftThankYouEmail({
          company: emailCompany || 'the company',
          contactName: 'the interviewer',
          senderName: profileInfo.name || 'Applicant',
          roleTitle, notes: thankYouNotes
        });
      } else {
        result = await draftEmail({
          jdText, resumeText: flattenResume(tailoredResume),
          company: emailCompany || 'the company',
          contactName: 'Hiring Manager',
          senderName: profileInfo.name || 'Applicant',
          style: emailStyle
        });
      }
      setEmailSubject(result.subject || '');
      setEmailBody(result.body || '');
    } catch (err) {
      console.error(err);
      setDraftError('Draft generation failed. Please try again.');
    }
    setDrafting(false);
  }

  async function handleAnalyzeJd() {
    if (!jdText.trim()) { alert('Paste or extract a JD first.'); return; }
    if (!activeResume) { alert('Set an active resume in Resume library first.'); return; }
    setJdIntelLoading(true); setJdIntelError(null);
    try {
      const result = await getJdBreakdown({ jdText, resumeText: activeResume.text });
      setJdIntel(result);
    } catch (err) {
      console.error(err);
      setJdIntelError('Could not analyze this JD. Please try again.');
    }
    setJdIntelLoading(false);
  }

  async function handleGenerateCoverLetter() {
    if (!jdText.trim()) { alert('Paste or extract a JD first.'); return; }
    if (!activeResume) { alert('Set an active resume in Resume library first.'); return; }
    setCoverLetterOpen(true); setCoverLetterLoading(true); setCoverLetterError(null);
    try {
      const result = await generateCoverLetter({
        jdText, resumeText: flattenResume(tailoredResume) || activeResume.text,
        company: emailCompany || 'the company', roleTitle,
        senderName: profileInfo.name || 'Applicant'
      });
      setCoverLetterText(result.body || '');
    } catch (err) {
      console.error(err);
      setCoverLetterError('Could not generate a cover letter. Please try again.');
    }
    setCoverLetterLoading(false);
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
                  <div className="dropzone-text">Drag up to {MAX_JD_IMAGES} screenshots here, or <span className="link">browse files</span></div>
                  <div className="dropzone-sub">PNG / JPG — multi-page JDs supported, text is read out and combined automatically</div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImages} />
                {imgStatus && (
                  imgStatus.kind === 'loading' ? <div className="loading"><span className="spinner"></span> {imgStatus.msg}</div> :
                  imgStatus.kind === 'error' ? <div className="error-box">{imgStatus.msg}</div> :
                  imgStatus.kind === 'warn' ? <div className="error-box" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', background: 'var(--warning-dim)' }}>{imgStatus.msg}</div> :
                  <div className="row-card" style={{ marginTop: 10 }}><div className="row-main"><div className="row-icon">✓</div><div className="row-title">{imgStatus.msg}</div></div></div>
                )}
              </div>
            )}

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <span className="field-label">Tailoring mode</span>
              <select value={tailorMode} onChange={e => setTailorMode(e.target.value)} style={{ marginBottom: 10 }}>
                <optgroup label="General">
                  <option value="ats">ATS Optimized</option>
                  <option value="recruiter">Recruiter Optimized</option>
                  <option value="hiring_manager">Hiring Manager Optimized</option>
                  <option value="executive">Executive Resume</option>
                </optgroup>
                <optgroup label="Company style">
                  <option value="faang">FAANG Style</option>
                  <option value="startup">Startup Style</option>
                </optgroup>
                <optgroup label="Industry">
                  <option value="government">Government</option>
                  <option value="banking">Banking</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="telecom">Telecom</option>
                </optgroup>
                <optgroup label="Role">
                  <option value="ai_ml">AI / ML</option>
                  <option value="tpm">TPM</option>
                  <option value="swe">SWE</option>
                </optgroup>
              </select>

              <div className="row-2" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <span className="field-label">Rewrite intensity</span>
                  <select value={aggressiveness} onChange={e => setAggressiveness(e.target.value)}>
                    <option value="conservative">Conservative</option>
                    <option value="balanced">Balanced</option>
                    <option value="complete">Complete rewrite</option>
                  </select>
                </div>
                <div>
                  <span className="field-label">Keyword density</span>
                  <select value={keywordDensity} onChange={e => setKeywordDensity(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <span className="field-label">Bullet length</span>
                  <select value={bulletLength} onChange={e => setBulletLength(e.target.value)}>
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="toolbar">
              <button className="btn btn-ghost btn-sm" onClick={() => { setJdText(''); setTailoredResume(null); setAtsScore(null); setMetTarget(true); setAtsBreakdown(null); setLockedSections([]); setQueuedKeywords([]); setPreviousVersion(null); }}>Clear</button>
              <button className="btn btn-primary btn-sm" disabled={tailoring} onClick={() => handleTailor()}>
                {tailoring ? 'Tailoring…' : 'Tailor resume →'}
              </button>
            </div>
            {tailorError && <div className="error-box">{tailorError}</div>}
          </div>

          {tailoredResume && (
            <div className="panel">
              <div className="panel-head"><h2>Refine &amp; regenerate</h2><span className="count">{pickedSuggestions.length + queuedKeywords.length > 0 ? `${pickedSuggestions.length + queuedKeywords.length} queued · ` : ''}uses 1 more credit</span></div>
              <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>
                Not quite right? Pick a tweak (or write your own) and regenerate — these apply to this
                one regeneration only, they don't change the resume's saved standing prompts.
              </p>
              <div className="chips" style={{ marginBottom: 10 }}>
                {QUICK_SUGGESTIONS.map(s => (
                  <div key={s} className={`chip ${pickedSuggestions.includes(s) ? 'match' : 'add'}`} onClick={() => toggleSuggestion(s)}>
                    {pickedSuggestions.includes(s) ? '✓ ' : '+ '}{s}
                  </div>
                ))}
              </div>

              {tailoredResume.sections?.length > 0 && (
                <>
                  <span className="field-label">Lock sections (best effort — not rewritten)</span>
                  <div className="chips" style={{ marginBottom: 10 }}>
                    {tailoredResume.sections.map(s => (
                      <label key={s.heading} className="chip editable" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={lockedSections.includes(s.heading)} onChange={() => toggleLockedSection(s.heading)}
                          style={{ width: 'auto', margin: 0 }} />
                        {s.heading}
                      </label>
                    ))}
                  </div>
                </>
              )}

              <div className="row-2">
                <input type="text" value={quickTweak} onChange={e => setQuickTweak(e.target.value)}
                  placeholder="Or type a specific tweak..." onKeyDown={e => e.key === 'Enter' && handleRegenerate()} />
                <button className="btn btn-sm btn-primary" style={{ justifySelf: 'start' }} disabled={tailoring} onClick={handleRegenerate}>
                  {tailoring ? 'Regenerating…' : 'Regenerate →'}
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><h2>Active base resume</h2></div>
            <div className="row-card"><div className="row-main"><div className="row-icon">●</div>
              <div className="row-title">{activeResume ? activeResume.label : 'No resume active — set one in Resume library'}</div></div>
              <button className="btn btn-sm btn-ghost" onClick={goToLibrary}>Change →</button>
            </div>
            <div className="anno">Uploading a JD screenshot works the same way — text is read out automatically and dropped in.</div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>JD intelligence</h2><span className="count">optional — no credit cost</span></div>
            <div className="toolbar" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button className="btn btn-ghost btn-sm" disabled={jdIntelLoading} onClick={handleAnalyzeJd}>
                {jdIntelLoading ? 'Analyzing…' : jdIntel ? 'Re-analyze JD' : 'Analyze JD →'}
              </button>
            </div>
            {jdIntelLoading && <div className="loading"><span className="spinner"></span> Breaking down the JD...</div>}
            {jdIntelError && <div className="error-box">{jdIntelError}</div>}
            {jdIntel && (
              <div style={{ marginTop: 12 }}>
                {jdIntel.requiredSkills?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <span className="field-label">Required skills</span>
                    <div className="chips">{jdIntel.requiredSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                  </div>
                )}
                {jdIntel.preferredSkills?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <span className="field-label">Preferred skills</span>
                    <div className="chips">{jdIntel.preferredSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                  </div>
                )}
                {jdIntel.techCategories && Object.entries(jdIntel.techCategories).filter(([, v]) => v?.length).map(([cat, items]) => (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <span className="field-label">{cat}</span>
                    <div className="chips">{items.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                  </div>
                ))}
                {jdIntel.softSkills?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <span className="field-label">Soft skills</span>
                    <div className="chips">{jdIntel.softSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                  </div>
                )}
                {jdIntel.matchMatrix?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <span className="field-label">Match matrix — vs. active resume</span>
                    <table className="contact-table">
                      <tbody>
                        {jdIntel.matchMatrix.map(m => (
                          <tr key={m.term}>
                            <td>{m.term}</td>
                            <td>
                              {m.status === 'strong' && <span className="chip match">✓ Strong match</span>}
                              {m.status === 'partial' && <span className="chip gap">~ Partial</span>}
                              {m.status === 'missing' && <span className="chip" style={{ color: 'var(--error)', borderColor: 'var(--error)' }}>✕ Missing</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {jdIntel.missingKeywords && Object.entries(jdIntel.missingKeywords).filter(([, v]) => v?.length).length > 0 && (
                  <div>
                    <span className="field-label">Missing keywords — queue for next regenerate</span>
                    {Object.entries(jdIntel.missingKeywords).filter(([, v]) => v?.length).map(([cat, terms]) => (
                      <div key={cat} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>{cat}</div>
                        <div className="chips">
                          {terms.map(term => {
                            const queued = queuedKeywords.includes(term);
                            return (
                              <div key={term} className={`chip ${queued ? 'match' : 'add'}`} style={{ cursor: tailoredResume ? 'pointer' : 'default', opacity: tailoredResume ? 1 : 0.5 }}
                                onClick={() => tailoredResume && toggleKeywordQueue(term)}>
                                {queued ? '✓ ' : '+ '}{term}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {!tailoredResume && <div className="anno">Tailor a resume first, then these can be queued into Regenerate.</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Send to</h2><span className="count">optional now, required to send</span></div>
            <div className="row-2">
              <div className="field"><span className="field-label">Company</span>
                <input type="text" value={emailCompany} onChange={e => setEmailCompany(e.target.value)} placeholder="Stripe" />
              </div>
              <div className="field"><span className="field-label">Role title</span>
                <input type="text" value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="Senior Backend Engineer" />
              </div>
              <div className="field"><span className="field-label">Recipient email</span>
                <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="priya.nair@stripe.com" />
              </div>
            </div>
            <div className="action-row">
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleDownloadPdf}>⇩ Download PDF</button>
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleDownloadDocx}>⇩ Download DOCX</button>
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleGenerateCoverLetter}>✎ Cover letter</button>
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
            {tailoredResume && tailoredResume.highlights?.length > 0 && (
              <label className="highlight-toggle" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={showHighlights} onChange={e => setShowHighlights(e.target.checked)} />
                Highlight what changed to match the JD ({tailoredResume.highlights.length} terms)
              </label>
            )}
            {tailoredResume ? (
              <div className="doc-wrap">
                {atsScore != null && (
                  <div className={`doc-badge ${metTarget ? '' : 'doc-badge-warn'}`}>
                    <span className="dot"></span> {atsScore}% ATS match{!metTarget && ' · below target'}
                  </div>
                )}
                <div className="doc"><ResumePreview resume={tailoredResume} showHighlights={showHighlights} /></div>
              </div>
            ) : (
              <div className="empty">Tailor a resume on the left to see the preview here.</div>
            )}

            {atsBreakdown && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <span className="field-label">ATS score breakdown</span>
                <div className="ats-breakdown-grid">
                  {[
                    ['keywordMatch', 'Keyword match'], ['formatting', 'Formatting'], ['experienceRelevance', 'Experience relevance'],
                    ['actionVerbs', 'Action verbs'], ['quantification', 'Quantification'], ['leadership', 'Leadership'],
                    ['technicalDepth', 'Technical depth'], ['industryMatch', 'Industry match'], ['seniority', 'Seniority']
                  ].filter(([key]) => atsBreakdown[key] !== undefined).map(([key, label]) => (
                    <div className="ats-dim" key={key}>
                      <div className="ats-dim-head"><span>{label}</span><span>{atsBreakdown[key]}</span></div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${atsBreakdown[key]}%` }}></div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {previousVersion && (
              <div className="row-card" style={{ marginTop: 12 }}>
                <div className="row-main">
                  <div className="row-icon">↺</div>
                  <div>
                    <div className="row-title">This replaced a version that scored {previousVersion.atsScore}% ATS match</div>
                    <div className="row-sub">Not better? You can go back to it.</div>
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={restorePreviousVersion}>Restore previous</button>
              </div>
            )}
          </div>
        </div>

      </div>

      <LoaderOverlay open={tailoring} title="Tailoring your resume" subtitle="This uses 1 credit" />

      <Modal open={emailModalOpen} onClose={() => setEmailModalOpen(false)} title="Email draft">
        <div className="row-2" style={{ marginBottom: 12 }}>
          <div>
            <span className="field-label">Type</span>
            <select value={emailType} onChange={e => setEmailType(e.target.value)}>
              <option value="application">Application email</option>
              <option value="thankyou">Post-interview thank-you</option>
            </select>
          </div>
          {emailType === 'application' ? (
            <div>
              <span className="field-label">Tone</span>
              <select value={emailStyle} onChange={e => setEmailStyle(e.target.value)}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="startup">Startup</option>
                <option value="faang">FAANG</option>
              </select>
            </div>
          ) : (
            <div>
              <span className="field-label">Notes from the conversation (optional)</span>
              <input type="text" value={thankYouNotes} onChange={e => setThankYouNotes(e.target.value)} placeholder="e.g. discussed the migration project" />
            </div>
          )}
        </div>

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
          {emailType === 'application' && <div className="attach-chip">📎 Tailored resume — attached as PDF on send</div>}
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

      <Modal open={coverLetterOpen} onClose={() => setCoverLetterOpen(false)} title="Cover letter">
        {coverLetterLoading && <div className="loading"><span className="spinner"></span> Writing your cover letter...</div>}
        {coverLetterError && <div className="error-box">{coverLetterError}</div>}
        {!coverLetterLoading && (
          <>
            <textarea rows={14} value={coverLetterText} onChange={e => setCoverLetterText(e.target.value)}
              style={{ fontFamily: 'var(--sans)', fontSize: '12.5px' }} placeholder="Cover letter will appear here." />
            <div className="toolbar">
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(coverLetterText)}>Copy text</button>
              <button className="btn btn-ghost btn-sm" onClick={handleGenerateCoverLetter}>Regenerate</button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
