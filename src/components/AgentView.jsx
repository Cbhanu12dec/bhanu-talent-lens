import React, { useState, useEffect, useRef } from 'react';
import {
  listCareerProfiles, listDomainsPublic, createJobDescription, createAgentRun,
  updateAgentRun, getResumeVersion, updateResumeVersionChanges, updateQualityFlag
} from '../lib/firestore.js';
import {
  parseJobDescription, analyzeAgentRun, buildAgentResume, tailorResume, getJdBreakdown,
  ocrImages, generateCoverLetter, draftEmail
} from '../lib/claude.js';
import { buildResumePdf, downloadBlob } from '../lib/pdf.js';
import { buildResumeDocx } from '../lib/docx.js';
import { diffLines, resumeToLines } from '../lib/diff.js';
import { flattenResume } from '../lib/resumeFormat.js';
import { createGmailDraft } from '../lib/gmail.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import ResumePreview from './ResumePreview.jsx';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Three steps now — Review and Export are merged, since export is just an
// action bar (download / email / cover letter) sitting under the resume
// you're already reviewing, not a separate destination.
const STEPS = [
  { key: 'setup', label: 'Setup', desc: 'Profile, domain, JD' },
  { key: 'build', label: 'Build', desc: 'Analyze & generate' },
  { key: 'review', label: 'Review & Export', desc: 'Refine, download, send' },
];

function StepNav({ currentStep }) {
  const idx = STEPS.findIndex(s => s.key === currentStep);
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className={`step ${i < idx ? 'done' : i === idx ? 'current' : 'upcoming'}`}>
            <div className="num">{i < idx ? '✓' : i + 1}</div>
            <div className="lbl"><span className="t">{s.label}</span><span className="d">{s.desc}</span></div>
          </div>
          {i < STEPS.length - 1 && <div className="step-connector" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head"><h2>Start From</h2></div>
      <p className="field-hint" style={{ marginBottom: 10 }}>Build a resume from scratch, or tailor one you already have.</p>
      <div className="seg-ctrl">
        <button className={mode === 'scratch' ? 'active' : ''} onClick={() => onChange('scratch')}>Build from scratch</button>
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => onChange('existing')}>Tailor existing resume</button>
      </div>
    </div>
  );
}

// Shared JD input — paste text or drag/upload screenshots (OCR'd automatically).
function JdInput({ jdText, setJdText, jdMode, setJdMode, imgStatus, setImgStatus }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const MAX_JD_IMAGES = 5;

  async function handleImages(files) {
    files = Array.from(files || []).slice(0, MAX_JD_IMAGES);
    if (!files.length) return;
    setImgStatus({ kind: 'loading', msg: `Reading text from ${files.length} image${files.length > 1 ? 's' : ''}…` });
    try {
      const images = await Promise.all(files.map(async f => ({ base64: await fileToBase64(f), mediaType: f.type || 'image/png' })));
      const text = await ocrImages(images);
      setJdText(text);
      setJdMode('text');
      setImgStatus({ kind: 'ok', msg: `${files.length} image${files.length > 1 ? 's' : ''} — text extracted, review below` });
    } catch (err) {
      console.error(err);
      setImgStatus({ kind: 'error', msg: "Couldn't read the image(s). Try clearer screenshots, or paste text instead." });
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head"><h2>Job description</h2></div>
      <div className="mode-toggle">
        <button className={`mode-btn ${jdMode === 'text' ? 'active' : ''}`} onClick={() => setJdMode('text')}>✎ Paste text</button>
        <button className={`mode-btn ${jdMode === 'image' ? 'active' : ''}`} onClick={() => setJdMode('image')}>⇪ Upload image</button>
      </div>
      {jdMode === 'text' ? (
        <textarea rows={10} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the complete job description here…" />
      ) : (
        <div>
          <div
            className={`dropzone${dragOver ? ' drag' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleImages(e.dataTransfer.files); }}
          >
            <div className="dropzone-icon">⇪</div>
            <div className="dropzone-text">Drag up to {MAX_JD_IMAGES} screenshots here, or <span className="link">browse files</span></div>
            <div className="dropzone-sub">PNG / JPG — multi-page JDs supported, text is read out and combined automatically</div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleImages(e.target.files)} />
          {imgStatus && (
            imgStatus.kind === 'loading' ? <div className="loading"><span className="spinner" /> {imgStatus.msg}</div> :
            imgStatus.kind === 'error' ? <div className="error-box" style={{ marginTop: 10 }}>{imgStatus.msg}</div> :
            <div className="row-card" style={{ marginTop: 10 }}><div className="row-main"><div className="row-icon">✓</div><div className="row-title">{imgStatus.msg}</div></div></div>
          )}
        </div>
      )}
    </div>
  );
}

const LEVELS = ['Conservative', 'Balanced', 'Aggressive'];

const BUILD_STAGES = {
  scratch: ['Reading your career profile…', 'Analyzing the job description…', 'Mapping evidence against domain intelligence…', 'Writing your resume…', 'Optimizing for ATS…'],
  existing: ['Reading your base resume…', 'Analyzing the job description…', 'Rewriting against the JD…', 'Optimizing for ATS…'],
};

export default function AgentView({ uid, state, notify, credits, onCreditsChange }) {
  const { resumes, profileInfo } = state;
  const { ensureGmailToken } = useAuth();
  const [mode, setMode] = useState('scratch');
  const [step, setStep] = useState('setup');
  const [runId, setRunId] = useState(null);

  // Setup state — scratch mode
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [domains, setDomains] = useState([]);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [domainSwitcherOpen, setDomainSwitcherOpen] = useState(false);

  // Setup state — existing mode
  const [baseResumeId, setBaseResumeId] = useState('');
  const [tailoringLevel, setTailoringLevel] = useState('Balanced');

  // Shared setup state
  const [jdText, setJdText] = useState('');
  const [jdMode, setJdMode] = useState('text');
  const [imgStatus, setImgStatus] = useState(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Build state — scratch mode
  const [jobDescription, setJobDescription] = useState(null);
  const [findings, setFindings] = useState(null);
  const [strategy, setStrategy] = useState(null);

  // Build state — existing mode
  const [jdIntel, setJdIntel] = useState(null);
  const [diffOps, setDiffOps] = useState([]);

  // Build state — shared
  const [buildLog, setBuildLog] = useState([]);
  const [buildStageIdx, setBuildStageIdx] = useState(0);
  const [buildDone, setBuildDone] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Review state
  const [version, setVersion] = useState(null);
  const [reviewTab, setReviewTab] = useState('resume');
  const [showHighlights, setShowHighlights] = useState(true);
  const [rebuildSections, setRebuildSections] = useState({ summary: true, experience: true });
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [rebuildNotes, setRebuildNotes] = useState('');

  // Export state
  const [exportFormat, setExportFormat] = useState('pdf');
  const [coverLetterOpen, setCoverLetterOpen] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState('');
  const [coverLetterLoading, setCoverLetterLoading] = useState(false);
  const [coverLetterError, setCoverLetterError] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    listDomainsPublic().then(setDomains);
    listCareerProfiles(uid).then(list => {
      setProfiles(list);
      setProfileId(list.find(p => p.isDefault)?.id || list[0]?.id || '');
    });
  }, [uid]);

  const profile = profiles.find(p => p.id === profileId) || null;
  const baseResume = resumes.find(r => r.id === baseResumeId);

  function addLog(text) {
    setBuildLog(prev => [...prev, { time: new Date().toLocaleTimeString(), text }]);
  }
  function advanceStage() {
    setBuildStageIdx(i => i + 1);
  }

  function resetBuildState() {
    setBuildLog([]); setBuildDone(false); setVersion(null); setBuildStageIdx(0);
    setJobDescription(null); setFindings(null); setStrategy(null);
    setJdIntel(null); setDiffOps([]);
    setCoverLetterOpen(false); setCoverLetterText(''); setEmailOpen(false); setSendSuccess(false);
  }

  /* ============================= SCRATCH MODE PIPELINE ============================= */
  async function runScratchPipeline() {
    if (!jdText.trim() || !selectedDomainId || !profile) return;
    if (!profile.experience?.length) { setError('Add at least one experience entry to this Career Profile first.'); return; }
    setError(''); setLoading(true); setStep('build'); resetBuildState();

    try {
      addLog(BUILD_STAGES.scratch[0]); advanceStage();
      const jdDoc = await createJobDescription(uid, jdText.trim());
      const runDoc = await createAgentRun(uid, { careerProfileSnapshot: profile, domainId: selectedDomainId, jobDescriptionId: jdDoc.id });
      setRunId(runDoc.id);

      addLog(BUILD_STAGES.scratch[1]); advanceStage();
      const parsed = await parseJobDescription(jdDoc.id, jdText.trim());
      const fullJd = { ...jdDoc, ...parsed };
      setJobDescription(fullJd);

      addLog(BUILD_STAGES.scratch[2]); advanceStage();
      const strat = await analyzeAgentRun({ agentRunId: runDoc.id, careerProfile: profile, jobDescription: fullJd, domainId: selectedDomainId });
      setFindings({ roleMatch: strat.roleMatch, strongestEvidence: strat.strongestEvidence || [], gaps: [] });
      setStrategy(strat);
      await updateAgentRun(uid, runDoc.id, { currentStep: 'strategy', strategySnapshot: strat, jobDescriptionParsed: fullJd });

      addLog(BUILD_STAGES.scratch[3]); advanceStage();
      const withInstructions = { ...strat, positioning: appendCustom(strat.positioning, customInstructions) };
      const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
        agentRunId: runDoc.id, careerProfile: profile, jobDescription: fullJd, strategy: withInstructions, domainId: selectedDomainId,
      });
      addLog(BUILD_STAGES.scratch[4]); advanceStage();
      addLog(`Build complete — match score ${matchScore}%`);
      setBuildDone(true);
      const v = await getResumeVersion(uid, versionId);
      setVersion(v);
      if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
      notify?.({ kind: 'good', title: 'Resume built', detail: `ATS match score: ${matchScore}%` });
      setStep('review'); setReviewTab('resume');
    } catch (err) {
      console.error(err);
      addLog(`Failed: ${err.message}`);
      setError(err.message || 'Something went wrong. Please try again.');
      if (err.code === 'OUT_OF_CREDITS') notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep building' });
    }
    setLoading(false);
  }

  function appendCustom(base, custom) {
    return custom?.trim() ? `${base || ''}\nAdditional instructions: ${custom.trim()}` : base;
  }

  async function handleRegenerateScratch() {
    if (!strategy || !jobDescription || !runId || !profile) return;
    setRegenerating(true); setError('');
    const updatedStrategy = { ...strategy, positioning: appendCustom(strategy.positioning, customInstructions) };
    addLog('Rebuilding with your instructions…');
    try {
      const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
        agentRunId: runId, careerProfile: profile, jobDescription, strategy: updatedStrategy, domainId: selectedDomainId,
      });
      addLog(`Build complete — match score ${matchScore}%`);
      const v = await getResumeVersion(uid, versionId);
      setVersion(v);
      if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Regenerate failed.');
    }
    setRegenerating(false);
  }

  /* ============================= EXISTING-RESUME PIPELINE ============================= */
  async function runTailorPipeline() {
    if (!jdText.trim() || !baseResume) return;
    setError(''); setLoading(true); setStep('build'); resetBuildState();

    try {
      addLog(BUILD_STAGES.existing[0]); advanceStage();
      addLog(BUILD_STAGES.existing[1]); advanceStage();
      let intel = null;
      try {
        intel = await getJdBreakdown({ jdText: jdText.trim(), resumeText: baseResume.text });
        setJdIntel(intel);
      } catch (err) {
        console.warn('JD breakdown failed (non-fatal):', err);
      }

      addLog(BUILD_STAGES.existing[2]); advanceStage();
      await generateTailoredVersion(baseResume, customInstructions.trim() ? [customInstructions.trim()] : []);
      advanceStage();
      setStep('review'); setReviewTab('resume');
    } catch (err) {
      console.error(err);
      addLog(`Failed: ${err.message}`);
      setError(err.message || 'Something went wrong. Please try again.');
      if (err.code === 'OUT_OF_CREDITS') notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep building' });
    }
    setLoading(false);
  }

  async function generateTailoredVersion(baseR, extraPrompts = [], intensityOverride) {
    const { resume, atsScore, creditsRemaining } = await tailorResume({
      jdText: jdText.trim(), resumeText: baseR.text,
      prompts: [...(baseR.prompts || []), ...extraPrompts],
      atsTarget: baseR.atsTarget || 92, intensity: (intensityOverride || tailoringLevel).toLowerCase(), allowRetry: true,
    });
    addLog(`Build complete — match score ${atsScore}%`);
    setBuildDone(true);

    const oldLines = (baseR.text || '').split('\n').filter(l => l.trim());
    const newLines = resumeToLines(resume);
    setDiffOps(diffLines(oldLines, newLines).filter(op => op.type !== 'same'));

    setVersion({ id: `tailor_${Date.now()}`, content: resume, matchScore: atsScore, changes: null, requirementMatches: null, flags: null });
    if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
    notify?.({ kind: 'good', title: 'Resume tailored', detail: `ATS match score: ${atsScore}%` });
    return resume;
  }

  async function handleRetailor() {
    if (!baseResume) return;
    setRegenerating(true); setError('');
    addLog('Re-tailoring with your instructions…');
    try {
      await generateTailoredVersion(baseResume, customInstructions.trim() ? [customInstructions.trim()] : []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Re-tailor failed.');
    }
    setRegenerating(false);
  }

  /* ============================= AGGRESSIVE REBUILD ============================= */
  function buildRebuildDirective() {
    const parts = [];
    if (rebuildSections.summary) parts.push('Completely rewrite the Professional Summary from scratch — do not reuse any previous phrasing. Lead with the strongest, most JD-relevant positioning.');
    if (rebuildSections.experience) parts.push('Completely rewrite every Experience bullet from scratch — restructure, re-order and re-word aggressively for maximum JD alignment, while keeping every claim truthful to the source evidence.');
    if (selectedKeywords.length) parts.push(`Naturally incorporate these missing keywords wherever the candidate's real evidence supports them: ${selectedKeywords.join(', ')}.`);
    if (rebuildNotes.trim()) parts.push(rebuildNotes.trim());
    return parts.join(' ');
  }

  async function handleAggressiveRebuild() {
    const directive = buildRebuildDirective();
    if (!directive) { setError('Select a section, a keyword, or add an instruction before rebuilding.'); return; }
    setRegenerating(true); setError('');
    try {
      if (mode === 'scratch') {
        if (!strategy || !jobDescription || !runId || !profile) throw new Error('Missing run context — start a new run.');
        const updatedStrategy = { ...strategy, positioning: appendCustom(strategy.positioning, directive) };
        const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
          agentRunId: runId, careerProfile: profile, jobDescription, strategy: updatedStrategy, domainId: selectedDomainId,
        });
        const v = await getResumeVersion(uid, versionId);
        setVersion(v);
        if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
        notify?.({ kind: 'good', title: 'Resume rebuilt', detail: `ATS match score: ${matchScore}%` });
      } else {
        if (!baseResume) throw new Error('Base resume missing — start a new run.');
        await generateTailoredVersion(baseResume, [directive], 'aggressive');
      }
      setSelectedKeywords([]); setRebuildNotes('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Rebuild failed. Please try again.');
    }
    setRegenerating(false);
  }

  /* ============================= SHARED: REVIEW / EXPORT ============================= */
  function exportTitle() {
    return mode === 'scratch'
      ? `${jobDescription?.title || 'Resume'}_${jobDescription?.company || ''}`
      : `${baseResume?.label || 'Resume'}_Tailored`;
  }

  function handleDownload(format) {
    if (!version?.content) return;
    if (format === 'pdf') {
      const { blob, filename } = buildResumePdf(version.content, exportTitle());
      downloadBlob(blob, filename);
    } else {
      buildResumeDocx(version.content, exportTitle()).then(({ blob, filename }) => downloadBlob(blob, filename));
    }
    notify?.({ kind: 'good', title: `${format.toUpperCase()} downloaded`, detail: exportTitle() });
  }

  async function handleGenerateCoverLetter() {
    setCoverLetterOpen(true); setCoverLetterLoading(true); setCoverLetterError(null);
    try {
      const result = await generateCoverLetter({
        jdText, resumeText: flattenResume(version.content),
        company: jobDescription?.company || '', roleTitle: jobDescription?.title || '',
        senderName: profileInfo?.name || 'Applicant',
      });
      setCoverLetterText(result.body || '');
    } catch (err) {
      console.error(err);
      setCoverLetterError('Could not generate a cover letter. Please try again.');
    }
    setCoverLetterLoading(false);
  }

  function openEmailDraft() {
    setEmailOpen(true); setSendSuccess(false); setSendError(null);
    setEmailTo(''); setEmailSubject(`Application — ${jobDescription?.title || exportTitle()}`);
    draftEmail({
      jdText, resumeText: flattenResume(version.content),
      company: jobDescription?.company || '', contactName: '', senderName: profileInfo?.name || 'Applicant', style: 'professional',
    }).then(r => setEmailBody(r.body || '')).catch(() => {});
  }

  async function handleSendDraft() {
    if (!emailTo.trim()) { setSendError('Add a recipient email address.'); return; }
    if (!profileInfo?.sendingEmail) { setSendError('Set your sending email in Settings first.'); return; }
    setSending(true); setSendError(null); setSendSuccess(false);
    try {
      const token = await ensureGmailToken();
      if (!token) throw new Error('Gmail authorization was not granted.');
      const { base64, filename, mimeType } = buildResumePdf(version.content, exportTitle());
      await createGmailDraft({ accessToken: token, from: profileInfo.sendingEmail, to: emailTo, subject: emailSubject, body: emailBody, attachment: { filename, mimeType, base64 } });
      setSendSuccess(true);
    } catch (err) {
      console.error(err);
      setSendError('Could not create the Gmail draft. Make sure you granted Gmail permission at sign-in, then try again.');
    }
    setSending(false);
  }

  async function handleChangeStatus(changeId, status) {
    if (!version || mode !== 'scratch') return;
    const changes = (version.changes || []).map(c => c.id === changeId ? { ...c, status } : c);
    await updateResumeVersionChanges(uid, version.id, changes);
    setVersion(v => ({ ...v, changes }));
  }
  async function handleAcceptAll() {
    if (!version || mode !== 'scratch') return;
    const changes = (version.changes || []).map(c => ({ ...c, status: 'accepted' }));
    await updateResumeVersionChanges(uid, version.id, changes);
    setVersion(v => ({ ...v, changes }));
    notify?.({ kind: 'good', title: 'All changes accepted', detail: '' });
  }
  async function handleVerifyFlag(flagId) {
    if (!version || mode !== 'scratch') return;
    await updateQualityFlag(uid, version.id, flagId, { status: 'verified' });
    setVersion(v => ({ ...v, flags: (v.flags || []).map(f => f.id === flagId ? { ...f, status: 'verified' } : f) }));
  }

  function handleReset() {
    setStep('setup'); setRunId(null); resetBuildState();
    setJdText(''); setJdMode('text'); setImgStatus(null); setCustomInstructions('');
    setBaseResumeId(''); setTailoringLevel('Balanced');
  }

  const score = version?.matchScore;
  const scoreTier = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'weak';
  const scoreTierLabel = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs work';
  const canAdvance = mode === 'scratch'
    ? Boolean(jdText.trim() && selectedDomainId && profileId)
    : Boolean(jdText.trim() && baseResumeId);
  const stages = BUILD_STAGES[mode];
  const progressPct = buildDone ? 100 : Math.min(95, Math.round((buildStageIdx / stages.length) * 100));
  const highlightTerms = version?.content?.highlights?.length ? version.content.highlights : (mode === 'scratch' ? (strategy?.skillPriority || []) : []);

  // Skill keywords the JD asks for that don't yet appear anywhere in the generated resume.
  const missingKeywords = React.useMemo(() => {
    if (!version?.content) return [];
    const text = flattenResume(version.content).toLowerCase();
    const pool = mode === 'scratch'
      ? [...(version.requirementMatches || []).map(m => m.name), ...(strategy?.skillPriority || []), ...(jobDescription?.requiredSkills || [])]
      : [...(jdIntel?.matchMatrix || []).map(m => m.term)];
    return [...new Set(pool.filter(Boolean).map(String))]
      .filter(k => k.trim() && !text.includes(k.toLowerCase()))
      .slice(0, 24);
  }, [version, strategy, jobDescription, jdIntel, mode]);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <h1 className="page-title">✦ Build / Tailor Resume</h1>
        {step !== 'setup' && <button className="btn btn-ghost btn-sm" onClick={handleReset}>← New run</button>}
      </div>
      <p className="page-sub">One flow for building from scratch or tailoring an existing resume.</p>

      {step === 'setup' && <ModeToggle mode={mode} onChange={setMode} />}
      <StepNav currentStep={step} />

      {/* ========== STEP 1: SETUP ========== */}
      {step === 'setup' && (
        <div style={{ maxWidth: 640 }}>
          {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

          {mode === 'scratch' ? (
            <>
              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Career profile</h2></div>
                {profiles.length === 0 ? <div className="empty">No career profiles found.</div> : (
                  <div className="profile-switcher" style={{ position: 'relative' }}>
                    <button className="profile-switcher-btn" onClick={() => setProfileSwitcherOpen(v => !v)}>
                      <div className="profile-avatar">{(profile?.name || 'P').charAt(0).toUpperCase()}</div>
                      <div style={{ textAlign: 'left' }}>
                        <div className="profile-switcher-name">
                          {profile?.name || '— Choose a profile —'}
                          {profile?.isDefault && <span className="badge badge-violet" style={{ marginLeft: 8 }}>Default</span>}
                        </div>
                        {profile && <div className="profile-switcher-meta">{profile.experience?.length || 0} experience · {profile.skills?.length || 0} skills</div>}
                      </div>
                      <span className="profile-switcher-chevron">{profileSwitcherOpen ? '▾' : '▸'}</span>
                    </button>
                    {profileSwitcherOpen && (
                      <div className="profile-switcher-menu">
                        {profiles.map(p => (
                          <div key={p.id} className={`profile-switcher-item${profileId === p.id ? ' active' : ''}`}
                            onClick={() => { setProfileId(p.id); setProfileSwitcherOpen(false); }}>
                            <div className="profile-avatar" style={{ width: 28, height: 28, fontSize: 12, borderRadius: 7 }}>{p.name.charAt(0).toUpperCase()}</div>
                            <div>
                              <div className="profile-switcher-item-name">{p.name}{p.isDefault && <span className="badge badge-violet" style={{ marginLeft: 6 }}>Default</span>}</div>
                              <div className="profile-switcher-item-meta">{p.experience?.length || 0} experience entries · {p.skills?.length || 0} skills</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Target domain</h2></div>
                {domains.length === 0 ? (
                  <div className="empty">No published domains yet — ask your admin to add one.</div>
                ) : (
                  <div className="profile-switcher" style={{ position: 'relative' }}>
                    <button className="profile-switcher-btn" onClick={() => setDomainSwitcherOpen(v => !v)}>
                      <div className="domain-card-icon" style={{ width: 38, height: 38, borderRadius: 10, fontSize: 15 }}>◆</div>
                      <div style={{ textAlign: 'left' }}>
                        <div className="profile-switcher-name">{domains.find(d => d.id === selectedDomainId)?.name || '— Choose a domain —'}</div>
                        {domains.find(d => d.id === selectedDomainId)?.summary && (
                          <div className="profile-switcher-meta">{domains.find(d => d.id === selectedDomainId).summary}</div>
                        )}
                      </div>
                      <span className="profile-switcher-chevron">{domainSwitcherOpen ? '▾' : '▸'}</span>
                    </button>
                    {domainSwitcherOpen && (
                      <div className="profile-switcher-menu">
                        {domains.map(d => (
                          <div key={d.id} className={`profile-switcher-item${selectedDomainId === d.id ? ' active' : ''}`}
                            onClick={() => { setSelectedDomainId(d.id); setDomainSwitcherOpen(false); }}>
                            <div className="domain-card-icon" style={{ width: 28, height: 28, fontSize: 12, borderRadius: 7 }}>◆</div>
                            <div>
                              <div className="profile-switcher-item-name">{d.name}</div>
                              {d.summary && <div className="profile-switcher-item-meta">{d.summary}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <JdInput jdText={jdText} setJdText={setJdText} jdMode={jdMode} setJdMode={setJdMode} imgStatus={imgStatus} setImgStatus={setImgStatus} />

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Custom instructions <span className="count">(optional)</span></h2></div>
                <textarea rows={2} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="e.g. Emphasize leadership, keep it to one page, lead with the Microsoft role…" />
              </div>

              <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || !canAdvance} onClick={runScratchPipeline}>
                {loading ? 'Building…' : 'Build Resume →'}
              </button>
            </>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Base resume</h2></div>
                {resumes.length > 0 ? (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <select value={baseResumeId} onChange={e => setBaseResumeId(e.target.value)}>
                      <option value="">— Choose a resume —</option>
                      {resumes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                    {baseResume && <div className="field-hint">{(baseResume.text?.length || 0).toLocaleString()} chars{baseResume.fileName ? ` · ${baseResume.fileName}` : ''}</div>}
                  </div>
                ) : (
                  <div className="empty">No resumes in your library yet — add one from the Resumes page first.</div>
                )}
              </div>

              <JdInput jdText={jdText} setJdText={setJdText} jdMode={jdMode} setJdMode={setJdMode} imgStatus={imgStatus} setImgStatus={setImgStatus} />

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Tailoring level</h2></div>
                <div className="seg-ctrl">
                  {LEVELS.map(l => <button key={l} className={tailoringLevel === l ? 'active' : ''} onClick={() => setTailoringLevel(l)}>{l}</button>)}
                </div>
                <div className="field-hint">
                  {tailoringLevel === 'Conservative' && 'Light touch — only changes phrasing where it clearly helps.'}
                  {tailoringLevel === 'Balanced' && 'Moderate rewrite — reworks phrasing where it clearly helps. Recommended.'}
                  {tailoringLevel === 'Aggressive' && 'Maximum rewrite — restructures freely to match the JD.'}
                </div>
              </div>

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head"><h2>Custom instructions <span className="count">(optional)</span></h2></div>
                <textarea rows={2} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="e.g. Emphasize leadership, keep it to one page, work in the word 'distributed systems'…" />
              </div>

              <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || !canAdvance} onClick={runTailorPipeline}>
                {loading ? 'Tailoring…' : 'Analyze & Tailor →'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ========== STEP 2: BUILD ========== */}
      {step === 'build' && (
        <div>
          <div className="build-loader">
            <div className="build-loader-top">
              <div className="build-loader-spinner" />
              <div style={{ flex: 1 }}>
                <div className="build-loader-title">{buildDone ? 'Done!' : (stages[Math.min(buildStageIdx, stages.length - 1)] || 'Working…')}</div>
                <div className="build-loader-sub">{buildDone ? 'Your resume is ready to review.' : 'This usually takes 20–30 seconds — feel free to wait here.'}</div>
              </div>
              {buildDone && <span className="badge badge-green">✓ Complete</span>}
            </div>
            <div className="progress-bar" style={{ marginTop: 12 }}><div className={`progress-fill${buildDone ? ' green' : ''}`} style={{ width: `${progressPct}%`, transition: 'width .5s' }} /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 18, alignItems: 'start', marginTop: 16 }}>
            <div className="panel">
              <div className="panel-head"><h2>Live Activity</h2></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {buildLog.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.6, color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--success)', flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 10.5 }}>{item.time}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
              {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
            </div>

            <div>
              {mode === 'scratch' ? (
                <>
                  <div className="panel">
                    <div className="panel-head"><h2>Agent Findings</h2></div>
                    {findings ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 650, marginBottom: 14 }}>
                          Role Match
                          <span className={`badge badge-${findings.roleMatch === 'Strong' ? 'green' : findings.roleMatch === 'Good' ? 'violet' : 'amber'}`}>{findings.roleMatch}</span>
                        </div>
                        {findings.strongestEvidence?.length > 0 && (
                          <>
                            <div className="field-label" style={{ marginBottom: 6 }}>Strongest evidence</div>
                            <div className="chips" style={{ marginBottom: 4 }}>{findings.strongestEvidence.map(e => <div key={e} className="chip match">{e}</div>)}</div>
                          </>
                        )}
                      </>
                    ) : <div className="loading"><span className="spinner" /> Analyzing…</div>}
                  </div>
                  {strategy && buildDone && (
                    <div className="strategy-mini">
                      <div className="k">Positioning</div>
                      <div className="v">{strategy.positioning}</div>
                      <div className="k">Skill Priority</div>
                      <div className="v">{(strategy.skillPriority || []).slice(0, 8).join(', ') || '—'}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="panel">
                  <div className="panel-head"><h2>JD Match</h2></div>
                  {jdIntel?.matchMatrix?.length > 0 ? (
                    jdIntel.matchMatrix.slice(0, 8).map(m => {
                      const strength = m.status === 'strong' ? 'STRONG' : m.status === 'partial' ? 'WEAK' : 'MISSING';
                      return <div key={m.term} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.6, marginBottom: 6 }}>{m.term}<span className={`req-strength ${strength}`}>{strength}</span></div>;
                    })
                  ) : buildDone ? <div className="empty">No requirement data available.</div> : <div className="loading"><span className="spinner" /> Analyzing…</div>}
                </div>
              )}

              {buildDone && (
                <div className="panel">
                  <div className="panel-head"><h2>Not quite right?</h2></div>
                  <p className="field-hint" style={{ marginBottom: 10 }}>Add or edit instructions, then regenerate.</p>
                  <textarea rows={2} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="e.g. Emphasize leadership more…" style={{ marginBottom: 10 }} />
                  <button className="btn btn-sm btn-primary btn-full" disabled={regenerating} onClick={mode === 'scratch' ? handleRegenerateScratch : handleRetailor}>
                    {regenerating ? 'Regenerating…' : '↻ Apply & Regenerate'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {buildDone && (
            <div className="toolbar" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setStep('review')}>Continue to Review →</button>
            </div>
          )}
        </div>
      )}

      {/* ========== STEP 3: REVIEW & EXPORT ========== */}
      {step === 'review' && version && (
        <div>
          {score != null && (
            <div className="ats-scorecard" style={{ marginBottom: 18 }}>
              <div className={`ats-scorecard-num ats-tier-${scoreTier}`}>{score}</div>
              <div className="ats-scorecard-body">
                <div className="ats-scorecard-label">ATS Match Score</div>
                <div className={`ats-scorecard-tier ats-tier-${scoreTier}`}>{scoreTierLabel}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setStep('build')}>← Back to Build</button>
              </div>
            </div>
          )}

          <div className="review-export-grid">
            <div>
              <div className="tabs">
                {[['resume', 'Preview'], ['changes', 'Changes'], ['matches', 'JD Match'], ['flags', 'Quality Check']].map(([t, label]) => {
                  const badge = mode === 'scratch'
                    ? (t === 'flags' ? (version.flags || []).filter(f => f.status === 'needs_review').length : t === 'changes' ? (version.changes || []).filter(c => c.status === 'pending').length : 0)
                    : (t === 'changes' ? diffOps.length : 0);
                  return (
                    <button key={t} className={`tab${reviewTab === t ? ' active' : ''}`} onClick={() => setReviewTab(t)}>
                      {label}{badge > 0 && <span className="nav-badge" style={{ marginLeft: 5 }}>{badge}</span>}
                    </button>
                  );
                })}
              </div>

              {reviewTab === 'resume' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={showHighlights} onChange={e => setShowHighlights(e.target.checked)} style={{ width: 'auto' }} />
                      Highlight JD-matched keywords
                    </label>
                  </div>
                  <div className="doc"><ResumePreview resume={{ ...version.content, highlights: highlightTerms }} showHighlights={showHighlights} /></div>
                </>
              )}

              {reviewTab === 'changes' && mode === 'scratch' && (
                <div className="panel">
                  <div className="panel-head"><h2>Changes ({(version.changes || []).length})</h2><button className="btn btn-sm btn-ghost" onClick={handleAcceptAll}>Accept all</button></div>
                  {(version.changes || []).map(c => (
                    <div key={c.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{c.section}</div>
                      <div className="diff-grid">
                        <div className="diff-col-head">Before</div><div className="diff-col-head">After</div>
                        <div className="diff-cell diff-removed">{c.beforeText}</div><div className="diff-cell diff-added">{c.afterText}</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 8px', fontStyle: 'italic' }}>{c.rationale}</div>
                      {c.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-sm btn-primary" onClick={() => handleChangeStatus(c.id, 'accepted')}>Accept</button><button className="btn btn-sm btn-ghost" onClick={() => handleChangeStatus(c.id, 'reverted')}>Revert</button></div>}
                      {c.status !== 'pending' && <span style={{ fontSize: 11, fontWeight: 600, color: c.status === 'accepted' ? 'var(--success)' : 'var(--text-muted)' }}>{c.status}</span>}
                    </div>
                  ))}
                  {!(version.changes?.length) && <div className="empty">No changes to review</div>}
                </div>
              )}

              {reviewTab === 'changes' && mode === 'existing' && (
                <div className="panel">
                  <div className="panel-head"><h2>Line-by-line diff</h2></div>
                  <p className="field-hint" style={{ marginBottom: 12 }}>Comparing your base resume against the tailored version.</p>
                  <div className="diff-grid">
                    <div className="diff-col-head">Before</div><div className="diff-col-head">After</div>
                    {diffOps.map((op, i) => (
                      <React.Fragment key={i}>
                        <div className={`diff-cell ${op.type === 'removed' ? 'diff-removed' : 'diff-blank'}`}>{op.left && (op.left.startsWith('## ') ? <strong>{op.left.slice(3)}</strong> : op.left)}</div>
                        <div className={`diff-cell ${op.type === 'added' ? 'diff-added' : 'diff-blank'}`}>{op.right && (op.right.startsWith('## ') ? <strong>{op.right.slice(3)}</strong> : op.right)}</div>
                      </React.Fragment>
                    ))}
                  </div>
                  {!diffOps.length && <div className="empty">No differences detected.</div>}
                </div>
              )}

              {reviewTab === 'matches' && (
                <div className="panel">
                  <div className="panel-head"><h2>JD Match</h2></div>
                  {mode === 'scratch' ? (
                    <>
                      {(version.requirementMatches || []).map(m => (
                        <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                          <div><div style={{ fontWeight: 500 }}>{m.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.importance} · {m.mentionCount}× in JD</div></div>
                          <span className={`req-strength ${m.evidenceStrength}`}>{m.evidenceStrength}</span>
                        </div>
                      ))}
                      {!(version.requirementMatches?.length) && <div className="empty">No requirement data available</div>}
                    </>
                  ) : (
                    <>
                      {(jdIntel?.matchMatrix || []).map(m => {
                        const strength = m.status === 'strong' ? 'STRONG' : m.status === 'partial' ? 'WEAK' : 'MISSING';
                        return <div key={m.term} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}><div style={{ fontWeight: 500 }}>{m.term}</div><span className={`req-strength ${strength}`}>{strength}</span></div>;
                      })}
                      {!(jdIntel?.matchMatrix?.length) && <div className="empty">No requirement data available for this JD.</div>}
                    </>
                  )}
                </div>
              )}

              {reviewTab === 'flags' && (
                <div className="panel">
                  <div className="panel-head"><h2>Resume Quality Check</h2></div>
                  {mode === 'scratch' ? (
                    <>
                      {(version.flags || []).map(f => (
                        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                          <div><div style={{ fontWeight: 500 }}>{f.claimText}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.sourceRef || 'No source reference'}</div></div>
                          {f.status === 'needs_review' ? <button className="btn btn-sm btn-primary" onClick={() => handleVerifyFlag(f.id)}>Verify ✓</button> : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)' }}>Verified</span>}
                        </div>
                      ))}
                      {!(version.flags?.length) && <div className="empty" style={{ color: 'var(--success)', fontWeight: 500 }}>✓ No flags — all claims trace to your profile</div>}
                    </>
                  ) : <div className="empty">Truthfulness verification runs on Agent-built resumes (Build from scratch). Tailored resumes rewrite your existing text directly.</div>}
                </div>
              )}
            </div>

            {/* Export sidebar — always visible alongside Review, no separate step */}
            <div>
              <div className="panel">
                <div className="panel-head"><h2>Refine & Rebuild</h2></div>
                <p className="field-hint" style={{ marginBottom: 10 }}>Aggressively regenerate sections and pull in keywords the resume is missing.</p>

                <div className="field-label" style={{ marginBottom: 6 }}>Rebuild sections</div>
                <label className="field-check" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={rebuildSections.summary} onChange={e => setRebuildSections(s => ({ ...s, summary: e.target.checked }))} style={{ width: 'auto', accentColor: 'var(--primary)' }} />
                  Summary
                </label>
                <label className="field-check" style={{ marginBottom: 12 }}>
                  <input type="checkbox" checked={rebuildSections.experience} onChange={e => setRebuildSections(s => ({ ...s, experience: e.target.checked }))} style={{ width: 'auto', accentColor: 'var(--primary)' }} />
                  Experience
                </label>

                <div className="field-label" style={{ marginBottom: 6 }}>
                  Missing keywords {missingKeywords.length > 0 && <span className="count">({selectedKeywords.length}/{missingKeywords.length} selected)</span>}
                </div>
                {missingKeywords.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--success)', fontWeight: 500, marginBottom: 12 }}>✓ Every tracked keyword already appears in the resume</div>
                ) : (
                  <>
                    <div className="chip-row" style={{ marginBottom: 8 }}>
                      {missingKeywords.map(k => {
                        const on = selectedKeywords.includes(k);
                        return (
                          <div key={k} className="chip" style={{ cursor: 'pointer', background: on ? 'var(--primary-subtle)' : 'var(--bg)', color: on ? 'var(--primary)' : 'var(--text-secondary)', border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}` }}
                            onClick={() => setSelectedKeywords(list => on ? list.filter(x => x !== k) : [...list, k])}>
                            {on ? '✓ ' : '+ '}{k}
                          </div>
                        );
                      })}
                    </div>
                    <button className="btn btn-xs btn-ghost" style={{ marginBottom: 12 }}
                      onClick={() => setSelectedKeywords(selectedKeywords.length === missingKeywords.length ? [] : [...missingKeywords])}>
                      {selectedKeywords.length === missingKeywords.length ? 'Clear all' : 'Select all'}
                    </button>
                  </>
                )}

                <div className="field">
                  <label className="field-label">Extra instructions</label>
                  <textarea rows={2} value={rebuildNotes} onChange={e => setRebuildNotes(e.target.value)} placeholder="e.g. Lead with the Microsoft role, cut it to one page…" />
                </div>

                {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}
                <button className="btn btn-primary btn-full" disabled={regenerating} onClick={handleAggressiveRebuild}>
                  {regenerating ? 'Rebuilding…' : '↻ Rebuild Resume'}
                </button>
              </div>

              <div className="panel">
                <div className="panel-head"><h2>Export</h2></div>
                <div className="field">
                  <label className="field-label">Format</label>
                  <div className="seg-ctrl" style={{ width: '100%' }}>
                    {['pdf', 'docx'].map(f => <button key={f} className={exportFormat === f ? 'active' : ''} onClick={() => setExportFormat(f)}>{f.toUpperCase()}</button>)}
                  </div>
                </div>
                <button className="btn btn-primary btn-full" style={{ marginBottom: 8 }} onClick={() => handleDownload(exportFormat)}>⇩ Download {exportFormat.toUpperCase()}</button>
                <button className="btn btn-ghost btn-full" style={{ marginBottom: 8 }} onClick={handleGenerateCoverLetter}>✎ Generate Cover Letter</button>
                <button className="btn btn-ghost btn-full" onClick={openEmailDraft}>✉ Draft Email (Gmail)</button>
              </div>

              {coverLetterOpen && (
                <div className="panel">
                  <div className="panel-head"><h2>Cover Letter</h2><button className="btn btn-xs btn-ghost" onClick={() => setCoverLetterOpen(false)}>✕</button></div>
                  {coverLetterLoading ? <div className="loading"><span className="spinner" /> Writing…</div> :
                   coverLetterError ? <div className="error-box">{coverLetterError}</div> : (
                    <>
                      <textarea rows={12} value={coverLetterText} onChange={e => setCoverLetterText(e.target.value)} style={{ fontSize: 12.4, marginBottom: 10 }} />
                      <button className="btn btn-sm btn-primary btn-full" onClick={() => { navigator.clipboard.writeText(coverLetterText); notify?.({ kind: 'good', title: 'Copied', detail: 'Cover letter copied to clipboard' }); }}>Copy to clipboard</button>
                    </>
                  )}
                </div>
              )}

              {emailOpen && (
                <div className="panel">
                  <div className="panel-head"><h2>Draft Email</h2><button className="btn btn-xs btn-ghost" onClick={() => setEmailOpen(false)}>✕</button></div>
                  <div className="mail-shell">
                    <div className="mail-field"><span className="k">To</span><input type="text" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="recruiter@company.com" /></div>
                    <div className="mail-field"><span className="k">Subject</span><input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} /></div>
                  </div>
                  <div className="mail-body-wrap"><textarea rows={8} value={emailBody} onChange={e => setEmailBody(e.target.value)} /></div>
                  <div className="attach-chip">📎 {exportTitle()}.pdf will be attached</div>
                  {sendError && <div className="error-box" style={{ marginTop: 10 }}>{sendError}</div>}
                  {sendSuccess && <div className="success-box" style={{ marginTop: 10 }}>Draft created in your Gmail account — check your Drafts folder to review and hit send.</div>}
                  <button className="btn btn-sm btn-primary btn-full" style={{ marginTop: 10 }} disabled={sending} onClick={handleSendDraft}>
                    {sending ? 'Creating draft…' : 'Create Gmail Draft'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
