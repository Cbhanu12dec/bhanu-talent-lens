import React, { useRef, useState } from 'react';
import { tailorResume, draftEmail, draftThankYouEmail, generateCoverLetter, getJdBreakdown, getResumeHealth, ocrImages } from '../lib/claude.js';
import { buildResumePdf, downloadBlob } from '../lib/pdf.js';
import { buildResumeDocx } from '../lib/docx.js';
import { createGmailDraft } from '../lib/gmail.js';
import { flattenResume } from '../lib/resumeFormat.js';
import { resumeToLines } from '../lib/diff.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import Modal from './Modal.jsx';
import LoaderOverlay from './LoaderOverlay.jsx';
import ResumePreview from './ResumePreview.jsx';
import DiffModal from './DiffModal.jsx';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Guarantees a locked section is truly untouched — not just prompt-level
// "best effort" — by splicing the OLD (pre-regenerate) section content back
// in place of whatever the model returned for that heading this time.
function applyLockedSections(oldResume, newResume, lockedHeadings) {
  if (!oldResume || !lockedHeadings.length) return newResume;
  const oldByHeading = Object.fromEntries((oldResume.sections || []).map(s => [s.heading, s]));
  return {
    ...newResume,
    sections: (newResume.sections || []).map(s =>
      lockedHeadings.includes(s.heading) && oldByHeading[s.heading] ? oldByHeading[s.heading] : s
    )
  };
}

function atsTier(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'fair';
  return 'weak';
}
function atsTierLabel(score) {
  return { excellent: 'Excellent', good: 'Good', fair: 'Fair', weak: 'Needs work' }[atsTier(score)];
}

function promptsFromAiPreferences(prefs) {
  if (!prefs) return [];
  const out = [];
  if (prefs.preferStar) out.push('Favor STAR-format bullets (Situation, Task, Action, Result) where the underlying experience supports it.');
  if (prefs.avoidBuzzwords) out.push('Avoid generic buzzwords like "synergy," "team player," "results-driven," and similar filler phrases.');
  if (prefs.leadershipEmphasis) out.push('Emphasize leadership, scope, and stakeholder impact over individual-contributor framing where the resume supports it.');
  if (prefs.technicalDepth) out.push('Emphasize technical depth — architecture and implementation decisions — where the resume supports it.');
  if (prefs.backendFocus) out.push('Where work spans both frontend and backend, lean toward backend framing by default.');
  if (prefs.preferredLanguage?.trim()) out.push(`Where relevant and truthful, favor ${prefs.preferredLanguage.trim()} in technical framing.`);
  return out;
}

const QUICK_SUGGESTIONS = [
  'Mirror JD keywords more exactly',
  'Make it punchier — shorter bullets',
  'Lead every bullet with the outcome',
  'Emphasize leadership over IC work',
  'Add more quantified metrics where possible',
  'Tone down the buzzwords'
];

const TABS = [
  { key: 'jd', label: 'Job description' },
  { key: 'analyze', label: 'JD analysis' }
];

export default function DashboardView({ uid, state, credits, onCreditsChange, notify, goToBilling, goToLibrary }) {
  const { ensureGmailToken } = useAuth();
  const { profileInfo, resumes, activeResumeId } = state;
  const activeResume = resumes.find(r => r.id === activeResumeId);

  const [tab, setTab] = useState('jd');

  const [jdMode, setJdMode] = useState('text');
  const [tailorMode, setTailorMode] = useState('ats');
  const [intensity, setIntensity] = useState('balanced');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jdText, setJdText] = useState('');
  const [imgStatus, setImgStatus] = useState(null);
  const fileInputRef = useRef(null);

  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState(null);
  const [tailoredResume, setTailoredResume] = useState(null);
  const [atsScore, setAtsScore] = useState(null);
  const [metTarget, setMetTarget] = useState(true);
  const [atsBreakdown, setAtsBreakdown] = useState(null);
  const [lockedSections, setLockedSections] = useState([]);
  const [previousVersion, setPreviousVersion] = useState(null);
  const [showHighlights, setShowHighlights] = useState(false);
  const [showMatchMatrix, setShowMatchMatrix] = useState(false);
  const [quickTweak, setQuickTweak] = useState('');
  const [pickedSuggestions, setPickedSuggestions] = useState([]);
  const [queuedKeywords, setQueuedKeywords] = useState([]);

  const [refineOpen, setRefineOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState(null);
  const [diffOpen, setDiffOpen] = useState(false);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailType, setEmailType] = useState('application');
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
  const queuedCount = pickedSuggestions.length + queuedKeywords.length + (quickTweak.trim() ? 1 : 0);

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
      notify?.({ kind: '', title: prev.includes(term) ? `Removed "${term}" from queue` : `Queued "${term}"`, detail: 'Open Refine to review and apply' });
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
    if (!jdText.trim()) { alert('Paste or extract a JD first.'); setTab('jd'); return; }
    if (!activeResume) { alert('Save and activate a resume in Resume library first.'); return; }
    if ((credits ?? 0) <= 0) {
      notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep tailoring' });
      goToBilling?.();
      return;
    }
    setTailoring(true); setTailorError(null);
    const priorResume = tailoredResume;
    try {
      const result = await tailorResume({
        jdText, resumeText: activeResume.text,
        prompts: [...promptsFromAiPreferences(profileInfo.aiPreferences), ...(activeResume.prompts || []), ...extraPrompts],
        atsTarget: activeResume.atsTarget || profileInfo.aiPreferences?.atsTarget || 90,
        mode: tailorMode, intensity,
        lockedSections
      });
      const finalResume = applyLockedSections(priorResume, result.resume, lockedSections);

      if (priorResume) setPreviousVersion({ resume: priorResume, atsScore, metTarget, breakdown: atsBreakdown });
      setTailoredResume(finalResume);
      setAtsScore(result.atsScore ?? null);
      setMetTarget(result.metTarget !== false);
      setAtsBreakdown(result.breakdown || null);
      setQuickTweak(''); setPickedSuggestions([]); setQueuedKeywords([]);
      setRefineOpen(false);

      if (result.creditsRemaining !== undefined) onCreditsChange?.(result.creditsRemaining);
      const verb = extraPrompts.length > 0 ? 'Resume regenerated' : 'Resume tailored';
      if (result.metTarget === false) {
        notify?.({ kind: 'warn', title: `${verb} — below target`, detail: `Scored ${result.atsScore}% ATS match, target is ${activeResume.atsTarget || 90}%. This is its best attempt — try Regenerate, or adjust the target in Resume library.` });
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

  function handleClear() {
    setJdText(''); setTailoredResume(null); setAtsScore(null); setMetTarget(true);
    setAtsBreakdown(null); setLockedSections([]); setQueuedKeywords([]);
    setPickedSuggestions([]); setQuickTweak(''); setPreviousVersion(null);
    setShowHighlights(false); setShowMatchMatrix(false);
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
  function handleDownloadTxt() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    const blob = new Blob([flattenResume(tailoredResume)], { type: 'text/plain' });
    downloadBlob(blob, `${exportTitle().replace(/[^a-z0-9\-_]+/gi, '_')}.txt`);
  }

  function openEmailModal() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    setSendSuccess(false); setSendError(null);
    setEmailModalOpen(true);
  }

  function openDiff() {
    if (!tailoredResume) { alert('Tailor a resume first.'); return; }
    setDiffOpen(true);
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

  function healthScore(h) {
    if (!h) return null;
    const penalty = (h.buzzwords?.length || 0) * 3 + (h.passiveVoiceBullets?.length || 0) * 4 +
      (h.weakBullets?.length || 0) * 5 + (h.longBullets?.length || 0) * 2 + (h.grammarIssues?.length || 0) * 6;
    return Math.max(0, Math.min(100, 100 - penalty));
  }

  async function handleCheckHealth() {
    const text = flattenResume(tailoredResume) || activeResume?.text;
    if (!text) { alert('Tailor a resume first, or set an active resume in Resume library.'); return; }
    setHealthLoading(true); setHealthError(null);
    try {
      const result = await getResumeHealth({ resumeText: text });
      setHealth(result);
    } catch (err) {
      console.error(err);
      setHealthError('Could not run the health check. Please try again.');
    }
    setHealthLoading(false);
  }

  async function handleAnalyzeJd() {
    if (!jdText.trim()) { alert('Paste or extract a JD first.'); setTab('jd'); return; }
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

  const diffOldLines = previousVersion ? resumeToLines(previousVersion.resume) : (activeResume ? activeResume.text.split('\n').filter(l => l.trim()) : []);
  const diffOldLabel = previousVersion ? 'previous tailored version' : 'your original base resume';
  const diffNewLines = resumeToLines(tailoredResume);

  return (
    <section>
      <h1 className="page-title">Tailor a resume</h1>
      <p className="page-sub">Drop in a JD — see your tailored resume appear right here, then download or send it.</p>

      <div className="dash-grid">

        <div>
          <div className="dash-subnav">
            {TABS.map(t => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'jd' && (
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
                <span className="field-label">Tailoring intensity</span>
                <div className="intensity-picker">
                  <button type="button" className={intensity === 'conservative' ? 'active' : ''} onClick={() => setIntensity('conservative')}>
                    <span className="intensity-title">Conservative</span>
                    <span className="intensity-desc">Light touch, stays close to your original wording</span>
                  </button>
                  <button type="button" className={intensity === 'balanced' ? 'active' : ''} onClick={() => setIntensity('balanced')}>
                    <span className="intensity-title">Balanced <span className="intensity-rec">Recommended</span></span>
                    <span className="intensity-desc">Rewrites where it helps, keeps a recognizable throughline</span>
                  </button>
                  <button type="button" className={intensity === 'aggressive' ? 'active' : ''} onClick={() => setIntensity('aggressive')}>
                    <span className="intensity-title">Aggressive</span>
                    <span className="intensity-desc">Full reconstruction, maximum keyword coverage</span>
                  </button>
                </div>

                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowAdvanced(v => !v)}>
                  {showAdvanced ? '▾ Hide advanced styling' : '▸ Advanced styling (optional)'}
                </button>
                {showAdvanced && (
                  <div style={{ marginTop: 10 }}>
                    <span className="field-label">Tailoring style</span>
                    <select value={tailorMode} onChange={e => setTailorMode(e.target.value)}>
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
                  </div>
                )}
              </div>

              <div className="row-card" style={{ marginTop: 14 }}>
                <div className="row-main"><div className="row-icon">●</div>
                  <div className="row-title">{activeResume ? activeResume.label : 'No resume active — set one in Resume library'}</div></div>
                <button className="btn btn-sm btn-ghost" onClick={goToLibrary}>Change →</button>
              </div>

              <div className="toolbar">
                <button className="btn btn-ghost btn-sm" onClick={handleClear}>Clear</button>
                <button className="btn btn-primary btn-sm" disabled={tailoring} onClick={() => handleTailor()}>
                  {tailoring ? 'Tailoring…' : 'Tailor resume →'}
                </button>
              </div>
              {tailorError && <div className="error-box">{tailorError}</div>}
            </div>
          )}

          {tab === 'analyze' && (
            <div className="panel">
              <div className="panel-head"><h2>JD analysis</h2><span className="count">optional — no credit cost</span></div>
              <div className="toolbar" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                <button className="btn btn-ghost btn-sm" disabled={jdIntelLoading} onClick={handleAnalyzeJd}>
                  {jdIntelLoading ? 'Analyzing…' : jdIntel ? 'Re-analyze JD' : 'Analyze JD →'}
                </button>
              </div>
              {jdIntelLoading && <div className="loading"><span className="spinner"></span> Breaking down the JD...</div>}
              {jdIntelError && <div className="error-box">{jdIntelError}</div>}
              {!jdIntel && !jdIntelLoading && <div className="empty" style={{ marginTop: 10 }}>Run analysis to see required skills, a match matrix against your resume, and missing keywords, broken down clearly instead of a wall of text.</div>}
              {jdIntel && (
                <div style={{ marginTop: 12 }}>
                  {jdIntel.requiredSkills?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <span className="field-label">Required skills</span>
                      <div className="chips">{jdIntel.requiredSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                    </div>
                  )}
                  {jdIntel.preferredSkills?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <span className="field-label">Preferred skills</span>
                      <div className="chips">{jdIntel.preferredSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                    </div>
                  )}
                  {jdIntel.techCategories && Object.entries(jdIntel.techCategories).filter(([, v]) => v?.length).map(([cat, items]) => {
                    const matchedCount = items.filter(item =>
                      jdIntel.matchMatrix?.some(m => m.term.toLowerCase() === item.toLowerCase() && m.status === 'strong')
                    ).length;
                    return (
                      <div key={cat} style={{ marginBottom: 14 }}>
                        <div className="skill-group-head">
                          <span className="field-label" style={{ marginBottom: 0 }}>{cat}</span>
                          {jdIntel.matchMatrix?.length > 0 && <span className="skill-group-count">{matchedCount}/{items.length} matched</span>}
                        </div>
                        {jdIntel.matchMatrix?.length > 0 && (
                          <div className="bar-track" style={{ marginBottom: 8 }}><div className="bar-fill" style={{ width: `${items.length ? (matchedCount / items.length) * 100 : 0}%` }}></div></div>
                        )}
                        <div className="chips">{items.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                      </div>
                    );
                  })}
                  {jdIntel.softSkills?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <span className="field-label">Soft skills</span>
                      <div className="chips">{jdIntel.softSkills.map(s => <div className="chip" key={s}>{s}</div>)}</div>
                    </div>
                  )}

                  {jdIntel.matchMatrix?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowMatchMatrix(v => !v)}>
                        {showMatchMatrix ? '▾ Hide match matrix' : '▸ View match matrix vs. your resume'}
                      </button>
                      {showMatchMatrix && (
                        <div style={{ marginTop: 10 }}>
                          {jdIntel.matchMatrix.map(m => {
                            const pct = m.status === 'strong' ? 100 : m.status === 'partial' ? 50 : 5;
                            return (
                              <div className="match-row" key={m.term}>
                                <span className="match-row-term">{m.term}</span>
                                <div className="bar-track match-row-bar"><div className={`bar-fill match-fill-${m.status}`} style={{ width: `${pct}%` }}></div></div>
                                <span className={`match-row-pct match-fill-${m.status}`}>{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
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
                      {!tailoredResume && <div className="anno">Tailor a resume first, then these can be queued into Refine.</div>}
                      {tailoredResume && queuedKeywords.length > 0 && (
                        <div className="toolbar" style={{ justifyContent: 'flex-start' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => setRefineOpen(true)}>Open Refine ({queuedKeywords.length} queued) →</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="dash-col-right">
          <div className="panel">
            <div className="panel-head">
              <h2>Tailored resume — live preview</h2>
              {tailoredResume && tailoredResume.highlights?.length > 0 && (
                <button className={`icon-btn ${showHighlights ? 'icon-btn-active' : ''}`} title="Show what changed to match the JD"
                  onClick={() => setShowHighlights(v => !v)}>✨</button>
              )}
            </div>

            <div className="row-2" style={{ marginBottom: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}><span className="field-label">Company</span>
                <input type="text" value={emailCompany} onChange={e => setEmailCompany(e.target.value)} placeholder="Stripe" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}><span className="field-label">Role title</span>
                <input type="text" value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="Senior Backend Engineer" />
              </div>
            </div>

            <div className="action-row" style={{ marginTop: 0, marginBottom: 16 }}>
              <button className="btn btn-primary" disabled={!tailoredResume} onClick={() => setRefineOpen(true)}>
                ✨ Refine{queuedCount > 0 && <span className="subnav-badge" style={{ marginLeft: 6 }}>{queuedCount}</span>}
              </button>
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={openDiff}>⇄ View diff</button>
              <div className="dd-wrap">
                <button className="btn btn-ghost" disabled={!tailoredResume} onClick={() => setDownloadOpen(v => !v)}>⇩ Download ▾</button>
                <div className={`dropdown-panel ${downloadOpen ? 'show' : ''}`} style={{ width: 160 }}>
                  <div className="dd-menu-item" onClick={() => { handleDownloadPdf(); setDownloadOpen(false); }}>PDF</div>
                  <div className="dd-menu-item" onClick={() => { handleDownloadDocx(); setDownloadOpen(false); }}>DOCX</div>
                  <div className="dd-menu-item" onClick={() => { handleDownloadTxt(); setDownloadOpen(false); }}>TXT</div>
                </div>
                {downloadOpen && <div className="dd-backdrop show" onClick={() => setDownloadOpen(false)}></div>}
              </div>
              <button className="btn btn-ghost" disabled={!tailoredResume} onClick={handleGenerateCoverLetter}>✎ Cover letter</button>
              <button className="btn btn-primary" disabled={!tailoredResume} onClick={openEmailModal}>✉ Send email →</button>
            </div>

            {tailoredResume && atsScore != null && (
              <div className="ats-scorecard">
                <div className={`ats-scorecard-num ats-tier-${atsTier(atsScore)}`}>{atsScore}</div>
                <div className="ats-scorecard-body">
                  <div className="ats-scorecard-label">ATS Score</div>
                  <div className={`ats-scorecard-tier ats-tier-${atsTier(atsScore)}`}>{atsTierLabel(atsScore)}</div>
                  <div className="ats-scorecard-meta">
                    {previousVersion && (
                      <span className={atsScore - previousVersion.atsScore >= 0 ? 'ats-delta-up' : 'ats-delta-down'}>
                        {atsScore - previousVersion.atsScore >= 0 ? '+' : ''}{atsScore - previousVersion.atsScore} vs previous
                      </span>
                    )}
                    {jdIntel?.matchMatrix?.length > 0 && (
                      <span>Matched {jdIntel.matchMatrix.filter(m => m.status === 'strong').length} of {jdIntel.matchMatrix.length} requirements</span>
                    )}
                    {!metTarget && <span className="ats-delta-down">Below your {activeResume?.atsTarget || 90}% target</span>}
                  </div>
                </div>
              </div>
            )}

            {tailoredResume ? (
              <div className="doc-wrap">
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

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="field-label" style={{ marginBottom: 0 }}>Resume health</span>
                <button className="btn btn-ghost btn-sm" disabled={healthLoading || (!tailoredResume && !activeResume)} onClick={handleCheckHealth}>
                  {healthLoading ? 'Checking…' : health ? 'Re-check' : 'Check resume health →'}
                </button>
              </div>
              {healthLoading && <div className="loading"><span className="spinner"></span> Scanning for buzzwords, weak bullets, grammar issues...</div>}
              {healthError && <div className="error-box">{healthError}</div>}
              {health && (
                <div className="health-gauge-row">
                  <div className={`health-gauge ats-tier-${atsTier(healthScore(health))}`}>
                    <span>{healthScore(health)}</span>
                  </div>
                  <div className="health-issues">
                    {[
                      ['Buzzwords', health.buzzwords],
                      ['Passive voice', health.passiveVoiceBullets],
                      ['Weak bullets', health.weakBullets?.map(w => w.bullet)],
                      ['Long bullets', health.longBullets],
                      ['Grammar issues', health.grammarIssues]
                    ].map(([label, arr]) => (
                      <div className="health-issue-row" key={label}>
                        <span>{label}</span>
                        <span className={arr?.length ? 'health-issue-count-bad' : 'health-issue-count-ok'}>{arr?.length || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {health && (health.buzzwords?.length > 0 || health.weakBullets?.length > 0) && (
                <div style={{ marginTop: 10 }}>
                  {health.buzzwords?.length > 0 && <div className="chips" style={{ marginBottom: 6 }}>{health.buzzwords.map(b => <div className="chip" style={{ color: 'var(--warning)', borderColor: 'var(--warning-dim)' }} key={b}>{b}</div>)}</div>}
                  {health.weakBullets?.slice(0, 3).map((w, i) => (
                    <div className="anno" key={i} style={{ marginTop: 6 }}>"{w.bullet}" — {w.reason}</div>
                  ))}
                </div>
              )}
            </div>
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

      <Modal open={refineOpen} onClose={() => setRefineOpen(false)} title="Refine & regenerate">
        <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: -8, marginBottom: 14 }}>
          Pick tweaks, lock sections you're happy with, then regenerate. Everything below is
          staged — nothing happens until you click Regenerate. Uses 1 more credit.
        </p>

        <span className="field-label">Suggested tweaks</span>
        <div className="chips" style={{ marginBottom: 14 }}>
          {QUICK_SUGGESTIONS.map(s => (
            <div key={s} className={`chip ${pickedSuggestions.includes(s) ? 'match' : 'add'}`} onClick={() => toggleSuggestion(s)}>
              {pickedSuggestions.includes(s) ? '✓ ' : '+ '}{s}
            </div>
          ))}
        </div>

        {tailoredResume?.sections?.length > 0 && (
          <>
            <span className="field-label">Lock sections — guaranteed untouched, not just requested</span>
            <div className="chips" style={{ marginBottom: 14 }}>
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

        <span className="field-label">Custom tweak</span>
        <input type="text" value={quickTweak} onChange={e => setQuickTweak(e.target.value)}
          placeholder="Type a specific instruction for this regenerate..." onKeyDown={e => e.key === 'Enter' && handleRegenerate()}
          style={{ marginBottom: 14 }} />

        {queuedCount > 0 && (
          <div className="stage-summary">
            <div className="field-label" style={{ marginBottom: 6 }}>About to apply</div>
            <ul>
              {pickedSuggestions.map(s => <li key={s}>{s}</li>)}
              {queuedKeywords.map(k => <li key={k}>Work in keyword: "{k}"</li>)}
              {quickTweak.trim() && <li>{quickTweak.trim()}</li>}
            </ul>
            {lockedSections.length > 0 && <div className="stage-locked">🔒 {lockedSections.join(', ')} will stay exactly as-is</div>}
          </div>
        )}

        <div className="toolbar">
          <button className="btn btn-primary btn-sm" disabled={tailoring} onClick={handleRegenerate}>
            {tailoring ? 'Regenerating…' : 'Regenerate →'}
          </button>
        </div>
      </Modal>

      <DiffModal open={diffOpen} onClose={() => setDiffOpen(false)}
        oldLines={diffOldLines} newLines={diffNewLines} oldLabel={diffOldLabel} highlights={tailoredResume?.highlights} />

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
