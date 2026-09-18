import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const callClaudeProxy = httpsCallable(functions, 'claudeProxy', { timeout: 180000 });
// agentProxy handles career intelligence pipeline — separate callable with longer timeout
const callAgentProxy = httpsCallable(functions, 'agentProxy', { timeout: 300000 });

async function proxy(task, payload) {
  const res = await callClaudeProxy({ task, payload });
  if (!res || !res.data) {
    throw new Error(`No response from claudeProxy for task "${task}".`);
  }
  return res.data;
}

export async function analyzeJD({ jdText, resumeText }) {
  const { json } = await proxy('analyze', { jdText, resumeText });
  return json; // { matched, gaps, summary, atsScore }
}

export async function tailorResume({ jdText, resumeText, gaps, prompts, atsTarget, mode, intensity, aggressiveness, keywordDensity, bulletLength, lockedSections, allowRetry, jdIntel }) {
  try {
    const { json, creditsRemaining, cached } = await proxy('tailor', { jdText, resumeText, gaps, prompts, atsTarget, mode, intensity, aggressiveness, keywordDensity, bulletLength, lockedSections, allowRetry, jdIntel });
    if (!json || !json.resume || !json.resume.name || !Array.isArray(json.resume.sections)) {
      throw new Error('Tailoring response was missing resume data — the deployed Cloud Function may be out of date. Try "firebase deploy --only functions".');
    }
    // Debug only: a cache hit spends no credit and re-serves the prior draft,
    // which otherwise looks identical to "it ignored my changes".
    if (import.meta.env.DEV) {
      console.debug('[tailor]', cached ? 'served from cache (no credit spent)' : 'fresh build', {
        atsScore: json.atsScore,
        keywordCoverage: json.atsAudit?.keywordCoverage,
        missing: json.atsAudit?.missingKeywords,
        shallowInserts: json.atsAudit?.shallowInserts,
        fabricatedClaims: json.atsAudit?.fabricatedClaims,
      });
    }
    return { ...json, cached, creditsRemaining }; // { resume, atsScore, matchMatrix, creditsRemaining }
  } catch (err) {
    if (err?.code === 'functions/resource-exhausted') {
      const outOfCreditsErr = new Error('Out of credits.');
      outOfCreditsErr.code = 'OUT_OF_CREDITS';
      throw outOfCreditsErr;
    }
    throw err;
  }
}

export async function draftEmail({ jdText, resumeText, company, contactName, senderName, style }) {
  const { json } = await proxy('email', { jdText, resumeText, company, contactName, senderName, style });
  if (!json || typeof json.subject !== 'string') {
    throw new Error('Email draft response was malformed — the deployed Cloud Function may be out of date. Try "firebase deploy --only functions".');
  }
  return json; // { subject, body }
}

export async function draftThankYouEmail({ company, contactName, senderName, roleTitle, notes }) {
  const { json } = await proxy('thankYouEmail', { company, contactName, senderName, roleTitle, notes });
  if (!json || typeof json.subject !== 'string') {
    throw new Error('Thank-you email response was malformed.');
  }
  return json; // { subject, body }
}

export async function generateCoverLetter({ jdText, resumeText, company, roleTitle, senderName }) {
  const { json } = await proxy('coverLetter', { jdText, resumeText, company, roleTitle, senderName });
  if (!json || typeof json.body !== 'string') {
    throw new Error('Cover letter response was malformed.');
  }
  return json; // { body }
}

export async function getJdBreakdown({ jdText, resumeText }) {
  const { json, degraded, degradedReason } = await proxy('jdBreakdown', { jdText, resumeText });
  if (!json || !Array.isArray(json.matchMatrix)) {
    throw new Error('JD breakdown response was malformed.');
  }
  // A partial result still renders; the flag is what makes that visible.
  if (degraded) console.error('[jdBreakdown] degraded result:', degradedReason);
  return { ...json, degraded: !!degraded, degradedReason: degradedReason || null };
}

/** Rewrites one block. Never sends the whole resume — only this block's text. */
export async function fixBlock({ blockText, instruction, jobDescription, tailoringLevel, context }) {
  const { json } = await proxy('blockFix', { blockText, instruction, jobDescription, tailoringLevel, context });
  if (!json || typeof json.rewrittenText !== 'string') {
    throw new Error('Block rewrite response was malformed.');
  }
  return {
    rewrittenText: json.rewrittenText,
    keywordsAdded: json.keywordsAdded || [],
    warnings: json.warnings || [],
  };
}

export async function getResumeHealth({ resumeText }) {
  const { json } = await proxy('resumeHealth', { resumeText });
  return json; // { buzzwords, passiveVoiceBullets, repeatedVerbs, weakBullets, longBullets, grammarIssues }
}

export async function ocrImages(images) {
  const { text } = await proxy('ocr', { images });
  return text;
}

// ============================================================
// AGENT PIPELINE — uses agentProxy (separate callable)
// ============================================================

export async function agentProxy(task, payload) {
  const res = await callAgentProxy({ task, payload });
  if (!res?.data) throw new Error(`No response from agentProxy for task "${task}".`);
  return res.data;
}

export async function parseJobDescription(jobDescriptionId, rawText) {
  const { parsed } = await agentProxy('parseJD', { jobDescriptionId, rawText });
  return parsed;
}

export async function listPublicSubDomains(domainId) {
  const { subDomains } = await agentProxy('publicSubDomains', { domainId });
  return subDomains;
}

export async function analyzeAgentRun({ agentRunId, careerProfile, jobDescription, domainId, subDomainId }) {
  const { strategy } = await agentProxy('agentAnalyze', { agentRunId, careerProfile, jobDescription, domainId, subDomainId });
  return strategy;
}

export async function buildAgentResume({ agentRunId, careerProfile, jobDescription, strategy, domainId, subDomainId, previousResume }) {
  try {
    const { versionId, matchScore, creditsRemaining } = await agentProxy('agentBuild', { agentRunId, careerProfile, jobDescription, strategy, domainId, subDomainId, previousResume });
    return { versionId, matchScore, creditsRemaining };
  } catch (err) {
    if (err?.code === 'functions/resource-exhausted') {
      const outOfCreditsErr = new Error('Out of credits.');
      outOfCreditsErr.code = 'OUT_OF_CREDITS';
      throw outOfCreditsErr;
    }
    throw err;
  }
}

export async function domainAdminAction(action, domainId, data) {
  return agentProxy('domainAdmin', { action, domainId, data });
}
