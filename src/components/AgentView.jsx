import React, { useState, useEffect, useRef } from 'react';
import {
  listCareerProfiles, listDomainsPublic, createJobDescription, createAgentRun,
  updateAgentRun, getResumeVersion, updateResumeVersionChanges, updateQualityFlag,
  listCustomDomains, createCustomDomain
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

// Collapsible block in the Select column. Kept uncontrolled-by-default so a
// user's expand state survives regeneration without extra plumbing.
function OptBlock({ title, summary, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="opt-block">
      <div className="opt-block-head" onClick={() => setOpen(o => !o)}>
        <span className="opt-block-chev">{open ? '▾' : '▸'}</span>
        <span className="opt-block-title">{title}</span>
        {!open && summary && <span className="opt-block-sub">{summary}</span>}
      </div>
      {open && <div className="opt-block-body">{children}</div>}
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
    <>
      <div className="mode-toggle">
        <button className={`mode-btn ${jdMode === 'text' ? 'active' : ''}`} onClick={() => setJdMode('text')}>✎ Paste text</button>
        <button className={`mode-btn ${jdMode === 'image' ? 'active' : ''}`} onClick={() => setJdMode('image')}>⇪ Upload image</button>
      </div>
      {jdMode === 'text' ? (
        <textarea rows={8} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the complete job description here…" />
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
    </>
  );
}

const LEVELS = ['Conservative', 'Balanced', 'Aggressive'];

const BUILD_STAGES = {
  scratch: ['Reading your career profile…', 'Analyzing the job description…', 'Mapping evidence against domain intelligence…', 'Writing your resume…', 'Optimizing for ATS…'],
  existing: ['Reading your base resume…', 'Analyzing the job description…', 'Rewriting against the JD…', 'Optimizing for ATS…'],
};

// Cute progress mascot — a cat typing away while the resume builds. Purely
// decorative, so it carries aria-hidden and the real status stays in the log.
function BuildCat({ done = false }) {
  return (
    <svg className={`build-cat${done ? ' done' : ''}`} viewBox="0 0 120 100" width="150" height="125" aria-hidden="true">
      <ellipse className="cat-shadow" cx="60" cy="90" rx="30" ry="4.5" />
      {/* desk */}
      <rect x="18" y="74" width="84" height="6" rx="3" fill="var(--border-strong)" />
      {/* tail */}
      <path className="cat-tail" d="M82 70 q16 2 14 -12" stroke="var(--brand)" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* body */}
      <path className="cat-body" d="M34 74 q0 -22 26 -22 q26 0 26 22 z" fill="var(--brand)" />
      {/* head */}
      <g className="cat-head">
        <path d="M40 40 l2 -13 l11 7 z" fill="var(--brand)" />
        <path d="M80 40 l-2 -13 l-11 7 z" fill="var(--brand)" />
        <ellipse cx="60" cy="44" rx="22" ry="18" fill="var(--brand)" />
        <ellipse cx="60" cy="50" rx="10" ry="7" fill="var(--brand-soft)" />
        {/* eyes */}
        <g className="cat-eyes">
          <ellipse cx="52" cy="42" rx="2.6" ry="3.2" fill="#fff" />
          <ellipse cx="68" cy="42" rx="2.6" ry="3.2" fill="#fff" />
        </g>
        {/* nose + smile */}
        <path d="M60 47 l-2.5 2 h5 z" fill="#fff" />
        <path d="M56 52 q4 3 8 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {/* whiskers */}
        <path d="M38 46 h9 M38 51 h9 M82 46 h-9 M82 51 h-9" stroke="var(--brand-soft)" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      {/* paws tapping the desk */}
      <ellipse className="cat-paw left" cx="46" cy="72" rx="6" ry="4.5" fill="var(--brand-soft)" />
      <ellipse className="cat-paw right" cx="74" cy="72" rx="6" ry="4.5" fill="var(--brand-soft)" />
      {/* little sparks of progress */}
      <g className="cat-sparks">
        <circle cx="96" cy="30" r="2.5" fill="var(--brand)" />
        <circle cx="104" cy="20" r="1.8" fill="var(--brand)" />
        <circle cx="92" cy="16" r="1.4" fill="var(--brand)" />
      </g>
    </svg>
  );
}

export default function AgentView({ uid, state, setView, notify, credits, onCreditsChange }) {
  const { resumes, profileInfo, activeResumeId } = state;
  const { ensureGmailToken } = useAuth();
  const [mode, setMode] = useState('scratch');
  const [runId, setRunId] = useState(null);

  // Setup state — scratch mode
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [domains, setDomains] = useState([]);
  const [customDomains, setCustomDomains] = useState([]);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [domainQuery, setDomainQuery] = useState('');
  const [createDomainOpen, setCreateDomainOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainParent, setNewDomainParent] = useState('');
  const [newDomainKwRaw, setNewDomainKwRaw] = useState('');
  const [newDomainKws, setNewDomainKws] = useState([]);
  const [creatingDomain, setCreatingDomain] = useState(false);

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

  // Review state — every generate appends to history so earlier drafts stay
  // reachable instead of being overwritten.
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const version = history[historyIdx]?.version || null;
  const [reviewTab, setReviewTab] = useState('resume');
  const [showHighlights, setShowHighlights] = useState(true);
  const [rebuildSections, setRebuildSections] = useState({ summary: true, experience: true });
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [iterateOnDraft, setIterateOnDraft] = useState(true);

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
    listCustomDomains(uid).then(setCustomDomains).catch(() => {});
    listCareerProfiles(uid).then(list => {
      setProfiles(list);
      setProfileId(list.find(p => p.isDefault)?.id || list[0]?.id || '');
    });
  }, [uid]);

  // Library's "Tailor this" sets the default resume then routes here, so the
  // default is what the workspace pre-selects as the base resume.
  useEffect(() => {
    if (activeResumeId) { setBaseResumeId(activeResumeId); setMode('existing'); }
  }, [activeResumeId]);

  const profile = profiles.find(p => p.id === profileId) || null;
  const baseResume = resumes.find(r => r.id === baseResumeId);

  const allDomains = [...domains, ...customDomains];
  const selectedDomain = allDomains.find(d => d.id === selectedDomainId) || null;
  const filteredDomains = domainQuery.trim()
    ? allDomains.filter(d => `${d.name} ${d.summary || ''}`.toLowerCase().includes(domainQuery.trim().toLowerCase()))
    : allDomains;

  // Custom domains live under the user, not in the global `domains` collection,
  // so the server-side lookup must be skipped and their keywords passed inline.
  const isCustomDomain = Boolean(selectedDomain?.isCustom);
  const effectiveDomainId = isCustomDomain ? null : selectedDomainId;
  const domainDirective = isCustomDomain && selectedDomain.keywords?.length
    ? `Target specialization "${selectedDomain.name}". Prioritize this domain's vocabulary throughout: ${selectedDomain.keywords.join(', ')}.`
    : '';

  function addLog(text) {
    setBuildLog(prev => [...prev, { time: new Date().toLocaleTimeString(), text }]);
  }
  function advanceStage() {
    setBuildStageIdx(i => i + 1);
  }

  // Each generate is a fresh build from source, so drafts are appended rather
  // than replaced — the user can page back to any earlier one.
  function pushVersion(v, label) {
    setHistory(prev => {
      const next = [...prev, { version: v, label, at: new Date() }];
      setHistoryIdx(next.length - 1);
      return next;
    });
  }
  function patchCurrentVersion(patch) {
    setHistory(prev => prev.map((h, i) => i === historyIdx ? { ...h, version: { ...h.version, ...patch(h.version) } } : h));
  }

  function resetBuildState() {
    setBuildLog([]); setBuildDone(false); setHistory([]); setHistoryIdx(0); setBuildStageIdx(0);
    setJobDescription(null); setFindings(null); setStrategy(null);
    setJdIntel(null); setDiffOps([]);
    setCoverLetterOpen(false); setCoverLetterText(''); setEmailOpen(false); setSendSuccess(false);
  }

  /* ============================= SCRATCH MODE PIPELINE ============================= */
  async function runScratchPipeline() {
    if (!jdText.trim() || !selectedDomainId || !profile) return;
    if (!profile.experience?.length) { setError('Add at least one experience entry to this Career Profile first.'); return; }
    setError(''); setLoading(true); resetBuildState();

    try {
      addLog(BUILD_STAGES.scratch[0]); advanceStage();
      const jdDoc = await createJobDescription(uid, jdText.trim());
      const runDoc = await createAgentRun(uid, { careerProfileSnapshot: profile, domainId: effectiveDomainId, jobDescriptionId: jdDoc.id });
      setRunId(runDoc.id);

      addLog(BUILD_STAGES.scratch[1]); advanceStage();
      const parsed = await parseJobDescription(jdDoc.id, jdText.trim());
      const fullJd = { ...jdDoc, ...parsed };
      setJobDescription(fullJd);

      addLog(BUILD_STAGES.scratch[2]); advanceStage();
      const strat = await analyzeAgentRun({ agentRunId: runDoc.id, careerProfile: profile, jobDescription: fullJd, domainId: effectiveDomainId });
      setFindings({ roleMatch: strat.roleMatch, strongestEvidence: strat.strongestEvidence || [], gaps: [] });
      setStrategy(strat);
      await updateAgentRun(uid, runDoc.id, { currentStep: 'strategy', strategySnapshot: strat, jobDescriptionParsed: fullJd });

      addLog(BUILD_STAGES.scratch[3]); advanceStage();
      const withInstructions = { ...strat, positioning: appendCustom(strat.positioning, [domainDirective, customInstructions].filter(Boolean).join(' ')) };
      const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
        agentRunId: runDoc.id, careerProfile: profile, jobDescription: fullJd, strategy: withInstructions, domainId: effectiveDomainId,
      });
      addLog(BUILD_STAGES.scratch[4]); advanceStage();
      addLog(`Build complete — match score ${matchScore}%`);
      setBuildDone(true);
      const v = await getResumeVersion(uid, versionId);
      pushVersion(v, 'Initial build');
      if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
      notify?.({ kind: 'good', title: 'Resume built', detail: `ATS match score: ${matchScore}%` });
      setReviewTab('resume');
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
    const updatedStrategy = { ...strategy, positioning: appendCustom(strategy.positioning, [domainDirective, customInstructions].filter(Boolean).join(' ')) };
    addLog('Rebuilding with your instructions…');
    try {
      const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
        agentRunId: runId, careerProfile: profile, jobDescription, strategy: updatedStrategy, domainId: effectiveDomainId,
      });
      addLog(`Build complete — match score ${matchScore}%`);
      const v = await getResumeVersion(uid, versionId);
      pushVersion(v, 'Rebuild');
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
    setError(''); setLoading(true); resetBuildState();

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
      await generateTailoredVersion(baseResume, customInstructions.trim() ? [customInstructions.trim()] : [], undefined, 'Initial tailor');
      advanceStage();
      setReviewTab('resume');
    } catch (err) {
      console.error(err);
      addLog(`Failed: ${err.message}`);
      setError(err.message || 'Something went wrong. Please try again.');
      if (err.code === 'OUT_OF_CREDITS') notify?.({ kind: 'warn', title: "You're out of credits", detail: 'Add more to keep building' });
    }
    setLoading(false);
  }

  async function generateTailoredVersion(baseR, extraPrompts = [], intensityOverride, label = 'Tailored') {
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

    pushVersion({ id: `tailor_${Date.now()}`, content: resume, matchScore: atsScore, changes: null, requirementMatches: null, flags: null }, label);
    if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
    notify?.({ kind: 'good', title: 'Resume tailored', detail: `ATS match score: ${atsScore}%` });
    return resume;
  }

  async function handleRetailor() {
    if (!baseResume) return;
    setRegenerating(true); setError('');
    addLog('Re-tailoring with your instructions…');
    try {
      await generateTailoredVersion(baseResume, customInstructions.trim() ? [customInstructions.trim()] : [], undefined, 'Re-tailored');
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
    if (customInstructions.trim()) parts.push(customInstructions.trim());
    return parts.join(' ');
  }

  async function handleAggressiveRebuild() {
    const directive = buildRebuildDirective();
    const basedOnDraft = iterateOnDraft && Boolean(version);
    setRegenerating(true); setError(''); setBuildLog([]);
    addLog(basedOnDraft ? `Editing v${historyIdx + 1}…` : 'Reading your selections…');
    try {
      if (mode === 'scratch') {
        if (!strategy || !jobDescription || !runId || !profile) throw new Error('Missing run context — start a new run.');
        addLog(basedOnDraft ? 'Applying your instructions to the draft…' : 'Rewriting bullets against the JD…');
        const updatedStrategy = { ...strategy, positioning: appendCustom(strategy.positioning, [domainDirective, directive].filter(Boolean).join(' ')) };
        const { versionId, matchScore, creditsRemaining } = await buildAgentResume({
          agentRunId: runId, careerProfile: profile, jobDescription, strategy: updatedStrategy, domainId: effectiveDomainId,
          previousResume: basedOnDraft ? version.content : undefined,
        });
        addLog('Scoring match…');
        const v = await getResumeVersion(uid, versionId);
        pushVersion(v, basedOnDraft ? `Edit of v${historyIdx + 1}` : 'Rebuild');
        if (creditsRemaining !== undefined) onCreditsChange?.(creditsRemaining);
        notify?.({ kind: 'good', title: 'Resume rebuilt', detail: `ATS match score: ${matchScore}%` });
      } else {
        if (!baseResume) throw new Error('Base resume missing — start a new run.');
        addLog(basedOnDraft ? 'Applying your instructions to the draft…' : 'Rewriting bullets against the JD…');
        // Feeding the current draft back in as the source is what makes this an
        // edit of v-n rather than a fresh tailor of the original resume.
        const source = basedOnDraft
          ? { ...baseResume, text: flattenResume(version.content) }
          : baseResume;
        await generateTailoredVersion(source, directive ? [directive] : [], 'aggressive', basedOnDraft ? `Edit of v${historyIdx + 1}` : 'Refined');
      }
      setSelectedKeywords([]);
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
    patchCurrentVersion(() => ({ changes }));
  }
  async function handleAcceptAll() {
    if (!version || mode !== 'scratch') return;
    const changes = (version.changes || []).map(c => ({ ...c, status: 'accepted' }));
    await updateResumeVersionChanges(uid, version.id, changes);
    patchCurrentVersion(() => ({ changes }));
    notify?.({ kind: 'good', title: 'All changes accepted', detail: '' });
  }
  async function handleVerifyFlag(flagId) {
    if (!version || mode !== 'scratch') return;
    await updateQualityFlag(uid, version.id, flagId, { status: 'verified' });
    patchCurrentVersion(v => ({ flags: (v.flags || []).map(f => f.id === flagId ? { ...f, status: 'verified' } : f) }));
  }

  function handleReset() {
    setRunId(null); resetBuildState();
    setJdText(''); setJdMode('text'); setImgStatus(null); setCustomInstructions('');
    setBaseResumeId(''); setTailoringLevel('Balanced');
    setSelectedKeywords([]);
  }

  /* ============================= CUSTOM DOMAINS ============================= */
  // Accepts a comma/newline separated paste and folds it into de-duped chips.
  function absorbKeywordPaste() {
    const parsed = newDomainKwRaw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!parsed.length) return;
    setNewDomainKws(list => [...new Set([...list, ...parsed])]);
    setNewDomainKwRaw('');
  }

  async function handleCreateCustomDomain() {
    const merged = [...new Set([...newDomainKws, ...newDomainKwRaw.split(/[,\n]/).map(s => s.trim()).filter(Boolean)])];
    if (!newDomainName.trim()) { setError('Give the custom domain a name.'); return; }
    if (!merged.length) { setError('Add at least one keyword so the Agent knows what this domain means.'); return; }
    setError(''); setCreatingDomain(true);
    try {
      const parent = domains.find(d => d.id === newDomainParent);
      const created = await createCustomDomain(uid, {
        name: newDomainName.trim(),
        parentDomainId: parent?.id || null,
        parentDomainName: parent?.name || '',
        keywords: merged,
      });
      setCustomDomains(list => [...list, created]);
      setSelectedDomainId(created.id);
      setNewDomainName(''); setNewDomainParent(''); setNewDomainKws([]); setNewDomainKwRaw('');
      setCreateDomainOpen(false);
      notify?.({ kind: 'good', title: 'Custom domain created', detail: created.name });
    } catch (err) {
      console.error(err);
      setError('Could not create the domain. Please try again.');
    }
    setCreatingDomain(false);
  }

  const score = version?.matchScore;
  const scoreTier = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'fair' : 'weak';
  const scoreTierLabel = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs work';
  const profileIncomplete = mode === 'scratch' && profile && !(profile.experience?.length);
  const canAdvance = mode === 'scratch'
    ? Boolean(jdText.trim() && selectedDomainId && profileId && !profileIncomplete)
    : Boolean(jdText.trim() && baseResumeId);
  const highlightTerms = version?.content?.highlights?.length ? version.content.highlights : (mode === 'scratch' ? (strategy?.skillPriority || []) : []);

  // Skill keywords the JD asks for that don't yet appear anywhere in the generated resume.
  const missingKeywords = React.useMemo(() => {
    if (!version?.content) return [];
    const text = flattenResume(version.content).toLowerCase();
    const pool = mode === 'scratch'
      ? [...(version.requirementMatches || []).map(m => ({ term: m.name, important: ['Critical', 'High'].includes(m.importance) })),
         ...(strategy?.skillPriority || []).map(s => ({ term: s, important: true }))]
      : (jdIntel?.matchMatrix || []).map(m => ({ term: m.term, important: m.status === 'missing' }));
    const seen = new Set();
    return pool
      .filter(k => k.term && typeof k.term === 'string')
      .filter(k => { const key = k.term.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
      .filter(k => !text.includes(k.term.toLowerCase()))
      .slice(0, 24);
  }, [version, strategy, jdIntel, mode]);

  const strongMissing = missingKeywords.filter(k => k.important);
  const niceMissing = missingKeywords.filter(k => !k.important);

  // JD Match rows, normalised across both pipelines
  const jdMatchRows = mode === 'scratch'
    ? (version?.requirementMatches || []).map(m => ({ term: m.name, level: m.evidenceStrength, meta: `${m.importance} · ${m.mentionCount}× in JD` }))
    : (jdIntel?.matchMatrix || []).map(m => ({ term: m.term, level: m.status === 'strong' ? 'STRONG' : m.status === 'partial' ? 'WEAK' : 'MISSING', meta: '' }));

  const selectStatus = mode === 'scratch' ? 'From scratch' : 'Tailoring';

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <h1 className="page-title">✦ Build / Tailor Resume</h1>
        {version && <button className="btn btn-ghost btn-sm" onClick={handleReset}>← New run</button>}
      </div>
      <p className="page-sub">Configure on the left, see the result on the right. Nothing navigates away.</p>

      <div className="ws-split">
        {/* ============ LEFT: SELECT ============ */}
        <div className="ws-select">
          <div className="ws-col-head">
            <span className="ws-col-num">01 · select</span>
            <span className="ws-col-status">{selectStatus}</span>
          </div>

          <div className="opt-scroll">
            {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}

            {/* ---- Starting point ---- */}
            <OptBlock title="Starting point" summary={selectStatus}>
              <div className="start-tiles">
                <button className={`start-tile${mode === 'existing' ? ' selected' : ''}`} onClick={() => setMode('existing')}>
                  <div className="start-tile-title">Tailor existing</div>
                  <div className="start-tile-desc">From a resume you have</div>
                </button>
                <button className={`start-tile${mode === 'scratch' ? ' selected' : ''}`} onClick={() => setMode('scratch')}>
                  <div className="start-tile-title">Build from scratch</div>
                  <div className="start-tile-desc">From your Career Profile</div>
                </button>
              </div>

              {mode === 'existing' ? (
                <div style={{ marginTop: 12 }}>
                  <label className="field-label">Base resume</label>
                  {resumes.length > 0 ? (
                    <>
                      <select value={baseResumeId} onChange={e => setBaseResumeId(e.target.value)}>
                        <option value="">— Choose a resume —</option>
                        {resumes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                      {baseResume && <div className="field-hint">{(baseResume.text?.length || 0).toLocaleString()} chars{baseResume.fileName ? ` · ${baseResume.fileName}` : ''}</div>}
                    </>
                  ) : (
                    <div className="ws-warn">
                      No resumes in your library yet.
                      <a onClick={() => setView?.('library')}>Add one →</a>
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <label className="field-label">Tailoring level</label>
                    <div className="seg-ctrl">
                      {LEVELS.map(l => <button key={l} className={tailoringLevel === l ? 'active' : ''} onClick={() => setTailoringLevel(l)}>{l}</button>)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="field-hint" style={{ marginTop: 12 }}>
                  Building from scratch uses your <strong>Career Profile</strong> as the only source of facts. No base resume needed.
                </div>
              )}
            </OptBlock>

            {/* ---- Career profile (scratch only) ---- */}
            {mode === 'scratch' && (
              <OptBlock title="Career profile" summary={profile?.name}>
                {profiles.length === 0 ? (
                  <div className="ws-warn">No career profiles found.<a onClick={() => setView?.('careerprofile')}>Create one →</a></div>
                ) : (
                  <>
                    <select value={profileId} onChange={e => setProfileId(e.target.value)}>
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (Default)' : ''}</option>)}
                    </select>
                    {profile && (
                      <div className="field-hint">{profile.experience?.length || 0} experience · {profile.education?.length || 0} education · {profile.skills?.length || 0} skills</div>
                    )}
                    {profileIncomplete && (
                      <div className="ws-warn">
                        This profile has no experience entries, so nothing can be generated.
                        <a onClick={() => setView?.('careerprofile')}>Fix →</a>
                      </div>
                    )}
                  </>
                )}
              </OptBlock>
            )}

            {/* ---- Target domain (scratch only) ---- */}
            {mode === 'scratch' && (
              <OptBlock title="Target domain" summary={selectedDomain?.name}>
                <input className="domain-search" type="text" placeholder="Search domains…" value={domainQuery} onChange={e => setDomainQuery(e.target.value)} />
                {filteredDomains.length > 0 ? (
                  <div className="domain-list">
                    {filteredDomains.map(d => (
                      <div key={d.id} className={`domain-row${selectedDomainId === d.id ? ' selected' : ''}`} onClick={() => setSelectedDomainId(d.id)}>
                        <div className="radio-dot" />
                        <div style={{ minWidth: 0 }}>
                          <div className="domain-row-name">
                            {d.name}
                            {d.isCustom && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>Custom</span>}
                          </div>
                          {d.summary && <div className="domain-row-meta">{d.summary}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="field-hint">No domains match “{domainQuery}”. Create one below.</div>
                )}

                {!createDomainOpen ? (
                  <button className="inline-create-toggle" onClick={() => setCreateDomainOpen(true)}>+ Create a custom domain</button>
                ) : (
                  <div className="inline-create">
                    <div className="field">
                      <label className="field-label">Name</label>
                      <input type="text" placeholder="e.g. Platform Engineering" value={newDomainName} onChange={e => setNewDomainName(e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="field-label">Parent domain <span className="count">(optional)</span></label>
                      <select value={newDomainParent} onChange={e => setNewDomainParent(e.target.value)}>
                        <option value="">— None —</option>
                        {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-label">Keywords</label>
                      <textarea rows={3} placeholder="Paste a list — commas or one per line" value={newDomainKwRaw}
                        onChange={e => setNewDomainKwRaw(e.target.value)}
                        onBlur={() => absorbKeywordPaste()}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); absorbKeywordPaste(); } }} />
                      <div className="field-hint">Comma or newline separated. Duplicates are removed automatically.</div>
                    </div>
                    {newDomainKws.length > 0 && (
                      <div className="kw-chips">
                        {newDomainKws.map(k => (
                          <span key={k} className="kw-chip">{k}<span className="x" onClick={() => setNewDomainKws(list => list.filter(x => x !== k))}>✕</span></span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" disabled={creatingDomain} onClick={handleCreateCustomDomain}>
                        {creatingDomain ? 'Creating…' : 'Create domain'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setCreateDomainOpen(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </OptBlock>
            )}

            {/* ---- Job description ---- */}
            <OptBlock title="Job description" summary={jdText.trim() ? `${jdText.trim().length.toLocaleString()} chars` : 'Empty'}>
              <JdInput jdText={jdText} setJdText={setJdText} jdMode={jdMode} setJdMode={setJdMode} imgStatus={imgStatus} setImgStatus={setImgStatus} />
            </OptBlock>

            {/* ---- Improve match ---- */}
            {version && missingKeywords.length > 0 && (
              <OptBlock title="Improve match" summary={`${selectedKeywords.length}/${missingKeywords.length} selected`} defaultOpen={false}>
                <p className="field-hint" style={{ marginBottom: 6 }}>Keywords the JD asks for that aren't in the current draft. Selected ones get woven in on the next generate, only where your evidence supports them.</p>
                {strongMissing.length > 0 && (
                  <>
                    <div className="kw-group-label strong">Missing — strong impact</div>
                    {strongMissing.map(k => (
                      <label key={k.term} className="kw-check">
                        <input type="checkbox" checked={selectedKeywords.includes(k.term)}
                          onChange={() => setSelectedKeywords(l => l.includes(k.term) ? l.filter(x => x !== k.term) : [...l, k.term])} />
                        {k.term}
                      </label>
                    ))}
                  </>
                )}
                {niceMissing.length > 0 && (
                  <>
                    <div className="kw-group-label nice">Missing — nice to have</div>
                    {niceMissing.map(k => (
                      <label key={k.term} className="kw-check">
                        <input type="checkbox" checked={selectedKeywords.includes(k.term)}
                          onChange={() => setSelectedKeywords(l => l.includes(k.term) ? l.filter(x => x !== k.term) : [...l, k.term])} />
                        {k.term}
                      </label>
                    ))}
                  </>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <label className="field-check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={rebuildSections.summary} onChange={e => setRebuildSections(s => ({ ...s, summary: e.target.checked }))} style={{ width: 'auto', accentColor: 'var(--brand)' }} />
                    Rebuild summary
                  </label>
                  <label className="field-check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={rebuildSections.experience} onChange={e => setRebuildSections(s => ({ ...s, experience: e.target.checked }))} style={{ width: 'auto', accentColor: 'var(--brand)' }} />
                    Rebuild experience
                  </label>
                </div>
              </OptBlock>
            )}
          </div>

          {/* Pinned to the bottom of the Select column so Generate is always reachable */}
          <div className="opt-footer">
            <OptBlock title="Custom instructions" summary={customInstructions.trim() ? 'Set' : 'Optional'} defaultOpen={false}>
              <textarea rows={3} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                placeholder="e.g. Emphasize leadership, keep it to one page, lead with the Microsoft role…" />
            </OptBlock>

            {version && (
              <div className="iterate-toggle">
                <label className="switch-row">
                  <span className="switch" data-on={iterateOnDraft}>
                    <input type="checkbox" checked={iterateOnDraft} onChange={e => setIterateOnDraft(e.target.checked)} />
                    <span className="switch-knob" />
                  </span>
                  <span className="switch-text">
                    <span className="switch-title">Build on top of v{historyIdx + 1}</span>
                    <span className="switch-sub">
                      {iterateOnDraft
                        ? 'Your instructions are applied to this draft, keeping everything else intact.'
                        : `Off: starts over from your ${mode === 'scratch' ? 'Career Profile' : 'base resume'}, ignoring this draft.`}
                    </span>
                  </span>
                </label>
              </div>
            )}

            <button className="btn btn-primary btn-full"
              disabled={loading || regenerating || !canAdvance}
              onClick={version ? handleAggressiveRebuild : (mode === 'scratch' ? runScratchPipeline : runTailorPipeline)}>
              {loading || regenerating ? 'Generating…' : version ? (iterateOnDraft ? `↻ Apply to v${historyIdx + 1}` : '↻ Rebuild fresh') : 'Generate Resume →'}
            </button>
            {!canAdvance && !loading && (
              <div className="field-hint" style={{ marginTop: 6, textAlign: 'center' }}>
                {profileIncomplete ? 'Add an experience entry to your Career Profile first.'
                  : !jdText.trim() ? 'Paste a job description to continue.'
                  : mode === 'scratch' ? 'Pick a career profile and a target domain.'
                  : 'Pick a base resume.'}
              </div>
            )}
          </div>
        </div>

        {/* ============ RIGHT: RESULT ============ */}
        <div className="ws-result">
          <div className="ws-col-head">
            <span className="ws-col-num">02 · result</span>
            <span className="ws-col-status">{version ? `${(version.content?.sections || []).length} sections` : 'Nothing generated yet'}</span>
          </div>

          {/* ---- Export receipt + actions (above the preview) ---- */}
          {version && !loading && !regenerating && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="export-row">
                <div className="seg-ctrl" style={{ flex: 'none' }}>
                  {['pdf', 'docx'].map(f => <button key={f} className={exportFormat === f ? 'active' : ''} onClick={() => setExportFormat(f)}>{f.toUpperCase()}</button>)}
                </div>
                <button className="btn btn-primary" onClick={() => handleDownload(exportFormat)}>⇩ Download {exportFormat.toUpperCase()}</button>
                <button className="btn btn-ghost" onClick={handleGenerateCoverLetter}>✎ Cover Letter</button>
                <button className="btn btn-ghost" onClick={openEmailDraft}>✉ Draft Email</button>
              </div>

              <div className="receipt" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="receipt-title">This export was built from</div>
                {mode === 'scratch' ? (
                  <>
                    <div className="receipt-row"><span className="k">Career profile</span><span className="v">{profile?.name || '—'}</span></div>
                    <div className="receipt-row"><span className="k">Target domain</span><span className="v">{selectedDomain?.name || '—'}</span></div>
                  </>
                ) : (
                  <>
                    <div className="receipt-row"><span className="k">Base resume</span><span className="v">{baseResume?.label || '—'}</span></div>
                    <div className="receipt-row"><span className="k">Tailoring level</span><span className="v">{tailoringLevel}</span></div>
                  </>
                )}
                <div className="receipt-row"><span className="k">Keywords matched</span><span className="v">{jdMatchRows.filter(m => m.level !== 'MISSING').length} of {jdMatchRows.length}</span></div>
                <div className="receipt-row"><span className="k">JD length</span><span className="v">{jdText.trim().length.toLocaleString()} chars</span></div>
                {history.length > 1 && (
                  <div className="receipt-row"><span className="k">Draft</span><span className="v">{history[historyIdx]?.label} · v{historyIdx + 1} of {history.length}</span></div>
                )}
              </div>

              {coverLetterOpen && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div className="panel-head"><h2>Cover Letter</h2><button className="btn btn-xs btn-ghost" onClick={() => setCoverLetterOpen(false)}>✕</button></div>
                  {coverLetterLoading ? <div className="loading"><span className="spinner" /> Writing…</div> :
                   coverLetterError ? <div className="error-box">{coverLetterError}</div> : (
                    <>
                      <textarea rows={10} value={coverLetterText} onChange={e => setCoverLetterText(e.target.value)} style={{ fontSize: 12.4, marginBottom: 10 }} />
                      <button className="btn btn-sm btn-primary btn-full" onClick={() => { navigator.clipboard.writeText(coverLetterText); notify?.({ kind: 'good', title: 'Copied', detail: 'Cover letter copied to clipboard' }); }}>Copy to clipboard</button>
                    </>
                  )}
                </div>
              )}

              {emailOpen && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div className="panel-head"><h2>Draft Email</h2><button className="btn btn-xs btn-ghost" onClick={() => setEmailOpen(false)}>✕</button></div>
                  <div className="mail-shell">
                    <div className="mail-field"><span className="k">To</span><input type="text" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="recruiter@company.com" /></div>
                    <div className="mail-field"><span className="k">Subject</span><input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} /></div>
                  </div>
                  <div className="mail-body-wrap"><textarea rows={7} value={emailBody} onChange={e => setEmailBody(e.target.value)} /></div>
                  <div className="attach-chip">📎 {exportTitle()}.pdf will be attached</div>
                  {sendError && <div className="error-box" style={{ marginTop: 10 }}>{sendError}</div>}
                  {sendSuccess && <div className="success-box" style={{ marginTop: 10 }}>Draft created in your Gmail account — check your Drafts folder to review and hit send.</div>}
                  <button className="btn btn-sm btn-primary btn-full" style={{ marginTop: 10 }} disabled={sending} onClick={handleSendDraft}>
                    {sending ? 'Creating draft…' : 'Create Gmail Draft'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="result-shell">
            {loading || regenerating ? (
              <div className="gen-shell">
                <BuildCat />
                <div className="gen-log">
                  {buildLog.map((item, i) => (
                    <div key={i} className={`gen-line${i < buildLog.length - 1 ? ' done' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
                      {i < buildLog.length - 1 ? '✓ ' : '→ '}{item.text}
                    </div>
                  ))}
                  {!buildLog.length && <div className="gen-line" style={{ opacity: 1 }}>Starting…</div>}
                </div>
              </div>
            ) : !version ? (
              <div className="gen-shell">
                <BuildCat done />
                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)', margin: '4px 0' }}>Ready when you are</div>
                <p style={{ fontSize: 12.5, color: 'var(--ink-2)', maxWidth: 320, margin: '0 auto', lineHeight: 1.6 }}>
                  Fill in the options on the left, then hit Generate. The result appears here without leaving this screen.
                </p>
              </div>
            ) : (
              <>
                <div className="result-head">
                  <div>
                    <div className={`result-score ats-tier-${scoreTier}`}>{score ?? '—'}</div>
                    <div className="result-score-label">ATS match</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)' }}>{scoreTierLabel}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{exportTitle()}</div>
                  </div>

                  {history.length > 1 && (
                    <div className="ver-nav" title="Every generate is kept — page back to compare earlier drafts">
                      <button className="ver-btn" disabled={historyIdx === 0} onClick={() => setHistoryIdx(i => Math.max(0, i - 1))}>‹</button>
                      <div className="ver-label">
                        <span className="ver-name">{history[historyIdx]?.label}</span>
                        <span className="ver-count">v{historyIdx + 1} of {history.length}</span>
                      </div>
                      <button className="ver-btn" disabled={historyIdx === history.length - 1} onClick={() => setHistoryIdx(i => Math.min(history.length - 1, i + 1))}>›</button>
                    </div>
                  )}

                  <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)', cursor: 'pointer', flexShrink: 0 }}>
                    <input type="checkbox" checked={showHighlights} onChange={e => setShowHighlights(e.target.checked)} style={{ width: 'auto', accentColor: 'var(--brand)' }} />
                    Highlight matches
                  </label>
                </div>

                <div className="result-tabs">
                  {[['resume', 'Preview'], ['matches', 'JD Match']].map(([t, label]) => {
                    const badge = t === 'matches' ? jdMatchRows.length : 0;
                    return (
                      <button key={t} className={`result-tab${reviewTab === t ? ' active' : ''}`} onClick={() => setReviewTab(t)}>
                        {label}{badge > 0 && <span className="nav-badge" style={{ marginLeft: 5 }}>{badge}</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="result-body">
                  {reviewTab === 'resume' && (
                    <div className="doc"><ResumePreview resume={{ ...version.content, highlights: highlightTerms }} showHighlights={showHighlights} /></div>
                  )}

                  {reviewTab === 'matches' && (
                    <>
                      {jdMatchRows.map(m => (
                        <div key={m.term} className="jdm-row">
                          <div>
                            <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{m.term}</div>
                            {m.meta && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.meta}</div>}
                          </div>
                          <span className={`jdm-pill ${String(m.level).toLowerCase()}`}>{m.level}</span>
                        </div>
                      ))}
                      {!jdMatchRows.length && <div className="empty">No requirement data available for this JD.</div>}
                      {(version.flags || []).filter(f => f.status === 'needs_review').length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <div className="diff-section-label">Quality check</div>
                          {(version.flags || []).filter(f => f.status === 'needs_review').map(f => (
                            <div key={f.id} className="jdm-row">
                              <div style={{ fontSize: 12.4 }}>{f.claimText}</div>
                              <button className="btn btn-xs btn-primary" onClick={() => handleVerifyFlag(f.id)}>Verify ✓</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
