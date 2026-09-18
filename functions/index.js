const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

const STARTER_CREDITS = 10;

// Coverage score a from-scratch build is repaired toward before it ships.
const ATS_SCORE_TARGET = 92;

// Authorization is always re-checked server-side against this list on every
// admin-only call — the client-visible `role` field on the user doc is
// display-only, never trusted for actual access control.
const ADMIN_EMAILS = ['cbhanu12dec@gmail.com'];

function isAdmin(request) {
  return !!request.auth?.token?.email && ADMIN_EMAILS.includes(request.auth.token.email);
}
// Total professional experience, merged so overlapping roles aren't double
// counted. Computed here rather than left to the model, which otherwise
// guesses a round number that the dates don't support.
function totalExperienceYears(experience = []) {
  const spans = experience.map(e => {
    const start = Date.parse(e.startDate || '');
    if (Number.isNaN(start)) return null;
    const end = /present|current/i.test(String(e.endDate || '')) || !e.endDate
      ? Date.now()
      : Date.parse(e.endDate);
    return Number.isNaN(end) || end < start ? null : [start, end];
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);
  if (!spans.length) return 0;

  const merged = [];
  let [curStart, curEnd] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else { merged.push([curStart, curEnd]); [curStart, curEnd] = [s, e]; }
  }
  merged.push([curStart, curEnd]);

  // Counted in calendar months: a fixed 365.25-day year drifts by a leap day
  // and reports a clean 9-year history as 8.
  const months = merged.reduce((sum, [s, e]) => {
    const a = new Date(s), b = new Date(e);
    return sum + (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
      + (b.getDate() >= a.getDate() ? 0 : -1);
  }, 0);
  return Math.max(0, Math.floor(months / 12));
}

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (!isAdmin(request)) throw new HttpsError('permission-denied', 'Admin access required.');
}

// Domain content reaches the agent from one of two shapes: the legacy inline
// `categories[]` array, or the Domain Library sub-collections. Only published
// skills/bullets and active instructions are ever fed to a build — draft
// authoring content must not leak into a candidate's resume.
// When `subDomainId` is given, domain-wide items still apply; only *other*
// sub-domains' content is excluded.
async function loadDomainContent(domainId, subDomainId = null) {
  const empty = { vocab: [], directives: [], bulletTemplates: [], label: '' };
  if (!domainId) return empty;
  const ref = db.collection('domains').doc(domainId);
  const snap = await ref.get();
  if (!snap.exists) return empty;

  const d = snap.data();
  let label = d.name || '';
  if (subDomainId) {
    const sub = await ref.collection('subDomains').doc(subDomainId).get();
    if (sub.exists) label = sub.data().name || label;
  }
  const legacyVocab = (d.categories || []).flatMap(c => c.skills || []).map(s => s.label).filter(Boolean);
  const legacyDirectives = (d.categories || []).flatMap(c => c.strongPoints || []).map(sp => sp.text).filter(Boolean);
  if (legacyVocab.length || legacyDirectives.length) {
    return { vocab: legacyVocab, directives: legacyDirectives, bulletTemplates: [], label };
  }

  const inScope = data => !data.subDomainId || !subDomainId || data.subDomainId === subDomainId;
  const [skills, instructions, bullets] = await Promise.all([
    ref.collection('skills').where('status', '==', 'published').get(),
    ref.collection('instructions').where('status', '==', 'active').get(),
    ref.collection('bulletPoints').where('status', '==', 'published').get(),
  ]);
  return {
    vocab: skills.docs.map(s => s.data()).filter(inScope).map(s => s.name).filter(Boolean),
    directives: instructions.docs.map(i => i.data()).filter(inScope)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(i => i.instruction).filter(Boolean),
    bulletTemplates: bullets.docs.map(b => b.data()).filter(inScope).map(b => b.text).filter(Boolean),
    label,
  };
}

// Tailoring modes — each maps to a short style directive appended to the
// per-call dynamic prompt (not the cached system block, since these vary).
const TAILOR_MODES = {
  ats: 'Prioritize literal keyword coverage and exact-match phrasing over creative language — optimize purely for automated ATS parsing, even at some cost to natural flow.',
  recruiter: 'Write for a fast human skim by a recruiter — clear, punchy impact statements, minimal jargon, scannable in seconds.',
  hiring_manager: 'Write for a technical hiring manager evaluating depth — emphasize scope, ownership, and the reasoning behind technical decisions, not just what was built.',
  executive: 'Use an executive tone — strategic and org-wide impact, business outcomes, and leadership framing over technical minutiae.',
  faang: 'Use the metrics-dense, scale-and-systems-impact bullet convention common at large tech companies — quantified outcomes, technical scope, systems thinking.',
  startup: 'Emphasize versatility, ownership across the stack, and scrappy high-impact execution over narrow specialization.',
  government: 'Use formal, precise, compliance-aware language suited to public-sector hiring — avoid startup jargon and casual phrasing.',
  banking: 'Use precise, risk-aware, compliance-conscious language suited to financial services and banking.',
  healthcare: 'Emphasize compliance, patient/data safety, and regulatory awareness suited to healthcare roles.',
  telecom: 'Emphasize infrastructure scale, reliability, and network/systems engineering context.',
  ai_ml: 'Emphasize model development, data pipelines, experimentation rigor, and measurable ML/AI impact.',
  tpm: 'Emphasize cross-functional program delivery, stakeholder alignment, and execution rigor over hands-on implementation detail.',
  swe: 'Emphasize hands-on technical implementation, system design decisions, and engineering craftsmanship.'
};

const AGGRESSIVENESS = {
  conservative: 'WORDING INTENSITY: conservative — reorder and lightly reword only; keep the original sentence structure and phrasing recognizable throughout. Do not rewrite bullets from scratch at this level, but still work in required JD terminology naturally within the existing structure and still apply the Skills/title-framing rules from the system instructions.',
  balanced: 'WORDING INTENSITY: balanced — moderately rewrite; rework phrasing and structure where it clearly helps, but keep a recognizable throughline from the original rather than a ground-up rebuild of every sentence.',
  complete: 'WORDING INTENSITY: complete — fully reconstruct the wording of every bullet, exactly as described in the system instructions\' EXTRACT/REWRITE method and REWRITE DEPTH section.'
};
const KEYWORD_DENSITY = {
  low: 'Use JD terminology naturally and sparingly — don\'t force keywords in where they don\'t fit.',
  medium: 'Aim for balanced keyword coverage of the JD\'s key terms without overstuffing.',
  high: 'Maximize literal coverage of the JD\'s specific keywords and phrases throughout, even if it reads slightly less naturally as a result.'
};
const BULLET_LENGTH = {
  short: 'Keep every bullet to one concise line.',
  medium: 'Keep bullets to about one to two lines each.',
  long: 'Bullets can run up to about three lines where more context genuinely helps.'
};

// Human-friendly preset shown in the UI (Conservative / Balanced / Aggressive)
// — maps to the granular levers above internally, so the underlying prompt
// logic doesn't need three separate technical decisions from the user.
const INTENSITY_PRESETS = {
  conservative: { aggressiveness: 'conservative', keywordDensity: 'low', bulletLength: 'medium' },
  balanced: { aggressiveness: 'balanced', keywordDensity: 'medium', bulletLength: 'medium' },
  aggressive: { aggressiveness: 'complete', keywordDensity: 'high', bulletLength: 'medium' }
};

// Credit packs — id must match what BillingView sends. Prices in USD cents.
const PACKS = {
  pack_100: { credits: 100, amountCents: 900, label: '100 credits' },
  pack_250: { credits: 250, amountCents: 1999, label: '250 credits' },
  pack_500: { credits: 500, amountCents: 3999, label: '500 credits' }
};

// ===================== CLAUDE PROXY =====================

const MODEL_FAST = 'claude-haiku-4-5-20251001';
const MODEL_QUALITY = 'claude-sonnet-4-6';

async function callAnthropic(apiKey, content, { model = MODEL_FAST, maxTokens = 1200, system = null, timeoutMs = null, logTag = null } = {}) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (system) body.system = system;

  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const startedAt = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }
    const data = await res.json();

    // Instrumentation — this is the only way to know whether prompt caching
    // is actually landing cache hits, and how output length is trending,
    // instead of guessing. Query these in Cloud Logging by filtering on
    // jsonPayload.tag="anthropic_call".
    const u = data.usage || {};
    console.log(JSON.stringify({
      tag: 'anthropic_call',
      logTag,
      model,
      elapsedMs: Date.now() - startedAt,
      inputTokens: u.input_tokens ?? null,
      outputTokens: u.output_tokens ?? null,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreateTokens: u.cache_creation_input_tokens ?? 0
    }));

    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripJsonFence(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

/**
 * Structured-JSON model call that cannot fail silently.
 *
 * A truncated response is detected BEFORE parsing (an unterminated envelope
 * never closes its brace) and retried once with a raised ceiling, because
 * that failure mode is a token-budget bug rather than a formatting one and
 * silently returning null hid exactly this for a whole release.
 *
 * Always resolves — never throws — so an optional enrichment call can degrade
 * instead of taking the request down. The caller gets {data, degraded, reason}
 * and must decide what a null `data` means.
 */
async function callAnthropicJson(apiKey, prompt, opts = {}) {
  const { maxTokens = 1600, logTag = 'json', model, retryMaxTokens } = opts;

  const attempt = async (tokens, isRetry) => {
    const raw = await callAnthropic(apiKey, prompt, { ...opts, maxTokens: tokens, logTag: isRetry ? `${logTag}_retry` : logTag });
    const cleaned = stripJsonFence(raw || '');
    const closed = /[}\]]$/.test(cleaned);
    return { raw, cleaned, closed, tokens };
  };

  const fail = (reason, detail, raw, tokens) => {
    // The raw body is logged deliberately: without it a malformed response is
    // undiagnosable after the fact. Capped so one bad call cannot flood logs.
    console.error(JSON.stringify({
      tag: 'structured_json_failure', logTag, reason, detail,
      maxTokens: tokens, rawLength: (raw || '').length,
      looksTruncated: reason === 'truncated',
      rawSample: String(raw || '').slice(0, 1200),
    }));
    return { data: null, degraded: true, reason };
  };

  let first;
  try {
    first = await attempt(maxTokens, false);
  } catch (e) {
    return fail('call_failed', e.message, '', maxTokens);
  }

  let best = first;
  if (!first.closed) {
    const bigger = retryMaxTokens || Math.min(maxTokens * 2, 8000);
    console.warn(JSON.stringify({
      tag: 'structured_json_truncated', logTag, maxTokens, retryingWith: bigger, rawLength: first.raw.length,
    }));
    try {
      const second = await attempt(bigger, true);
      if (second.closed) best = second;
    } catch (e) {
      console.error(JSON.stringify({ tag: 'structured_json_retry_failed', logTag, detail: e.message }));
    }
    if (!best.closed) return fail('truncated', 'response never closed its JSON envelope', best.raw, best.tokens);
  }

  try {
    return { data: JSON.parse(best.cleaned), degraded: false, reason: null };
  } catch (e) {
    return fail('malformed', e.message, best.raw, best.tokens);
  }
}

// Models reach for em/en dashes constantly and they read as AI-written to
// recruiters. Date ranges keep a plain hyphen; in prose the dash becomes a comma.
const DATE_RANGE_RE = /^(?:[A-Za-z]{3,9}\.?\s*)?\d{4}\s*[—–-]\s*(?:(?:[A-Za-z]{3,9}\.?\s*)?\d{4}|Present|Current|Now)$/i;

function stripFancyDashes(str) {
  const trimmed = str.trim();
  if (DATE_RANGE_RE.test(trimmed)) return trimmed.replace(/\s*[—–]\s*/g, ' - ');
  return trimmed
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*–\s*/g, ' - ')
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[,\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeResumeContent(node) {
  if (typeof node === 'string') return stripFancyDashes(node);
  if (Array.isArray(node)) return node.map(sanitizeResumeContent);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, sanitizeResumeContent(v)]));
  }
  return node;
}

// ===================== DETERMINISTIC ATS AUDIT =====================
// The model's self-reported ATS score is systematically optimistic, so it is
// never trusted on its own. Everything below is measured against the resume
// the model actually produced, and drives both the repair pass and the score.

const ATS_MIN_KEYWORD_COVERAGE = 85;   // percent of required keywords present verbatim
const ATS_TARGET_QUANT_RATIO = 0.5;    // share of bullets carrying a concrete number

const WEAK_OPENER_RE = /^(responsible for|worked on|helped|assisted (with|in)|involved in|tasked with|duties included|participated in|contributed to)\b/i;
const PRONOUN_RE = /\b(I|my|me|we|our|us)\b/;
const BUZZWORD_RE = /\b(synergy|synergies|team player|results[- ]driven|go[- ]getter|self[- ]starter|think outside the box|detail[- ]oriented|hard[- ]working|dynamic professional|proven track record)\b/i;
// Not banned outright — any one of these can be the honest verb. It's the pile-up
// that reads as machine-written, so this is counted rather than flagged per hit.
const AI_SIGNAL_RE = /\b(leverag(?:e|ed|ing)|spearhead(?:ed|ing)?|orchestrat(?:e|ed|ing)|utiliz(?:e|ed|ing)|transformative|cutting[- ]edge|innovative solutions?|seamless(?:ly)?|robust|comprehensive|data[- ]driven|holistic|strategic initiatives?)\b/gi;
const AI_SIGNAL_BUDGET = 3;

// Abstractions that stand in for the thing actually built. Treated as a
// defect rather than a style preference: when the evidence supports naming
// the real platform or problem, a placeholder phrase is lost information.
const VAGUE_PHRASE_RE = /\b(enterprise[- ](?:wide )?(?:initiatives?|programs?|technology programs?|solutions?)|complex (?:technology |business )?(?:programs?|initiatives?|projects?)|various (?:stakeholders?|teams?|systems?|tools?|initiatives?)|multiple (?:stakeholders?|workstreams? and teams?)|different (?:stakeholders?|teams?)|cross[- ]functional initiatives?|key initiatives?|business[- ]critical (?:initiatives?|programs?))\b/i;

/**
 * "Verb + comma-separated list of duties" reads as a checklist rather than
 * an accomplishment, and is a JD-conversion tell even with no keyword
 * inserted. Requires three or more list items and no figure anywhere, so a
 * genuine list that lands on a measured outcome is left alone.
 */
function isKeywordChain(bullet) {
  const b = String(bullet || '');
  if (/\d/.test(b)) return false;
  const segments = b.split(/,| and /i).map(s => s.trim()).filter(Boolean);
  if (segments.length < 4) return false;
  // Trailing items in a duty list are noun phrases, not clauses with verbs.
  const tail = segments.slice(1);
  const verbless = tail.filter(s => s.split(/\s+/).length <= 5 && !/\b(reduc|increas|cut|sav|deliver|improv|grew|drove|enabl|elimin|prevent)\w*\b/i.test(s));
  return verbless.length >= Math.ceil(tail.length * 0.75);
}

function resumeToPlainText(resume) {
  const parts = [];
  for (const s of resume?.sections || []) {
    if (s.heading) parts.push(s.heading);
    for (const p of s.paragraphs || []) parts.push(p);
    for (const e of s.entries || []) {
      parts.push(e.title || '', e.subtitle || '', e.dateRight || '', e.footer || '');
      for (const b of e.bullets || []) parts.push(b);
    }
  }
  return parts.filter(Boolean).join('\n');
}

function collectExperienceBullets(resume) {
  return (resume?.sections || [])
    .filter(s => !/education|certification/i.test(s.heading || ''))
    .flatMap(s => (s.entries || []).flatMap(e => e.bullets || []))
    .filter(b => typeof b === 'string' && b.trim());
}

// How essential a term is to the role. Frequency alone gets this wrong: a
// once-mentioned licence can gate the application while a four-times-repeated
// piece of filler language does not, so the semantic level outranks the count.
const LEVEL_RANK = { 'must-have': 3, differentiator: 2, 'nice-to-have': 1 };
const DEFAULT_LEVEL = 'differentiator';
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "+", "#" and "." are part of tokens like C++, C# and .NET, so \b is wrong
// here — these edges treat them as inside a word rather than a boundary.
const EDGE_L = '(^|[^a-z0-9+#.])';
const EDGE_R = '([^a-z0-9+#.]|$)';

/**
 * Presence test bound to one body of text. Word-boundary first, then a light
 * stem fallback so "leading" satisfies "lead". Deliberately NOT a substring
 * test: that is what let "database" silently satisfy "data".
 */
function presenceChecker(text) {
  const lower = String(text || '').toLowerCase();
  const stems = new Set(tokenize(lower).map(stemToken));
  return function present(term) {
    const t = String(term || '').trim().toLowerCase();
    if (!t) return false;
    if (new RegExp(`${EDGE_L}${escapeRe(t)}${EDGE_R}`).test(lower)) return true;
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return stems.has(stemToken(t));
    // A multi-word requirement counts as present when every significant word
    // in it is present, which is how Flow B grades phrases.
    const sig = parts.filter(p => !REQ_STOPWORDS.has(p));
    return sig.length > 0 && sig.every(p => stems.has(stemToken(p)));
  };
}

// Words too generic to say anything about whether a bullet was rewritten.
const OVERLAP_STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','over','across','within','while','their','its',
  'was','were','has','have','had','are','been','being','than','then','there','which','who','whom',
  'per','via','use','used','using','also','both','each','more','most','new','other','such','about',
]);

function overlapTokens(s) {
  return new Set(
    tokenize(s)
      .filter(t => t.length > 2 && !/^\d+$/.test(t) && !OVERLAP_STOPWORDS.has(t) && !REQ_STOPWORDS.has(t))
      .map(stemToken)
  );
}

/**
 * Flags bullets that kept the original sentence and had a keyword dropped in,
 * which the prompt calls a failure but nothing previously measured.
 *
 * Bullets cannot be aligned by index: the rewrite reorders, merges and cuts
 * them, so position i out means nothing about position i in. Each rewritten
 * bullet is therefore compared against its closest original by token
 * containment, which is the only way to ask "was this derived from that one,
 * essentially unchanged?".
 */
function detectShallowInserts(bullets, originalBullets, requiredTerms, threshold = 0.8) {
  const origs = (originalBullets || [])
    .map(text => ({ text, tokens: overlapTokens(text) }))
    .filter(o => o.tokens.size >= 4); // too short to judge reliably
  if (!origs.length || !requiredTerms.length) return [];

  const flagged = [];
  bullets.forEach((bullet, i) => {
    const newTokens = overlapTokens(bullet);
    if (newTokens.size < 4) return;

    let best = null;
    for (const o of origs) {
      let shared = 0;
      for (const t of o.tokens) if (newTokens.has(t)) shared++;
      const ratio = shared / o.tokens.size;
      if (!best || ratio > best.ratio) best = { ratio, source: o };
    }
    if (!best || best.ratio <= threshold) return;

    const inNew = presenceChecker(bullet);
    const inOld = presenceChecker(best.source.text);
    const inserted = requiredTerms.find(t => inNew(t) && !inOld(t));
    if (inserted) {
      flagged.push({
        index: i + 1,
        bullet,
        keyword: inserted,
        overlap: Math.round(best.ratio * 100),
      });
    }
  });
  return flagged;
}

/**
 * Style signal only. Three consecutive bullets opening the same way reads as
 * template-stuffing, but it is a matter of taste rather than correctness, so
 * this never gates a repair on its own — atsRepairInstruction appends it only
 * when some real violation already earned a repair pass.
 */
function detectRepeatedOpeners(bullets, run = 3) {
  const opener = b => stemToken(String(b || '').trim().toLowerCase().split(/[^a-z0-9]+/)[0] || '');
  let streak = 1;
  for (let i = 1; i < bullets.length; i++) {
    const a = opener(bullets[i - 1]);
    const b = opener(bullets[i]);
    streak = a && a === b ? streak + 1 : 1;
    if (streak >= run) return { opener: b, count: streak, from: i - streak + 2 };
  }
  return null;
}

/**
 * @param requiredKeywords plain strings, or {term, level, count} from
 *        mergeRequiredTerms. Flow B passes [] and is unaffected.
 * @param originalBullets  source-resume bullet lines, for rewrite verification.
 * @param domainClaims     Fix 6b terms that may only appear if the source
 *                         resume already evidences them.
 */
function auditAts(resume, requiredKeywords = [], originalBullets = null, domainClaims = []) {
  const text = resumeToPlainText(resume);
  const seen = new Map();
  for (const k of requiredKeywords || []) {
    const term = String((k && k.term) || k || '').trim();
    if (!term) continue;
    const level = (k && k.level) || DEFAULT_LEVEL;
    const count = (k && k.count) || 0;
    const key = term.toLowerCase();
    const prev = seen.get(key);
    // Same term from both sources keeps whichever level ranks higher.
    if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev.level]) {
      seen.set(key, { term, level, count: Math.max(count, prev?.count || 0) });
    } else if (count > prev.count) {
      seen.set(key, { ...prev, count });
    }
  }
  const required = [...seen.values()];

  const present = presenceChecker(text);
  const missing = required.filter(r => !present(r.term));
  const keywordCoverage = required.length
    ? Math.round(((required.length - missing.length) / required.length) * 100)
    : null;
  // must-have first regardless of how often the posting said it.
  const byImportance = (a, b) =>
    LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.count - a.count || a.term.localeCompare(b.term);

  const bullets = collectExperienceBullets(resume);
  const quantifiedBullets = bullets.filter(b => /\d/.test(b)).length;
  const quantificationRatio = bullets.length ? quantifiedBullets / bullets.length : 0;

  // Fix 6b enforcement: a named framework, certification or compliance regime
  // that the source resume never mentions cannot appear in the rewrite. This
  // is the mechanical half of the guardrail; the prompt is the other half.
  const sourceText = (originalBullets || []).join('\n');
  const inSource = sourceText ? presenceChecker(sourceText) : null;
  const fabricatedClaims = inSource
    ? [...new Set((domainClaims || []).map(t => String(t || '').trim()).filter(Boolean))]
      .filter(t => present(t) && !inSource(t))
    : [];

  return {
    totalRequired: required.length,
    keywordCoverage,
    missingKeywords: missing.sort(byImportance).map(m => m.term),
    missingRanked: missing.sort(byImportance),
    totalBullets: bullets.length,
    quantifiedBullets,
    quantificationRatio,
    pronounBullets: bullets.filter(b => PRONOUN_RE.test(b)),
    weakOpenerBullets: bullets.filter(b => WEAK_OPENER_RE.test(b.trim())),
    buzzwordBullets: bullets.filter(b => BUZZWORD_RE.test(b)),
    aiSignalWords: bullets.flatMap(b => b.match(AI_SIGNAL_RE) || []),
    fabricatedClaims,
    repeatedOpeners: detectRepeatedOpeners(bullets),
    keywordChainBullets: bullets.filter(isKeywordChain),
    vaguePhraseBullets: bullets.filter(b => VAGUE_PHRASE_RE.test(b)),
    shallowInsertBullets: originalBullets
      ? detectShallowInserts(bullets, originalBullets, required.map(r => r.term))
      : [],
  };
}

/**
 * Re-grades the JD match panel against the resume that was actually produced.
 *
 * The panel used to render getJdBreakdown's verdict, which grades the JD
 * against the ORIGINAL upload and runs before the rewrite exists — so a term
 * the rewrite added still showed as missing. This recompute is deterministic
 * and reuses the Fix 3 matcher, so it costs nothing and cannot disagree with
 * the coverage score. resumeToPlainText covers paragraphs as well as bullets,
 * which is what lets a term living only in a comma-delimited skills line
 * count as present.
 */
function recomputeMatchMatrix(resume, matchMatrix) {
  if (!Array.isArray(matchMatrix) || !matchMatrix.length) return null;
  const text = resumeToPlainText(resume);
  const present = presenceChecker(text);
  const stems = new Set(tokenize(text.toLowerCase()).map(stemToken));

  return matchMatrix.map(m => {
    const term = String(m?.term || '').trim();
    if (!term) return m;
    if (present(term)) return { ...m, status: 'strong' };
    const words = term.toLowerCase().split(/\s+/).filter(w => w && !REQ_STOPWORDS.has(w));
    const hit = words.filter(w => stems.has(stemToken(w))).length;
    return { ...m, status: hit > 0 && hit < words.length ? 'partial' : 'missing' };
  });
}

// Blends the model's estimate with what was actually measured, so the number
// shown to the user cannot drift far above the resume's real keyword coverage.
function reconcileAtsScore(modelScore, audit) {
  if (!audit || audit.keywordCoverage == null) return modelScore;
  const quantScore = Math.min(100, Math.round((audit.quantificationRatio / ATS_TARGET_QUANT_RATIO) * 100));
  const hygienePenalty = Math.min(40, (audit.pronounBullets.length + audit.weakOpenerBullets.length + audit.buzzwordBullets.length) * 8);
  const measured = Math.round(audit.keywordCoverage * 0.6 + quantScore * 0.2 + (100 - hygienePenalty) * 0.2);
  return Math.max(0, Math.min(100, Math.round(modelScore * 0.4 + measured * 0.6)));
}

function atsRepairInstruction(audit) {
  const issues = [];
  // A fabricated credential is the most damaging failure here, so it leads.
  if ((audit.fabricatedClaims || []).length) {
    issues.push(`Your draft claims ${audit.fabricatedClaims.map(t => `"${t}"`).join(', ')}, which appears nowhere in the candidate's original resume. These are domain-typical terms, not evidence. Remove every one of them and re-state what the candidate actually did in that bullet.`);
  }
  // Rewrite failures next: fixing wording is pointless if the bullet is still
  // the original sentence with a term dropped into it.
  for (const s of (audit.shallowInsertBullets || []).slice(0, 4)) {
    issues.push(`Bullet ${s.index} was flagged as keyword-inserted, not rewritten (unchanged: ${s.overlap}% of the original wording): "${s.bullet.slice(0, 90)}". Re-extract the underlying fact from the original bullet and rebuild the sentence structure around it — do not keep the original sentence shape and swap in "${s.keyword}".`);
  }
  if (audit.missingKeywords.length) {
    // Ranked when the caller supplied levels (Flow A); plain otherwise (Flow B
    // substitutes its own importance-sorted requirement names).
    const ranked = audit.missingRanked || [];
    const label = ranked.length
      ? ranked.map(m => (m.level === 'must-have' ? `${m.term} (must-have)` : m.level === 'nice-to-have' ? `${m.term} (nice-to-have)` : m.term)).join(', ')
      : audit.missingKeywords.join(', ');
    issues.push(`These required JD keywords do NOT appear anywhere in your draft, must-haves first. Work each one in verbatim on a bullet whose evidence genuinely supports it, or leave it out if no bullet does: ${label}.`);
  }
  if (audit.totalBullets && audit.quantificationRatio < ATS_TARGET_QUANT_RATIO) {
    issues.push(`Only ${audit.quantifiedBullets} of ${audit.totalBullets} experience bullets contain a concrete number. Raise this to at least half by surfacing scale, volume, team size, timeline, or percentage figures already implied by the source resume. Never invent a figure that is not supported.`);
  }
  if (audit.weakOpenerBullets.length) {
    issues.push(`These bullets open with a passive/weak phrase instead of a strong action verb. Rewrite each: ${audit.weakOpenerBullets.slice(0, 5).map(b => `"${b.slice(0, 70)}"`).join('; ')}.`);
  }
  if (audit.pronounBullets.length) {
    issues.push(`Remove all first-person pronouns from these bullets: ${audit.pronounBullets.slice(0, 5).map(b => `"${b.slice(0, 70)}"`).join('; ')}.`);
  }
  if (audit.buzzwordBullets.length) {
    issues.push(`Replace the generic buzzwords in these bullets with the specific thing that was actually done: ${audit.buzzwordBullets.slice(0, 5).map(b => `"${b.slice(0, 70)}"`).join('; ')}.`);
  }
  if ((audit.keywordChainBullets || []).length) {
    issues.push(`These bullets are built as an action followed by a comma-separated list of duties, which reads as a checklist rather than an accomplishment: ${audit.keywordChainBullets.slice(0, 4).map(b => `"${b.slice(0, 80)}"`).join('; ')}. Rebuild each around ONE primary accomplishment as connected cause and effect: what problem made the work necessary, what was done, at what scale, and what changed. Move the remaining items to a different bullet whose evidence fits them, or drop them.`);
  }
  if ((audit.vaguePhraseBullets || []).length) {
    issues.push(`These bullets hide the actual work behind a placeholder phrase: ${audit.vaguePhraseBullets.slice(0, 4).map(b => `"${b.slice(0, 80)}"`).join('; ')}. Name the real platform, system, process or problem from the original resume instead. If the source genuinely does not say which one, describe the work concretely rather than reaching for an abstraction.`);
  }
  if ((audit.aiSignalWords || []).length > AI_SIGNAL_BUDGET) {
    const counts = {};
    for (const w of audit.aiSignalWords) { const k = w.toLowerCase(); counts[k] = (counts[k] || 0) + 1; }
    const listed = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, n]) => `"${w}" x${n}`).join(', ');
    issues.push(`The draft uses ${audit.aiSignalWords.length} inflated/AI-sounding words, which reads as machine-written: ${listed}. Cut this to at most ${AI_SIGNAL_BUDGET} across the whole resume by replacing each with the concrete verb for what was actually done (e.g. "leveraged X to improve Y" becomes "rebuilt X, cutting Y"). Keep an instance only where it is genuinely the most accurate word.`);
  }
  // Style note, never a reason to repair on its own — only rides along when
  // something above already earned the pass.
  if (issues.length && audit.repeatedOpeners) {
    issues.push(`Style note, not a defect: ${audit.repeatedOpeners.count} bullets in a row open with "${audit.repeatedOpeners.opener}". Vary the sentence openings while you are making the fixes above — a run of identical shapes reads as templated.`);
  }
  return issues.length ? issues.map((s, i) => `${i + 1}. ${s}`).join('\n') : '';
}

// JD requirements arrive as phrases ("Experience with distributed systems at
// scale"), so a verbatim substring test almost never fires. Match on the
// phrase's significant terms instead and grade by how many are present.
const REQ_STOPWORDS = new Set([
  'experience','with','and','or','the','a','an','of','in','on','for','to','at','as','by','from',
  'strong','solid','proven','excellent','good','great','deep','hands','years','year','plus',
  'ability','skills','skill','knowledge','understanding','working','proficiency','proficient',
  'familiarity','familiar','demonstrated','track','record','using','use','including','such',
  'must','have','should','be','is','are','you','your','we','our','this','that','role','work',
  'related','similar','equivalent','preferred','required','nice','bonus','etc','across','within',
]);

// Light stemming so "leading engineering teams" matches "engineers ... team" —
// real ATS parsers normalise this way, and exact-form matching understates
// coverage badly. Rules are deliberately conservative and applied in order so
// related forms land on the same stem.
function stemToken(t) {
  if (t.length <= 4) return t;
  if (/ies$/.test(t)) return t.slice(0, -3) + 'y';
  if (/ing$/.test(t) && t.length > 6) return t.slice(0, -3);
  if (/ed$/.test(t) && t.length > 5) return t.slice(0, -2);
  if (/[^s]s$/.test(t)) return t.slice(0, -1);
  return t;
}

// "." and "/" are kept inside tokens so ".NET" and "CI/CD" survive, but a
// trailing one is just sentence punctuation and would break stem matching.
function tokenize(s) {
  return String(s || '').toLowerCase()
    .split(/[^a-z0-9+#./-]+/)
    .map(t => t.replace(/^[./-]+|[./-]+$/g, ''))
    .filter(Boolean);
}

function requirementTerms(name) {
  const raw = String(name || '').toLowerCase();
  const terms = tokenize(raw).filter(t => {
    if (t.length < 2 || /^\d+$/.test(t)) return false;
    if (REQ_STOPWORDS.has(t)) return false;
    // "hands-on" survives the plain stopword test but carries no meaning.
    if (t.includes('-') && t.split('-').every(p => !p || REQ_STOPWORDS.has(p))) return false;
    return true;
  });
  return { terms: [...new Set(terms)], phrase: raw.trim() };
}

// Boilerplate that appears in almost every posting. These are frequent enough
// to dominate a raw frequency ranking while carrying no matching value, so
// they are excluded on top of REQ_STOPWORDS.
const JD_BOILERPLATE = new Set([
  'job','description','responsibilities','responsibility','qualifications','requirements','requirement',
  'candidate','candidates','applicant','applicants','position','positions','opportunity','opportunities',
  'company','companies','client','clients','customer','customers','business','businesses',
  'team','teams','teamwork','member','members','environment','environments','culture',
  'looking','seeking','join','apply','applying','application','applications','hiring','hire',
  'benefits','salary','compensation','insurance','paid','vacation','remote','hybrid','onsite','office',
  'please','will','can','may','also','well','other','others','new','strongly','highly','ideal','ideally',
  'responsible','duties','include','includes','included','ensure','ensuring','help','helping',
  'day','days','week','weeks','month','months','time','full','part','per','their','them','they','who',
  'what','when','where','which','all','any','more','most','both','each','every','some','into','out',
  'up','down','over','under','about','than','then','there','here','it','its','if','but','not','no',
  'employment','employer','equal','diversity','inclusive','opportunityemployer','eeo','veteran',
  'degree','bachelor','bachelors','master','masters','field','university','college','education',
  'communication','written','verbal','interpersonal','collaborate','collaborative','collaboration',
  'passion','passionate','motivated','driven','dynamic','fast','paced','growth','impact','mission',
]);

/**
 * Tokens a posting marks as proper nouns or acronyms. A JD often names a
 * required technology exactly once ("Strong SQL skills"), so frequency alone
 * would drop it; this lets those through without admitting prose filler.
 */
function distinctiveJdTokens(jdText) {
  const raw = String(jdText || '');
  const out = new Set();
  const clean = t => t.toLowerCase().replace(/^[./-]+|[./-]+$/g, '');

  // Acronyms and tokens carrying tech punctuation: SQL, AWS, S3, CI/CD, .NET.
  for (const m of raw.match(/\b[A-Z][A-Z0-9]+(?:[+#./-][A-Za-z0-9]+)*\b|\b[A-Za-z]+[+#]{1,2}\b/g) || []) {
    const t = clean(m);
    if (t.length >= 2) out.add(t);
  }

  // Capitalised words that are not the first word of a line, bullet or
  // sentence — that position is why "Design" and "Own" are not picked up.
  for (const chunk of raw.split(/[.;:!?\n\r]+/)) {
    const words = chunk.trim().replace(/^[-*•\s]+/, '').split(/\s+/).slice(1);
    for (const w of words) {
      // Trailing commas and brackets are why "(S3, Glue, Lambda)" was missed.
      const bare = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, '');
      if (/^[A-Z][A-Za-z0-9+#./-]{1,}$/.test(bare)) out.add(clean(bare));
    }
  }
  return out;
}

/**
 * Ranks the JD's own distinctive vocabulary straight from the raw posting.
 * This is a deterministic fallback so the tailor audit has something
 * objective to grade against even when the model under-reports what the JD
 * asked for. Frequency-ranked because a posting repeats what it cares about.
 *
 * Returns {term, count, tier} — the count is what a posting's own emphasis
 * looks like, so it stands in for Flow B's parsed importance without needing
 * the parse step.
 */
function extractJdTerms(jdText, limit = 24) {
  const distinctive = distinctiveJdTokens(jdText);
  const counts = new Map();
  for (const t of tokenize(jdText)) {
    // Two-character tokens are only worth keeping when the posting named them
    // as a product or acronym — S3, Go, C#.
    if (t.length < 3 && !distinctive.has(t)) continue;
    if (t.length < 2 || /^\d+$/.test(t)) continue;
    if (REQ_STOPWORDS.has(t) || JD_BOILERPLATE.has(t)) continue;
    if (t.includes('-') && t.split('-').every(p => !p || REQ_STOPWORDS.has(p) || JD_BOILERPLATE.has(p))) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    // A term mentioned once is only kept when the posting itself marked it out
    // as a name or acronym; otherwise it is almost always prose.
    .filter(([t, n]) => n >= 2 || distinctive.has(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({
      term,
      count,
      // Frequency is a sub-signal only; mergeRequiredTerms decides the level.
      freqTier: count >= 4 ? 'high' : count >= 2 ? 'mid' : 'named',
    }));
}

/**
 * Final ranking for Flow A. Server-extracted JD terms are the floor; the
 * model's own list widens it; the semantic pass from getJdBreakdown supplies
 * how essential each term is. Frequency only breaks ties within a level, so a
 * once-mentioned must-have outranks a four-times-repeated nice-to-have.
 */
function mergeRequiredTerms(jdTerms, modelTerms = [], importance = []) {
  const levelOf = new Map();
  for (const row of importance || []) {
    const term = String(row?.term || '').trim().toLowerCase();
    const level = String(row?.level || '').trim();
    if (term && LEVEL_RANK[level]) levelOf.set(term, level);
  }

  const out = new Map();
  const add = (rawTerm, count) => {
    const term = String(rawTerm || '').trim();
    if (!term) return;
    const key = term.toLowerCase();
    const level = levelOf.get(key) || DEFAULT_LEVEL;
    const prev = out.get(key);
    if (!prev) out.set(key, { term, level, count });
    else out.set(key, { ...prev, count: Math.max(prev.count, count) });
  };

  for (const t of jdTerms || []) add(t.term, t.count || 0);
  for (const t of modelTerms || []) add(t, 0);
  return [...out.values()];
}

function matchRequirement(name, text) {
  const { terms, phrase } = requirementTerms(name);
  if (!terms.length) return { strength: 'MISSING', mentions: 0, terms: [] };

  const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (phrase.length > 3 && text.includes(phrase)) {
    const mentions = (text.match(new RegExp(escaped(phrase), 'g')) || []).length;
    return { strength: 'STRONG', mentions, terms };
  }

  const textStems = new Set(tokenize(text).map(stemToken));
  let hits = 0, mentions = 0;
  for (const t of terms) {
    const re = new RegExp(`(^|[^a-z0-9])${escaped(t)}([^a-z0-9]|$)`, 'g');
    const found = (text.match(re) || []).length;
    if (found) { hits++; mentions += found; }
    else if (textStems.has(stemToken(t))) { hits++; mentions += 1; }
  }
  const coverage = hits / terms.length;
  const strength = coverage >= 0.65 ? 'STRONG' : coverage >= 0.34 ? 'WEAK' : 'MISSING';
  return { strength, mentions, terms };
}

// Shared ATS ruleset injected into every resume-generating prompt.
const ATS_RULES = `ATS COMPLIANCE - non-negotiable structural rules
- Use standard, recognizable section headings only: PROFESSIONAL SUMMARY, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE, EDUCATION, CERTIFICATIONS. Never invent creative heading names.
- Start every bullet with a strong past-tense action verb. Never open with "Responsible for", "Worked on", "Helped", "Assisted with", "Involved in", or "Tasked with".
- No first-person pronouns anywhere (I, my, we, our).
- Spell out an acronym on first use with the short form in parentheses, then use the short form after, e.g. "Continuous Integration/Continuous Deployment (CI/CD)". ATS parsers match on both forms, so both must appear at least once.
- Keep every date range in the same format across the whole resume: "Mon YYYY - Mon YYYY", using "Present" for current roles.
- Plain text only: no tables, columns, graphics, text boxes, symbols, or decorative characters. No markdown bold, italics, or asterisks.
- Quantify at least half of all experience bullets with a real number: scale, volume, users, revenue, team size, percentage, or timeline. Only use figures the source material genuinely supports, never invented ones.
- Banned filler: "synergy", "team player", "results-driven", "go-getter", "self-starter", "detail-oriented", "proven track record". State the specific accomplishment instead.
- Every skill listed in the Skills section must also be demonstrated somewhere in an experience bullet or the summary, not just listed in isolation.`;

// ATS_RULES covers machine parsing. This covers the two human layers an ATS
// score can't detect: the recruiter's 15-second scan and the hiring manager's
// read for real ownership. Injected into both resume generators.
const CRAFT_RULES = `RESUME CRAFT - how the content itself must be built

NEVER MIRROR THE JOB DESCRIPTION
A JD responsibility flipped into past tense is a failure, not a tailored bullet ("Lead complex cross-functional programs and manage dependencies" becoming "Led complex cross-functional programs and managed dependencies"). For each requirement: identify the underlying competency, find the candidate's real project that demonstrates it, write the bullet around that project, and let the JD's term land naturally inside it. The finished resume must never read as the posting reflected back, because that is exactly what an experienced reader recognizes as artificial tailoring.

ORGANIZE BULLETS AROUND PROJECTS, NOT KEYWORDS
Never write one bullet per keyword - no separate SQL bullet, Power BI bullet, Jira bullet, risk-management bullet. Before writing any role, identify that employer's real initiatives (2-4 of them: the transformations, launches, migrations, platforms, or problems owned), then build the bullets around those initiatives so tools and terminology appear inside a story. One bullet can carry five keywords credibly: "Built automated executive reporting in SQL and Power BI consolidating schedule, financial, risk, and operational data across 8 workstreams, cutting weekly preparation 40%." Keyword coverage is still required, but coverage means the term appears in credible context somewhere, never that it earns its own line.

ONE PRIMARY PROFESSIONAL IDENTITY
The resume must answer "what is this candidate?" in a single phrase, and every other capability must reinforce that identity rather than compete with it. Never position one person simultaneously as Program Manager + Product Manager + Business Analyst + Data Analyst + Architect + Developer unless the career genuinely supports that breadth.

SUMMARY, AND EXPERIENCE THAT PROVES IT
The summary is not keyword storage. Write 3-4 sentences, roughly 60-100 words, answering: WHO (identity and experience level), WHERE (primary industries and domains), WHAT (the kinds of programs, products, or problems handled), HOW (the most valuable strengths), VALUE (what differentiates this candidate). Never write a comma chain of competencies ("program management, project management, stakeholder management, solution design, workflow automation, analytics reporting") - that reads as ATS manipulation. Every claim the summary makes must have a bullet proving it: claim budget ownership and a bullet must show a budget; claim analytics depth and a bullet must show real analysis. Never make a claim just because the JD asks for it.

BULLET SHAPE
Strong bullets carry ownership + context or problem + action + scale or complexity + outcome. Not every bullet needs all five, but each role as a whole must demonstrate them. After reading a role, a reader must be able to answer: what did they own; how big was it; what was complex about it; what did this person personally do; who did they work with; what changed as a result. If several of those are unanswerable, rewrite the role.
- Write results, not duties. "Responsible for managing project risks" is a duty. "Identified a vendor integration risk six weeks before launch and drove a phased rollout that protected the committed production date" is an accomplishment. Always prefer the second.
- Cut generic bullets that could belong to thousands of candidates ("Managed risks and dependencies", "Worked with cross-functional stakeholders", "Managed multiple projects", "Used Jira to track projects"). Name the specific risk, the dependency, the project, the number of teams, the decision, the outcome.
- Tools support accomplishments and never stand alone. Not "Experience with SQL" but what was queried, validated, or uncovered with it. Not "Used Jira for project management" but what the tracking actually changed.
- Drop low-value content: maintained documentation, attended meetings, updated Jira or SharePoint, prepared status reports, scheduled meetings, took notes - unless the activity was part of a larger meaningful accomplishment.

DEPTH ALLOCATION AND CAREER PROGRESSION
Space follows relevance and recency: current role 6-8 strong bullets, previous relevant role 5-7, older roles 3-5. Never give every position the same count. Early roles must not read like recent ones. Show the arc: analysis, requirements, and execution support early; project ownership, cross-functional leadership, and budget or risk responsibility mid-career; multiple workstreams, strategic scope, executive stakeholders, vendors, and business outcomes now. The reader should understand why this person moved from one role to the next.

EACH EMPLOYER GETS A DISTINCT STORY
Do not repeat the same capability set at every company. Give each employer its own center of gravity - for example data-platform transformation and analytics at one, enterprise program leadership and integrations at another, product modernization and operational scale at a third. Repeating the same story everywhere makes a career look invented.

BULLET ORDER WITHIN EACH ROLE
Order by importance, not chronology: largest ownership and scope first, then the most important project or program, then the strongest measurable accomplishment, then technical or functional complexity, cross-functional leadership, process and automation improvement, and governance, budget, or risk last. Never open a senior role with a low-value administrative responsibility.

SOUND HUMAN
Specificity sounds human; elevated vocabulary sounds generated. Use these sparingly if at all: leveraged, spearheaded, orchestrated, utilized, dynamic, strategic initiatives, transformative, cutting-edge, innovative solutions, seamless, robust, comprehensive, data-driven, holistic. Prefer "Implemented an automated ticket-classification workflow that reduced manual triage" over "Leveraged robust AI-enabled solutions to drive transformative operational efficiencies." Match the verb to the real contribution - never upgrade work the candidate only supported into "spearheaded" or "owned".

SKILLS SECTION
Group skills into logical, scannable categories that match the profession and the JD's stack. Never put full sentences in a skills section, and never emit one flat undifferentiated list.

QUANTIFY HONESTLY
Prefer defensible numbers: budget, workstreams, team size, stakeholders, vendors, applications, locations, users, releases, percent milestone adherence, weeks of schedule recovered, percent manual effort removed, hours saved per month, cost saved or avoided, percent defect or incident reduction, SLA improvement, zero critical incidents. If a figure is genuinely unknown, write the accomplishment credibly without a number rather than inventing one.

INTERVIEW DEFENSIBILITY - the final gate
For every bullet ask: could this candidate speak to it for three to five minutes covering the situation, the problem, their responsibility, the people involved, the actions and decisions they made, the obstacles, the technology or process, and the result? If not, rewrite or cut it. High keyword coverage with low credibility is a failed resume.

The resume must not say "I match your job description." It must show the real problems this person owned, the scale they worked at, the decisions they made, and the results they produced, which then happen to align with what this JD needs.`;


// Global billing config, admin-controlled. Read fresh on every tailor call
// (one small Firestore read) rather than cached in memory, so a toggle
// flip by the admin takes effect immediately for every user without
// needing a redeploy or waiting out an in-memory cache TTL.
const BILLING_SETTINGS_REF = () => db.collection('settings').doc('billing');
async function getBillingSettings() {
  const snap = await BILLING_SETTINGS_REF().get();
  const data = snap.exists ? snap.data() : {};
  return {
    tailoringFree: !!data.tailoringFree,
    creditCostPerTailor: Number.isInteger(data.creditCostPerTailor) ? data.creditCostPerTailor : 1
  };
}

// Content-addressed dedup key — identical (jdText, resumeText, and every
// option that affects the output) within the cache window returns the
// prior result directly: no credit spent, no Anthropic call made. This is
// a real win for accidental double-submits (double-click before a button
// disables, a flaky network causing a client-side retry) — it does very
// little for genuinely distinct JD/resume pairs, which is most traffic, so
// don't expect this to move average latency much.
function hashTailorRequest(payload) {
  const key = JSON.stringify({
    jdText: payload.jdText, resumeText: payload.resumeText, prompts: payload.prompts,
    atsTarget: payload.atsTarget, mode: payload.mode, intensity: payload.intensity,
    aggressiveness: payload.aggressiveness, keywordDensity: payload.keywordDensity,
    bulletLength: payload.bulletLength, lockedSections: payload.lockedSections
  });
  return crypto.createHash('sha256').update(key).digest('hex');
}
const TAILOR_CACHE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Atomically decrements 1 credit, refusing if the balance is already 0.
// This is the ONLY place credits are ever spent — enforced server-side so
// it can't be bypassed by calling this function directly with dev tools.
async function spendCreditOrThrow(uid, cost) {
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const credits = snap.exists ? (snap.data().credits ?? 0) : 0;
    if (credits < cost) throw new HttpsError('resource-exhausted', 'Out of credits.');
    tx.set(ref, { credits: credits - cost }, { merge: true });
    return credits - cost;
  });
}

async function refundCredit(uid, cost) {
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const credits = snap.exists ? (snap.data().credits ?? 0) : 0;
    tx.set(ref, { credits: credits + cost }, { merge: true });
    return credits + cost;
  });
}

exports.claudeProxy = onCall({ secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 180, minInstances: 1 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { task, payload } = request.data || {};
  const apiKey = ANTHROPIC_API_KEY.value();

  if (task === 'tailor') {
    // Dedup check FIRST, before any credit is spent — an identical request
    // within the window (double-click, client retry after a flaky
    // network) returns the prior result directly. This does not call
    // Anthropic and does not touch the credit balance at all.
    const cacheKey = hashTailorRequest(payload || {});
    const cacheRef = db.collection('users').doc(uid).collection('tailorCache').doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const cached = cacheSnap.data();
      const age = Date.now() - (cached.createdAtMs || 0);
      if (age < TAILOR_CACHE_WINDOW_MS) {
        console.log(JSON.stringify({ tag: 'tailor_cache_hit', uid, cacheKey, ageMs: age }));
        return { json: cached.result, creditsRemaining: cached.creditsRemainingAtTime, cached: true };
      }
    }

    const billingSettings = await getBillingSettings();
    const cost = billingSettings.tailoringFree ? 0 : billingSettings.creditCostPerTailor;
    const remainingAfterSpend = cost > 0 ? await spendCreditOrThrow(uid, cost) : (await db.collection('users').doc(uid).get()).data()?.credits ?? 0;
    try {
      const { jdText, resumeText, prompts, atsTarget, mode, intensity, aggressiveness, keywordDensity, bulletLength, lockedSections, allowRetry, experimentalFastModel, jdIntel } = payload;
      const preset = INTENSITY_PRESETS[intensity] || null;
      const effectiveAggressiveness = preset?.aggressiveness || aggressiveness;
      const effectiveKeywordDensity = preset?.keywordDensity || keywordDensity;
      const effectiveBulletLength = preset?.bulletLength || bulletLength;
      const promptList = (prompts && prompts.length) ? prompts.map(p => `- ${p}`).join('\n') : '- (none specified)';
      const MIN_ACCEPTABLE_ATS = 85;
      const effectiveTarget = Math.max(atsTarget || 92, MIN_ACCEPTABLE_ATS);
      // Independent of anything the model reports, so the coverage audit has a
      // fixed target the model cannot influence.
      const jdTerms = extractJdTerms(jdText);
      // Source bullets for rewrite verification. The original arrives as plain
      // text, so bullet-ish lines are recovered by shape rather than structure.
      const originalBullets = String(resumeText || '')
        .split(/\r?\n/)
        .map(l => l.replace(/^[\s\u2022\-*\u00b7\u25cf\u25aa\u2013\u2014]+/, '').trim())
        .filter(l => l.length >= 40 && /[a-z]/i.test(l));

      // Optional analysis from the jdBreakdown call the client already makes.
      // Absent on failure, in which case ranking falls back to frequency only.
      const intel = jdIntel && typeof jdIntel === 'object' ? jdIntel : {};
      const domainGeneric = (intel.domainGeneric || []).filter(Boolean).slice(0, 6);
      const domainSpecific = (intel.domainSpecific || []).filter(Boolean).slice(0, 8);

      const requirementCategories = [
        ['Role / domain', [intel.roleTitle, intel.domain].filter(Boolean).join(' · ')],
        ['Core responsibilities', (intel.responsibilities || []).slice(0, 8).join('; ')],
        ['Technical', Object.entries(intel.techCategories || {}).map(([k, v]) => `${k}: ${(v || []).join(', ')}`).filter(s => !/:\s*$/.test(s)).join(' | ')],
        ['Leadership / stakeholders', (intel.leadership || []).slice(0, 5).join('; ')],
        ['Tools and qualifications', [...(intel.requiredSkills || []), ...(intel.preferredSkills || [])].slice(0, 14).join(', ')],
      ].filter(([, v]) => v && String(v).trim());

      const styleLines = [
        TAILOR_MODES[mode],
        AGGRESSIVENESS[effectiveAggressiveness],
        KEYWORD_DENSITY[effectiveKeywordDensity],
        BULLET_LENGTH[effectiveBulletLength]
      ].filter(Boolean);

      const lockInstruction = (lockedSections && lockedSections.length)
        ? `\nDo NOT rewrite these sections — reproduce their content from the original resume as close to verbatim as possible, only reformatting into the required JSON shape: ${lockedSections.join(', ')}.\n`
        : '';

      // Static instructions + schema — byte-identical on every single call,
      // for every user. Marked as a cache breakpoint so Anthropic can reuse
      // the already-processed prefix instead of reprocessing it each time.
      //
      // Trimmed vs. earlier versions: removed repeated leadership/ownership/
      // architecture enumerations, collapsed a ~15-example role-similarity
      // table to 3 tiers, replaced a 35/35/20/10 weighting with a simple
      // priority list, folded the evidence/role-fit bullet lists into
      // compact inline prose, and merged the 5-step internal audit down to
      // 3 steps — all in service of first-pass success (fewer retries) and
      // fewer input tokens per call, which are the real latency levers.
      // Added back a REWRITE DEPTH section: real usage showed the model
      // defaulting to shallow keyword swaps instead of rebuilding summary,
      // categorized skills, and bullets around the JD's stack/domain.
      // The opening is an explicit ordered method rather than a description of
      // intent: evidence is extracted before anything is written, bullets are
      // rebuilt from that evidence using fixed sentence architectures, and
      // keywords are placed last against evidence that already exists. Earlier
      // versions stated the goal but let the model start from the original
      // sentence, which is what produced keyword-swapped originals.
      const system = [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You are rebuilding resumes against specific job descriptions. Work through these stages in order. Stages 1-3 are internal reasoning: never print them, and never let the original sentence be your starting point for writing.

STAGE 1 — CLASSIFY THE REQUIREMENTS
Sort what this JD asks for into: Role/Domain, Core Responsibilities, Technical, Metrics, Leadership/Stakeholders, Tools, Qualifications. The user message may supply a pre-computed version of this; where it does, use it rather than re-deriving it.

STAGE 2 — MAP EVIDENCE, BEFORE WRITING ANYTHING
For every bullet in the ORIGINAL resume, extract these five facts and nothing else:
- WHAT: the actual initiative, capability, platform or system involved, named specifically. Not an abstraction like "enterprise banking technology program".
- WHY: the problem, gap, risk or pressure that made the work necessary. This is the field most resumes omit, and its absence is why bullets read as duty lists instead of accomplishments. If neither the bullet nor the rest of the resume evidences a reason, leave WHY empty — never invent a business justification that was not stated.
- HOW: what this person personally did, as connected actions, not a comma-separated list of activities.
- SCALE: complexity already evidenced — team or workstream counts, budget, applications, releases, users, dependencies, environments, business units, vendors, regions.
- RESULT: what measurably changed, using only outcomes the resume states or clearly implies. Never invent a number.
Then classify each against the JD: DIRECT (explicitly demonstrated), TRANSFERABLE (different technology or domain, genuinely equivalent capability), SUPPORTING (strengthens credibility without satisfying a requirement), UNSUPPORTED (no evidence anywhere).
Many bullets will yield only three or four of the five. That is correct and expected — an empty field means the evidence is not there, and the answer is to leave it out, never to fill the gap with something plausible. The facts you extract here are the ONLY raw material the rewrite may use.

STAGE 3 — RECONSTRUCT EACH BULLET FROM THE EVIDENCE
Do not edit the original sentence. Build a new one from the Stage 2 facts.

MASTER RULE: Never construct experience bullets by inserting missing JD keywords into existing sentences. First extract the candidate's underlying project, problem, ownership, actions, technical context, scale, and result. Rebuild the bullet from that evidence. Every bullet should communicate one primary accomplishment and preferably follow Problem/Objective, Action, Technical or Program Mechanism, Scale, Result. Keywords should appear only where naturally supported by the accomplishment. Avoid responsibility-only statements, keyword chains, vague phrases such as "enterprise initiatives", and unsupported metrics. The reader should be able to understand what was being built or improved, why it mattered, what the candidate personally did, and what changed as a result.

The constructions below are reference shapes organised by what the bullet is about, offered as illustration. Choose, adapt or blend them as the evidence calls for. Do NOT force every bullet into one fixed mould, and do NOT work through them as a checklist:
- Program leadership: initiative, scope, execution, outcome
- Technical problem: problem, analysis, decision, result
- CI/CD: existing bottleneck, engineering change, measurement, improvement
- Risk: critical risk, potential impact, mitigation, outcome
- Automation: manual process, automation, scale, time or toil reduction
- Adoption: capability, adoption barrier, strategy, usage outcome
- Metrics: question, metric, insight, decision, result
- Incident: production issue, investigation, coordination, remediation, reliability result
- Stakeholder conflict: competing priorities, analysis, influence, decision, delivery result
- AI-assisted work: workflow, AI application, human validation, security controls, efficiency outcome

Non-negotiable, in priority order:
1. Content traces back to Stage 2 evidence. The original sentence is never just edited with a keyword swapped in.
2. ONE primary accomplishment per bullet. A bullet must not be built to prove five or six JD concepts at once — CI/CD plus Agile plus DORA plus AI plus stakeholder management in one sentence is the clearest tell of a JD-converted resume. Other keywords belong on a different bullet whose evidence actually fits them.
3. No keyword chains. "Managed roadmap, risks, dependencies and stakeholders" is a violation even with no keyword inserted, because it is a checklist rather than a story. Rebuild as connected cause and effect.
4. No vague abstractions — "enterprise initiatives", "complex technology program", "various stakeholders" — when the evidence supports naming the actual platform, capability or problem. Vagueness is a defect, not a style choice.
Let the evidence pick the sentence, not the list. Vary openings and rhythm across a role the way a person writing about their own work naturally would.

STAGE 4 — PLACE KEYWORDS LAST, AND ONLY WHERE EVIDENCE ALREADY FITS
Only once bullets are rebuilt, check which required keywords are still missing and whether any can be stated honestly given what each bullet now says. A keyword goes on a bullet whose evidence supports it, or on a different bullet that does, or nowhere at all. Never force a term into a bullet whose evidence does not support it, and never add a bullet whose purpose is to host a keyword.

STAGE 5 — DISTRIBUTE ACROSS EMPLOYERS BY STRONGEST EVIDENCE
Requirement categories belong to the employers that best evidence them: one role may carry the technical and delivery terminology, another the governance and stakeholder terminology. The same keyword cluster repeating in every role is a failure — it reads as templated and tells a recruiter nothing about progression.

STAGE 6 — QUANTIFY, THEN CHECK CREDIBILITY
Surface scale and outcome figures that the original resume already supports; never invent one. Then re-read as a hiring manager: could the candidate defend every bullet for three to five minutes? Cut or rewrite anything they could not.

WORDING INTENSITY — the user message carries a level (conservative / balanced / complete). It controls Stage 3's sentence-level phrasing only. It never permits skipping Stages 2, 4 or 5, and never permits editing the original sentence in place instead of rebuilding it. Conservative means a lighter touch on phrasing, not a shallower rebuild: every requirement backed by DIRECT or TRANSFERABLE evidence still has to be worked in using the JD's terms, the Skills section still has to be categorized by JD domain, and the title-framing rule below still applies.

TRUTHFULNESS — the one hard constraint, overrides everything else below:
Never invent employers, dates, that aren't in the original resume. Reframing, reprioritizing, and honest equivalence between related skills are expected and encouraged.

REWRITE DEPTH — apply this to every section, this is the most common failure mode
- Summary: a new paragraph written for this JD's domain and seniority, not a lightly reworded version of the original's sentence structure.
- Skills/Technical Skills: group items into categories that mirror this JD's own domain and tech stack (rename/reorganize categories to fit — e.g. "Cloud & Infrastructure", "Data Pipelines", "Frontend" — whatever the JD's stack actually calls for), and populate each with the candidate's DIRECT tools plus genuinely TRANSFERABLE/adjacent ones the JD calls for (e.g. resume shows MySQL, JD wants PostgreSQL — listing PostgreSQL as an adjacent/transferable skill is fair; a tool with zero relationship to anything on the original resume is not).
- Experience bullets: rebuild the full sentence around the JD's tech stack and domain terms wherever a TRANSFERABLE swap applies — keep the bullet's underlying project synopsis (what was built, its scale/scope, the measurable outcome) identical, expressed through the target stack's vocabulary instead of leaving old tool names sitting inside an otherwise-unchanged sentence. This always applies, not just when the candidate's own prompts ask for it: favor a STAR shape (situation/task → action → result) wherever the underlying evidence supports it, lead with or end on a concrete metric whenever the original resume or a truthful, non-fabricated estimate supports one, and never use generic filler like "synergy," "team player," "results-driven," "go-getter," or similar buzzwords — say the specific thing instead.
- Job titles: if the JD's own target function (e.g. "Technical Program Manager") differs from the literal title on record, lead the "title" field with the JD's target function and keep the real system/engineering title afterward in parentheses — e.g. "Technical Program Manager — Azure Front Door / EdgeActions (Software Engineer II)", not "Software Engineer II (Technical Program Lead)". A recruiter skimming just the leading words of each title must see the function this JD is hiring for, not a different one — never lead with a title that misrepresents which function is being targeted, and never drop the real title entirely.
- Non-technical target roles (e.g. Project Manager, Product Manager, Business Analyst): if the JD itself is non-technical, drop implementation-level tech from every bullet, the Skills section, and the entry "footer" — no programming languages, frameworks, or low-level architecture terms unless the JD explicitly asks for technical fluency. Replace with genuinely supported management/delivery tools and methodology (Jira, Confluence, Agile/Scrum, budgeting, roadmapping, stakeholder reporting, etc.) — omit the "footer" key entirely for an entry rather than fill it with irrelevant tech.

EVIDENCE CLASSIFICATION
For each JD requirement, classify what the original resume actually supports: DIRECT (explicitly demonstrated through real experience, projects, or responsibilities), TRANSFERABLE (a different exact technology or domain, but genuinely equivalent capability — honestly close, not identical), SUPPORTING (indirect evidence that strengthens credibility without directly satisfying the requirement), UNSUPPORTED (no evidence anywhere — never claim as done; omit, or at most note as a learning interest only if the candidate's prompts ask for that framing).

DOMAIN CONTEXT — two lists with different rules, never merged
The user message may include DOMAIN WAYS OF WORKING and DOMAIN-SPECIFIC CLAIMS. Neither is a coverage requirement and neither is something to reach for.
- DOMAIN WAYS OF WORKING are practices near-universal for this role type. You may use this phrasing as connective language on a bullet whose evidence already shows the underlying work, to name it the way this industry names it. Never write a bullet that exists only to state one, and never use one that contradicts the candidate's actual background.
- DOMAIN-SPECIFIC CLAIMS are named frameworks, certifications, compliance regimes and regulations that this domain commonly expects but this posting did not state. Treat them as recognition aids only. You may use one ONLY where the original resume independently evidences it — if the candidate demonstrably worked under that regime or held that credential, name it correctly. If the original resume does not evidence it, it must not appear anywhere in your output, in any section, in any form. Domain typicality is not evidence. A draft that names one of these without support is rejected outright, and this outranks every coverage and score target.

ROLE FIT (0-100, estimate internally): 80-100 same or closely related discipline — rewrite aggressively, reorder freely; 60-79 adjacent discipline — moderate rewrite, lead with transferable strengths; below 60 meaningfully different discipline — "conservative" here means never fabricate formal experience, titles, or credentials in the new domain that the resume doesn't support, NOT leaving the rewrite shallow: still fully rebuild the summary, skills, and every bullet, dropping implementation-level detail (specific code, architecture, low-level technical tasks) entirely and re-expressing the same underlying work through whatever genuinely transferable angle exists (e.g. software engineer to project manager: no coding or application-development framing anywhere in the output — lead every bullet with delivery ownership, cross-team coordination, timeline/scope/risk management, and stakeholder communication, built only from what the original bullet actually demonstrates). If the target role differs from the resume's actual background, shift EMPHASIS, not facts (e.g. engineer to TPM means less code-level detail and more delivery/planning/stakeholder framing, built entirely from DIRECT and TRANSFERABLE evidence already present) — this includes leading each job title with the JD's target function per the REWRITE DEPTH rule above, not just the bullet content.

KEYWORD COVERAGE — hard requirement, not a stylistic suggestion
Every JD requirement backed by DIRECT or TRANSFERABLE evidence must appear using the JD's own wording, at least once, somewhere in the resume — don't omit a supported keyword for style reasons. Placement priority: Summary and most recent role first, then Technical Skills, then earlier roles.

BULLET JUSTIFICATION — every experience bullet, no exceptions
Each bullet must earn its place against this JD, but a bullet is justified by covering a real requirement through the candidate's own project, not by hosting a keyword. Build bullets around the role's actual initiatives (see RESUME CRAFT below) and let one bullet carry several related requirements at once. For every bullet: lead with the action using the JD's own terminology for the technology/domain/responsibility, state the scope or scale where the source supports it, and close on a concrete outcome. If a bullet cannot be tied to anything the JD asks for, cut it and write a stronger one from the same role's real evidence instead. Order bullets inside each role so the ones covering Critical/High requirements come first. Do not reuse the same leading verb more than twice across the whole resume.

PUNCTUATION — hard rule
Never use em dashes or en dashes anywhere in the resume output. Use commas, colons, or separate sentences instead. For date ranges use a plain hyphen, e.g. "Jan 2020 - Mar 2023".

${ATS_RULES}

${CRAFT_RULES}

PRIORITY ORDER when tensions arise: truthfulness > evidence strength > required JD coverage > recruiter readability > style polish.

BEFORE RETURNING — internal audit, do not print any of this reasoning, only the final output
1. List the JD's most important requirements with your evidence classification for each, and confirm every DIRECT/TRANSFERABLE requirement actually appears in your draft's exact wording — add any that are missing.
2. Check every changed bullet, the Skills section, and every job title against REWRITE DEPTH above — flag and rewrite any bullet that's just the original sentence with a keyword swapped in, any Skills list that's a flat uncategorized dump, and any title that still leads with a different function than what this JD is hiring for. Cut bullets that don't earn their place, merge redundant ones, then re-read only the summary and most recent role: could a recruiter identify the target role, seniority, and 2-3 core strengths in 10 seconds? If not, revise those two sections before moving on.
3. Walk the ATS COMPLIANCE list above item by item against your draft and fix every violation: weak bullet openers, pronouns, unexpanded acronyms, inconsistent date formats, banned filler, and bullets with no number where the source supports one.
4. Walk RESUME CRAFT above and fix what it catches: cut any bullet that is a JD responsibility flipped into past tense, any bullet that exists only to host a keyword, any generic bullet that could belong to anyone, and any low-value administrative line. Confirm the resume states one primary identity, that bullet counts taper by recency (current role deepest), that each employer tells a distinct story, that the career visibly progresses, and that every claim in the summary has a bullet proving it.
5. Score the draft 1-10 on ATS relevance (target 9), recruiter readability (9), hiring manager credibility (9), specificity (8), quantification (8.5), career progression (8), natural human writing (9), and interview defensibility (10). Where a score falls short, revise that specific weakness and re-check. Never finalize a draft that scores high on keywords but reads as copied from the JD — rewrite it instead.
6. Only after this pass, assign the ATS score and breakdown honestly based on the resume you actually produced.

Respond in EXACTLY this format, nothing before or after — no markdown fences, no commentary:

ROLE_SIMILARITY: <integer 0-100>
ATS_SCORE: <integer 0-100, your honest estimate after the audit above>
REQUIRED_KEYWORDS: <a single JSON array on one line of the 12-25 most important literal terms THIS JD REQUIRES that the candidate's evidence genuinely supports, exactly as the JD words them, e.g. ["Kubernetes","CI/CD","distributed systems"]. Derive this list from the job description BEFORE you judge your own draft: it is the requirement list you were working to, not a description of what you managed to fit in. Your output is then audited against it, and anything missing is sent back to you to fix, so leaving a supported requirement off this list does not help you — it only hides a gap that the audit would otherwise have caught.>
ATS_BREAKDOWN: <a single JSON object, real JSON on one line, with these exact integer 0-100 fields: {"keywordMatch": 92, "formatting": 95, "experienceRelevance": 81, "actionVerbs": 94, "quantification": 72, "leadership": 90, "technicalDepth": 84, "industryMatch": 88, "seniority": 91}. Score each dimension honestly and independently — they should not all just mirror the overall score. "formatting" reflects structural ATS-friendliness of the output itself (plain sections, no tables) and should normally score high since this schema is inherently ATS-safe. "quantification" reflects how many bullets have concrete numbers/metrics — score this honestly low if the original resume didn't have many to work with, since you must not invent metrics that aren't there.>
===RESUME_JSON===
<a single JSON object with this exact shape — real JSON, not a string containing JSON:
{
  "name": "candidate full name",
  "contact": "phone | email | linkedin | location — pipe-separated, only fields present in the original",
  "highlights": ["short phrase or keyword 1", "short phrase or keyword 2"],
  "sections": [
    {
      "heading": "PROFESSIONAL SUMMARY",
      "paragraphs": ["one or more paragraph strings, no entries for this section type"]
    },
    {
      "heading": "TECHNICAL SKILLS",
      "paragraphs": ["Category Label: comma-separated items", "Another Category: comma-separated items"]
    },
    {
      "heading": "PROFESSIONAL EXPERIENCE",
      "entries": [
        {
          "title": "job title",
          "subtitle": "Company | Location",
          "dateRight": "Month Year - Month Year",
          "bullets": ["rewritten bullet 1", "rewritten bullet 2"],
          "footer": "optional Tools: ... line, omit key if not applicable"
        }
      ]
    },
    {
      "heading": "EDUCATION",
      "entries": [
        { "title": "Degree", "subtitle": "School", "dateRight": "Year", "bullets": [] }
      ]
    },
    {
      "heading": "SKILLS",
      "paragraphs": ["comma-separated skills, only if not already covered by TECHNICAL SKILLS"]
    }
  ]
}
"highlights" = 4-10 short JD-derived keywords or phrases (exact substrings as they appear in the tailored text below, e.g. "distributed systems", "PostgreSQL") that this rewrite specifically wove in to match the JD — every entry must appear verbatim somewhere in the resume text you produce.
Include only the sections that make sense for this resume's actual content — don't invent sections. A section has either "paragraphs" or "entries", never both. Every string must be plain text, no markdown bold/asterisks.>`
      }];

      function parseTailorResponse(raw) {
        // Independent marker lookups instead of one long sequential regex —
        // a stray blank line or minor spacing shift from the model no
        // longer breaks the whole parse, since each piece is found on its
        // own rather than requiring exact adjacency between all four.
        const roleMatch = raw.match(/ROLE_SIMILARITY:\s*(\d{1,3})/i);
        const atsMatch = raw.match(/ATS_SCORE:\s*(\d{1,3})/i);
        const breakdownMatch = raw.match(/ATS_BREAKDOWN:\s*(\{[^\n]*\})/i);
        const keywordsMatch = raw.match(/REQUIRED_KEYWORDS:\s*(\[[^\n]*\])/i);
        const resumeIdx = raw.search(/===RESUME_JSON===/i);

        if (!atsMatch || resumeIdx === -1) {
          throw new Error('Could not parse tailoring response — the model did not follow the expected format.');
        }
        const roleSimilarity = roleMatch ? Math.max(0, Math.min(100, parseInt(roleMatch[1], 10))) : 70;
        const score = Math.max(0, Math.min(100, parseInt(atsMatch[1], 10)));
        let breakdown = null;
        if (breakdownMatch) { try { breakdown = JSON.parse(breakdownMatch[1]); } catch (e) { /* optional */ } }
        let requiredKeywords = [];
        if (keywordsMatch) { try { requiredKeywords = JSON.parse(keywordsMatch[1]); } catch (e) { /* optional */ } }

        const resumeRaw = raw.slice(resumeIdx).replace(/===RESUME_JSON===/i, '').trim();
        let parsedResume;
        try {
          parsedResume = JSON.parse(stripJsonFence(resumeRaw));
        } catch (e) {
          throw new Error('Tailored resume JSON was malformed — please try again.');
        }
        if (!parsedResume || !parsedResume.name || !Array.isArray(parsedResume.sections)) {
          throw new Error('Tailored resume came back with an unexpected shape — please try again.');
        }
        const resume = sanitizeResumeContent(parsedResume);
        // Graded against the union of what the JD itself repeats and what the
        // model said it required. The server-derived half is the part the
        // model cannot quietly shrink to flatter its own score; the semantic
        // pass supplies how essential each term is. domainSpecific is NOT a
        // coverage target — it is passed only so fabrications get caught.
        const audit = auditAts(
          resume,
          mergeRequiredTerms(jdTerms, requiredKeywords, intel.keywordImportance),
          originalBullets,
          domainSpecific
        );
        const reconciled = reconcileAtsScore(score, audit);
        if (breakdown && audit.keywordCoverage != null) {
          breakdown.keywordMatch = audit.keywordCoverage;
          breakdown.quantification = Math.min(100, Math.round((audit.quantificationRatio / ATS_TARGET_QUANT_RATIO) * 100));
        }
        return { resume, atsScore: reconciled, modelScore: score, roleSimilarity, breakdown, audit };
      }

      async function runPass(userContent, timeoutMs, logTag, model) {
        const raw = await callAnthropic(apiKey, userContent, { model: model || MODEL_QUALITY, maxTokens: 8000, system, timeoutMs, logTag });
        return parseTailorResponse(raw);
      }

      const baseUserContent = `Standing instructions from the candidate:
${promptList}
${styleLines.length ? '\nStyle directives for this rewrite:\n' + styleLines.map(l => `- ${l}`).join('\n') + '\n' : ''}${lockInstruction}
Target ATS score: at least ${effectiveTarget}/100 — run the internal audit from your instructions before estimating this, don't skip it.
${requirementCategories.length ? `\nJD REQUIREMENTS, PRE-CLASSIFIED (Stage 1 — use this instead of re-deriving it):\n${requirementCategories.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n` : ''}${domainGeneric.length ? `\nDOMAIN WAYS OF WORKING — optional phrasing, never a coverage target:\n${domainGeneric.join(', ')}\nUse this vocabulary only on bullets whose evidence already shows the work. Never add a bullet to host one.\n` : ''}${domainSpecific.length ? `\nDOMAIN-SPECIFIC CLAIMS — recognition aids, NOT permission:\n${domainSpecific.join(', ')}\nThese are conventional for this domain but absent from this posting. Use one ONLY if the ORIGINAL RESUME below independently evidences it. If it does not, the term must not appear anywhere in your output. Domain typicality is not evidence.\n` : ''}
JOB DESCRIPTION:
${jdText}

ORIGINAL RESUME:
${resumeText}`;

      // experimentalFastModel is opt-in only (never the default) — Haiku is
      // meaningfully weaker at the evidence-classification reasoning this
      // prompt depends on, so this exists for explicit A/B measurement via
      // logTag, not as a quality-blind speed toggle.
      const pass1Model = experimentalFastModel ? MODEL_FAST : MODEL_QUALITY;
      let best = await runPass(baseUserContent, 90000, experimentalFastModel ? 'tailor_pass1_haiku_experiment' : 'tailor_pass1', pass1Model);

      // Only retry when the role is close enough that a genuinely better
      // result is plausible — a fundamentally mismatched role won't be
      // fixed by asking harder, and burning a second full call on it is
      // pure waste (worse latency, no realistic upside). Runs by default;
      // the client's "Advanced" toggle passes allowRetry: false to opt out
      // for lower worst-case latency at the cost of the ATS-floor safety net.
      // The retry is now driven by what was actually measured in the draft,
      // not just the model's own score — it gets the exact missing keywords
      // and hygiene violations to fix rather than a vague "try harder".
      const needsRepair = (r) => {
        // Fabricated domain claims and un-rewritten bullets are hard gates:
        // the draft failed the two things this pipeline exists to guarantee,
        // whatever the score says.
        if (r.audit.fabricatedClaims.length > 0) return true;
        if (r.audit.shallowInsertBullets.length > 0) return true;
        if (r.atsScore < MIN_ACCEPTABLE_ATS) return true;
        if (r.audit.keywordCoverage != null && r.audit.keywordCoverage < ATS_MIN_KEYWORD_COVERAGE) return true;
        if (r.audit.totalBullets && r.audit.quantificationRatio < ATS_TARGET_QUANT_RATIO) return true;
        if (r.audit.keywordChainBullets.length > 0 || r.audit.vaguePhraseBullets.length > 0) return true;
        return r.audit.weakOpenerBullets.length > 0 || r.audit.pronounBullets.length > 0 || r.audit.buzzwordBullets.length > 0;
      };

      // Correctness problems — fabrications, missing terms, un-rewritten
      // bullets, hygiene — are fixable at any role distance, so they are not
      // gated. Only a bare low score is, because reframing harder into a role
      // the resume has no basis for is what the gate exists to prevent.
      const hasCorrectnessIssue = (r) =>
        r.audit.fabricatedClaims.length > 0 ||
        r.audit.shallowInsertBullets.length > 0 ||
        r.audit.missingKeywords.length > 0 ||
        r.audit.weakOpenerBullets.length > 0 ||
        r.audit.pronounBullets.length > 0 ||
        r.audit.buzzwordBullets.length > 0 ||
        r.audit.keywordChainBullets.length > 0 ||
        r.audit.vaguePhraseBullets.length > 0 ||
        (r.audit.totalBullets > 0 && r.audit.quantificationRatio < ATS_TARGET_QUANT_RATIO);

      const repairIsWorthIt = (r) => hasCorrectnessIssue(r) || r.roleSimilarity >= 60;

      // Two passes rather than one: the first repair usually clears hygiene
      // and the obvious gaps, and a second is what actually closes the long
      // tail of JD terms. Matches the build-from-scratch flow, which loops
      // until coverage converges instead of stopping after one attempt.
      const MAX_REPAIRS = 2;
      for (let attempt = 0; allowRetry !== false && attempt < MAX_REPAIRS; attempt++) {
        if (!needsRepair(best) || !repairIsWorthIt(best)) break;
        const repairList = atsRepairInstruction(best.audit);
        if (!repairList && best.atsScore >= effectiveTarget) break;
        const retryUserContent = `${baseUserContent}

Your previous attempt was audited mechanically against the resume text you produced. Estimated score ${best.modelScore}/100, measured ${best.atsScore}/100 against a ${effectiveTarget} target${best.audit.keywordCoverage != null ? `, keyword coverage ${best.audit.keywordCoverage}%` : ''}. Produce a corrected version that fixes every item below while keeping everything already working:
${repairList || 'Raise overall JD alignment and keyword coverage.'}

Cut lower-value bullets to make room if needed. Do not fabricate anything not already grounded in the original resume — the truthfulness constraint still applies without exception.`;
        try {
          const retry = await runPass(retryUserContent, 60000, `tailor_retry_${attempt + 1}`);
          if (retry.atsScore <= best.atsScore) break; // no progress, stop spending calls
          best = retry;
        } catch (e) {
          console.error('ATS retry pass failed or timed out, keeping current draft:', e.message);
          break;
        }
      }

      console.log(JSON.stringify({
        tag: 'tailor_ats_audit', uid,
        modelScore: best.modelScore, finalScore: best.atsScore, roleSimilarity: best.roleSimilarity,
        keywordCoverage: best.audit.keywordCoverage, missingCount: best.audit.missingKeywords.length,
        missingMustHave: (best.audit.missingRanked || []).filter(m => m.level === 'must-have').map(m => m.term),
        shallowInserts: best.audit.shallowInsertBullets.length,
        fabricatedClaims: best.audit.fabricatedClaims,
        quantifiedBullets: best.audit.quantifiedBullets, totalBullets: best.audit.totalBullets,
        weakOpeners: best.audit.weakOpenerBullets.length, pronouns: best.audit.pronounBullets.length,
      }));

      const resultJson = {
        resume: best.resume, atsScore: best.atsScore, metTarget: best.atsScore >= effectiveTarget, breakdown: best.breakdown,
        // Fix 9: graded against the resume actually produced, after any repair
        // pass, rather than getJdBreakdown's pre-rewrite verdict on the upload.
        matchMatrix: recomputeMatchMatrix(best.resume, intel.matchMatrix),
        atsAudit: {
          keywordCoverage: best.audit.keywordCoverage,
          missingKeywords: best.audit.missingKeywords,
          missingRanked: best.audit.missingRanked,
          shallowInserts: best.audit.shallowInsertBullets.length,
          fabricatedClaims: best.audit.fabricatedClaims,
          keywordChains: best.audit.keywordChainBullets.length,
          vaguePhrases: best.audit.vaguePhraseBullets.length,
          quantifiedBullets: best.audit.quantifiedBullets,
          totalBullets: best.audit.totalBullets,
        },
      };

      // Cache the successful result under this request's content hash so a
      // duplicate submission within the window is served without spending
      // another credit or calling Anthropic again.
      try {
        await cacheRef.set({ result: resultJson, creditsRemainingAtTime: remainingAfterSpend, createdAtMs: Date.now() });
      } catch (e) {
        console.error('Failed to write tailor cache (non-fatal):', e.message);
      }

      return { json: resultJson, creditsRemaining: remainingAfterSpend, cached: false };
    } catch (err) {
      console.error('tailor failed, refunding credit:', err);
      const restored = cost > 0 ? await refundCredit(uid, cost) : remainingAfterSpend;
      throw new HttpsError('internal', err.message || 'Tailoring failed.', { creditsRemaining: restored });
    }
  }

  try {
    if (task === 'analyze') {
      const { jdText, resumeText } = payload;
      const prompt = `Compare this job description with this resume. Return ONLY raw JSON, no markdown fences, in this exact shape:
{"matched": ["keyword1","keyword2"], "gaps": ["keyword3"], "summary": "one sentence summary", "atsScore": 72}
matched = requirements/skills from the JD that already appear in the resume (max 6).
gaps = important JD requirements missing from the resume (max 4).
atsScore = an integer 0-100 estimating how well an ATS keyword-matching system would score this resume against this JD as-is.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { logTag: 'analyze' });
      return { json: JSON.parse(stripJsonFence(raw)) };
    }

    if (task === 'email') {
      const { jdText, resumeText, company, contactName, senderName, style } = payload;
      const styleNote = {
        friendly: 'Warm, conversational tone — still professional, but approachable rather than formal.',
        startup: 'Casual, energetic, direct — like messaging a founder, not writing a formal cover letter.',
        faang: 'Polished, concise, confident — the tone typical of outreach to a large tech company recruiter.'
      }[style] || 'Standard professional tone — clear, respectful, businesslike.';
      const prompt = `Write a short job application email. Return ONLY raw JSON, no markdown fences: {"subject":"...", "body":"..."}
Recipient name: ${contactName}
Company: ${company}
Sender name: ${senderName}
Tone: ${styleNote}
Keep body under 120 words, reference 1-2 specific things from the resume that match the JD, end with the sender's name on its own line. Do not include a "Subject:" line inside body.

JOB DESCRIPTION:
${jdText}

TAILORED RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { logTag: 'email' });
      return { json: JSON.parse(stripJsonFence(raw)) };
    }

    if (task === 'blockFix') {
      const { blockText, instruction, jobDescription, tailoringLevel, context } = payload;
      if (!String(blockText || '').trim()) throw new HttpsError('invalid-argument', 'No block text supplied.');

      const level = ['conservative', 'balanced', 'aggressive'].includes(tailoringLevel) ? tailoringLevel : 'balanced';
      // Only the sibling bullets of this one entry are supplied. The whole
      // resume is deliberately withheld: unrelated context is what tempts the
      // model to borrow a fact from a different job and attach it here.
      const siblings = (context?.siblingBullets || []).filter(Boolean).slice(0, 8);
      const system = [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You rewrite a single resume block. You are not writing a new resume section and you are not seeing the whole document — only this one block, the job description, and the candidate's career profile facts.

Hard rules:
1. Never invent an employer, job title, date range, degree, certification, or number that is not present in the supplied facts. If the requested change requires a fact you don't have (for example "add a metric" but no metric exists for this achievement), insert a bracketed placeholder like [ADD %] or [ADD TEAM SIZE] instead of a fabricated value, and add a warning explaining what is missing.
2. Preserve the block's core claim. You may tighten, reorder, or emphasise different real facts to match the job description, but you may not change what the candidate actually did.
3. Match the requested tailoring level:
   - conservative: minimal wording changes, no new claims
   - balanced: reasonable rewording and reordering for fit
   - aggressive: may restructure the sentence significantly, but rules 1 and 2 still apply without exception
4. When the instruction asks to match JD keywords, only pull terms that are semantically true of the candidate's real experience — do not insert a keyword from the job description if it misrepresents what they did.
5. Output plain text only — no markdown, no bullet character, matching the formatting convention of the input block. Never use em dashes or en dashes; use commas or separate sentences.

Return JSON only, matching this shape:
{ "rewrittenText": string, "keywordsAdded": string[], "warnings": string[] }`
      }];

      const user = `TAILORING LEVEL: ${level}

INSTRUCTION: ${String(instruction || 'Improve this block for the target role.').slice(0, 400)}

BLOCK TO REWRITE (this exact text, already reflecting any earlier accepted edits):
${blockText}
${siblings.length ? `\nOTHER BULLETS UNDER THE SAME ROLE (context only — do not rewrite these, and do not duplicate their content):\n${siblings.map(s => `- ${s}`).join('\n')}` : ''}
${context?.entryTitle ? `\nTHIS BLOCK BELONGS TO: ${context.entryTitle}${context.entrySubtitle ? `, ${context.entrySubtitle}` : ''}` : ''}
${context?.section ? `SECTION: ${context.section}` : ''}

JOB DESCRIPTION:
${String(jobDescription || '').slice(0, 6000)}`;

      const { data, degraded, reason } = await callAnthropicJson(apiKey, user, {
        model: MODEL_QUALITY, maxTokens: 1200, system, logTag: 'blockFix',
      });
      if (!data) throw new HttpsError('internal', `Block rewrite failed (${reason}).`, { degraded, reason });

      const rewrittenText = stripFancyDashes(String(data.rewrittenText || '').trim());
      if (!rewrittenText) throw new HttpsError('internal', 'Block rewrite came back empty.');

      const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean).map(String) : [];
      // A placeholder must always be announced, even when the model forgets to
      // warn about it — the UI gates acceptance on this.
      if (/\[ADD[^\]]*\]/i.test(rewrittenText) && !warnings.length) {
        warnings.push('This rewrite contains a placeholder. Fill in the real value before accepting.');
      }
      return {
        json: {
          rewrittenText,
          keywordsAdded: Array.isArray(data.keywordsAdded) ? data.keywordsAdded.filter(Boolean).map(String).slice(0, 12) : [],
          warnings,
        },
      };
    }

    if (task === 'thankYouEmail') {
      const { company, contactName, senderName, roleTitle, notes } = payload;
      const prompt = `Write a short post-interview thank-you email. Return ONLY raw JSON, no markdown fences: {"subject":"...", "body":"..."}
Recipient name: ${contactName || 'the interviewer'}
Company: ${company}
Role: ${roleTitle || 'the role'}
Sender name: ${senderName}
${notes ? `Specific things to reference from the conversation: ${notes}` : 'No specific conversation notes provided — keep it warm but general.'}
Keep body under 100 words: thank them for their time, reaffirm genuine interest, optionally reference one specific discussion point if notes were given, end with the sender's name on its own line. Do not include a "Subject:" line inside body.`;
      const raw = await callAnthropic(apiKey, prompt, { logTag: 'thankYouEmail' });
      return { json: JSON.parse(stripJsonFence(raw)) };
    }

    if (task === 'coverLetter') {
      const { jdText, resumeText, company, roleTitle, senderName } = payload;
      const prompt = `Write a concise, genuine cover letter (not generic filler) for this candidate applying to this role. Return ONLY raw JSON, no markdown fences: {"body":"..."}
Company: ${company}
Role: ${roleTitle || '(infer from the JD)'}
Sender name: ${senderName}
3-4 short paragraphs, under 300 words total: why this role/company specifically (grounded in the JD, not generic), 1-2 concrete pieces of relevant experience from the resume, a confident close. No markdown, no letter salutation boilerplate beyond a simple "Dear Hiring Manager,"/sign-off. Stay grounded in what the resume actually supports — do not invent experience.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 900, logTag: 'coverLetter' });
      return { json: JSON.parse(stripJsonFence(raw)) };
    }

    if (task === 'jdBreakdown') {
      const { jdText, resumeText } = payload;
      const prompt = `Analyze this job description in detail, and compare it against the candidate's resume. Return ONLY raw JSON, no markdown fences, in this exact shape:
{
  "roleTitle": "Senior Data Engineer",
  "company": "Acme Bank",
  "requiredSkills": ["skill1", "skill2"],
  "preferredSkills": ["skill1"],
  "responsibilities": ["short responsibility phrase"],
  "leadership": ["leadership expectation, omit array entries if none implied"],
  "softSkills": ["communication", "ownership"],
  "techCategories": { "Cloud": ["AWS","Terraform"], "AI": [], "Security": [], "DevOps": [] },
  "matchMatrix": [ { "term": "Kafka", "status": "strong" }, { "term": "Snowflake", "status": "missing" } ],
  "missingKeywords": { "Programming": ["term"], "Cloud": ["term"], "Soft Skills": ["term"] },
  "keywordImportance": [ { "term": "kubernetes", "level": "must-have" }, { "term": "collaborative", "level": "nice-to-have" } ],
  "domain": "fintech",
  "domainGeneric": ["stakeholder governance", "agile ceremonies"],
  "domainSpecific": ["PCI DSS", "SOC 2"]
}
techCategories: only include categories that are actually relevant to this JD's tech stack (skip empty/irrelevant ones — don't force all four). Add other categories beyond Cloud/AI/Security/DevOps if the JD's stack calls for it (e.g. "Frontend", "Data").
roleTitle: the job title this posting is hiring for, exactly as the posting words it, with no seniority guessing. company: the hiring company's name. Use an empty string for either one if the posting genuinely does not state it — never guess and never substitute a placeholder.
keywordImportance: rank the 12-25 most significant terms in this JD by how essential they are to actually getting the role, NOT by how often the posting repeats them. "must-have" = explicitly required or gating, or so central to the role's core function that its absence disqualifies — a named licence, certification, regulation or framework counts as must-have even if stated once. "differentiator" = genuinely strengthens the application without gating it. "nice-to-have" = the posting itself frames it as optional ("bonus", "a plus", "familiarity with"), or it is generic workplace language like "collaborative" or "fast-paced" no matter how often it appears. Use the term's plain lowercase form.
domain: one short lowercase label for the industry this role sits in, e.g. fintech, healthcare, e-commerce, devtools, adtech, gaming, logistics, enterprise-saas. Use "general" if the posting does not clearly sit in one.
domainGeneric: 3-6 process, delivery or collaboration practices that are near-universal for this ROLE TYPE at this level, and therefore low-risk to phrase into a resume that already shows the underlying work (e.g. "cross-functional stakeholder management", "agile ceremonies", "release planning"). These must be ways of working, never named products, certifications or regulations.
domainSpecific: 3-8 named frameworks, certifications, compliance regimes, regulations or platform specialisms that are conventional for this domain but are NOT stated in this posting (e.g. "PCI DSS", "HIPAA", "SOX", "FedRAMP"). List them so they can be recognised if the candidate already has them. Never include anything already named in the posting itself.
matchMatrix: cover the 6-10 most important JD requirements. status is "strong" (resume clearly demonstrates it), "partial" (adjacent/related experience but not exact), or "missing" (not evidenced in the resume at all). Base this strictly on what the resume actually says — do not assume.
missingKeywords: every term from matchMatrix with status "missing", grouped into sensible categories (only include categories that have at least one term). These are meant to be shown to the candidate as things to consider genuinely gaining or emphasizing — not fabricating.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}`;
      // Sonnet, not Haiku: keywordImportance is a judgement call about what
      // gates an application, not extraction. 5000 tokens covers the worst
      // case (25 keywordImportance objects plus the domain fields on top of
      // the pre-existing payload) — 1600 truncated it mid-JSON in production.
      const { data, degraded, reason } = await callAnthropicJson(apiKey, prompt, {
        model: MODEL_QUALITY, maxTokens: 5000, logTag: 'jdBreakdown',
      });
      if (!data) throw new HttpsError('internal', `JD breakdown failed (${reason}).`, { degraded: true, reason });
      return { json: data, degraded, degradedReason: reason };
    }

    if (task === 'resumeHealth') {
      const { resumeText } = payload;
      const prompt = `Do a writing-quality scan of this resume text. Return ONLY raw JSON, no markdown fences, in this exact shape:
{
  "buzzwords": ["synergy", "team player"],
  "passiveVoiceBullets": ["exact bullet text that uses passive voice"],
  "repeatedVerbs": [ { "verb": "Managed", "count": 4 } ],
  "weakBullets": [ { "bullet": "exact bullet text", "reason": "short reason, e.g. no concrete outcome" } ],
  "longBullets": ["exact bullet text over ~2 lines"],
  "grammarIssues": ["short description of a real grammar/spelling issue found, empty array if none"]
}
Only flag things that are genuinely present in the text below — every array should be empty if the resume doesn't have that issue. Don't pad the lists to seem thorough. repeatedVerbs: only verbs used 3+ times as the leading word of a bullet.

RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 1400, logTag: 'resumeHealth' });
      return { json: JSON.parse(stripJsonFence(raw)) };
    }

    if (task === 'ocr') {
      const { images } = payload; // [{ base64, mediaType }, ...] — up to 5
      if (!Array.isArray(images) || images.length === 0) {
        throw new HttpsError('invalid-argument', 'No images provided.');
      }
      const content = [
        ...images.slice(0, 5).map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
        {
          type: 'text',
          text: images.length > 1
            ? 'These images are screenshots of the same job description, in order. Transcribe the full text as one combined, continuous job description — plain text, no commentary, no page markers.'
            : 'Transcribe the job description text shown in this image exactly, plain text, no commentary.'
        }
      ];
      const text = await callAnthropic(apiKey, content, { maxTokens: 1600, logTag: 'ocr' });
      return { text };
    }

    throw new HttpsError('invalid-argument', `Unknown task: ${task}`);
  } catch (err) {
    console.error('claudeProxy error:', err);
    throw new HttpsError('internal', err.message || 'Claude request failed.');
  }
});

// ===================== ACCOUNT SEEDING =====================

exports.ensureAccount = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const ref = db.collection('users').doc(request.auth.uid);
  const snap = await ref.get();
  const role = isAdmin(request) ? 'admin' : 'user';
  if (!snap.exists || snap.data().credits === undefined) {
    await ref.set({ credits: STARTER_CREDITS, creditsTotal: STARTER_CREDITS, role, email: request.auth.token.email || null }, { merge: true });
  } else if (snap.data().role !== role) {
    // Keep role in sync even for existing accounts — e.g. if the admin
    // email list changes, or this account existed before that email was
    // added to it. Display-only field; never used for actual authorization.
    await ref.set({ role }, { merge: true });
  }
  return { ok: true, role };
});

// ===================== COUPONS =====================

async function validateCouponForPack(code, pack) {
  if (!code || !code.trim()) return { valid: false, reason: 'No code provided.' };
  const normalized = code.trim().toUpperCase();
  const snap = await db.collection('coupons').doc(normalized).get();
  if (!snap.exists) return { valid: false, reason: 'Coupon not found.' };
  const c = snap.data();
  if (!c.active) return { valid: false, reason: 'This coupon is no longer active.' };
  if (c.expiresAt && c.expiresAt.toMillis() < Date.now()) return { valid: false, reason: 'This coupon has expired.' };
  if (c.maxUses != null && (c.usedCount || 0) >= c.maxUses) return { valid: false, reason: 'This coupon has reached its usage limit.' };

  let discountedAmountCents = pack.amountCents;
  if (c.discountType === 'percent') discountedAmountCents = Math.round(pack.amountCents * (1 - c.discountValue / 100));
  else if (c.discountType === 'fixed') discountedAmountCents = pack.amountCents - c.discountValue;
  discountedAmountCents = Math.max(50, discountedAmountCents); // Stripe's minimum charge floor

  return {
    valid: true, code: normalized, discountType: c.discountType, discountValue: c.discountValue,
    originalAmountCents: pack.amountCents, discountedAmountCents
  };
}

// User-facing: check a code and preview the discount before checkout.
// Always re-validated server-side again inside createCheckoutSession too —
// this endpoint is for UI preview only, never trusted as the final say.
exports.validateCoupon = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { code, packId } = request.data || {};
  const pack = PACKS[packId];
  if (!pack) throw new HttpsError('invalid-argument', 'Unknown credit pack.');
  return await validateCouponForPack(code, pack);
});

exports.createCoupon = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const { code, discountType, discountValue, maxUses, expiresAtMs } = request.data || {};
  if (!code || !code.trim()) throw new HttpsError('invalid-argument', 'Coupon code is required.');
  if (!['percent', 'fixed'].includes(discountType)) throw new HttpsError('invalid-argument', 'discountType must be "percent" or "fixed".');
  if (typeof discountValue !== 'number' || discountValue <= 0) throw new HttpsError('invalid-argument', 'discountValue must be a positive number.');
  if (discountType === 'percent' && discountValue > 100) throw new HttpsError('invalid-argument', 'Percent discount cannot exceed 100.');

  const normalized = code.trim().toUpperCase();
  await db.collection('coupons').doc(normalized).set({
    code: normalized, discountType, discountValue,
    maxUses: Number.isInteger(maxUses) ? maxUses : null,
    usedCount: 0, active: true,
    expiresAt: Number.isInteger(expiresAtMs) ? admin.firestore.Timestamp.fromMillis(expiresAtMs) : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.token.email
  });
  return { ok: true, code: normalized };
});

// Edits an existing coupon's terms — discount amount/type, expiry, usage
// cap. Does NOT touch `usedCount` or `active`, so editing a coupon never
// silently resets how many times it's already been used or re-enables one
// that was intentionally disabled.
exports.updateCoupon = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const { code, discountType, discountValue, maxUses, expiresAtMs, clearExpiry, clearMaxUses } = request.data || {};
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');
  const normalized = code.trim().toUpperCase();
  const ref = db.collection('coupons').doc(normalized);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');

  const patch = {};
  if (discountType !== undefined) {
    if (!['percent', 'fixed'].includes(discountType)) throw new HttpsError('invalid-argument', 'discountType must be "percent" or "fixed".');
    patch.discountType = discountType;
  }
  if (discountValue !== undefined) {
    if (typeof discountValue !== 'number' || discountValue <= 0) throw new HttpsError('invalid-argument', 'discountValue must be a positive number.');
    const effectiveType = discountType || snap.data().discountType;
    if (effectiveType === 'percent' && discountValue > 100) throw new HttpsError('invalid-argument', 'Percent discount cannot exceed 100.');
    patch.discountValue = discountValue;
  }
  if (clearExpiry) patch.expiresAt = null;
  else if (Number.isInteger(expiresAtMs)) patch.expiresAt = admin.firestore.Timestamp.fromMillis(expiresAtMs);
  if (clearMaxUses) patch.maxUses = null;
  else if (Number.isInteger(maxUses)) patch.maxUses = maxUses;

  if (Object.keys(patch).length === 0) throw new HttpsError('invalid-argument', 'Nothing to update.');
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  patch.updatedBy = request.auth.token.email;
  await ref.set(patch, { merge: true });
  return { ok: true };
});

exports.listCoupons = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const snap = await db.collection('coupons').orderBy('createdAt', 'desc').get();
  return { coupons: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
});

exports.setCouponActive = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const { code, active } = request.data || {};
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');
  await db.collection('coupons').doc(code.trim().toUpperCase()).set({ active: !!active }, { merge: true });
  return { ok: true };
});

// ===================== ADMIN — BILLING CONTROL =====================

exports.updateBillingSettings = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const { tailoringFree, creditCostPerTailor } = request.data || {};
  const patch = {};
  if (typeof tailoringFree === 'boolean') patch.tailoringFree = tailoringFree;
  if (Number.isInteger(creditCostPerTailor) && creditCostPerTailor >= 0) patch.creditCostPerTailor = creditCostPerTailor;
  if (Object.keys(patch).length === 0) throw new HttpsError('invalid-argument', 'Nothing to update.');
  await BILLING_SETTINGS_REF().set(patch, { merge: true });
  return { ok: true, settings: await getBillingSettings() };
});

// Any signed-in user can read the current mode (e.g. to show a "free mode
// active" banner) — read-only, no admin check needed, nothing sensitive.
exports.getBillingSettingsPublic = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return await getBillingSettings();
});

// Subcollections under users/{uid}, verified against every collection(...)
// call in src/lib. Firestore has no recursive delete in the admin document
// API and deleting a document does NOT delete its subcollections, so both
// export and delete have to walk this list explicitly. Anything added here
// later must be added to this list or it will be silently orphaned.
const USER_SUBCOLLECTIONS = [
  'resumes', 'resumeVersions', 'careerProfile', 'jobDescriptions',
  'agentRuns', 'customDomains', 'billingHistory'
];

function serializeValue(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v && typeof v === 'object' && v.constructor === Object) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, serializeValue(val)]));
  }
  return v;
}

/**
 * Returns everything stored against the caller's account as plain JSON.
 * Scoped to request.auth.uid only — there is no parameter to read another
 * user's data, so this cannot be turned into an enumeration endpoint.
 */
exports.exportUserData = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const userRef = db.collection('users').doc(uid);

  const [userSnap, ...subSnaps] = await Promise.all([
    userRef.get(),
    ...USER_SUBCOLLECTIONS.map(c => userRef.collection(c).get())
  ]);

  const profile = userSnap.exists ? serializeValue(userSnap.data()) : {};
  const collections = {};
  const counts = {};
  USER_SUBCOLLECTIONS.forEach((name, i) => {
    collections[name] = subSnaps[i].docs.map(d => ({ id: d.id, ...serializeValue(d.data()) }));
    counts[name] = subSnaps[i].size;
  });

  return {
    exportedAt: new Date().toISOString(),
    account: {
      uid,
      email: request.auth.token.email || null,
      emailVerified: !!request.auth.token.email_verified
    },
    profile,
    ...collections,
    counts,
    note: 'Payment card details are held by Stripe and are never stored by ResumeCraft Pro, so they cannot appear in this export.'
  };
});

/**
 * Irreversibly removes the caller's account. Firestore data is deleted before
 * the auth record, so a failure part way through leaves the user able to sign
 * in and retry rather than orphaning their documents.
 */
exports.deleteAccount = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const userRef = db.collection('users').doc(uid);

  for (const name of USER_SUBCOLLECTIONS) {
    // Paged rather than one batch: a heavy account can exceed the 500-write
    // batch limit, which would otherwise fail the whole deletion.
    let docs;
    do {
      const snap = await userRef.collection(name).limit(400).get();
      docs = snap.docs;
      if (!docs.length) break;
      const batch = db.batch();
      docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } while (docs.length === 400);
  }

  await userRef.delete();
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

exports.getAdminStats = onCall({ cors: true }, async (request) => {
  requireAdmin(request);
  const [usersCount, couponsCount] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('coupons').count().get()
  ]);
  return {
    totalUsers: usersCount.data().count,
    totalCoupons: couponsCount.data().count,
    billingSettings: await getBillingSettings()
  };
});

// ===================== STRIPE CHECKOUT =====================

exports.createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { packId, successUrl, cancelUrl, couponCode } = request.data || {};
  const pack = PACKS[packId];
  if (!pack) throw new HttpsError('invalid-argument', 'Unknown credit pack.');
  if (!successUrl || !cancelUrl) throw new HttpsError('invalid-argument', 'Missing redirect URLs.');

  // The discount is always recomputed here from the coupon doc, never
  // taken from whatever the client sends — a client could otherwise send
  // any amount it wants.
  let amountCents = pack.amountCents;
  let appliedCoupon = null;
  if (couponCode) {
    const result = await validateCouponForPack(couponCode, pack);
    if (!result.valid) throw new HttpsError('failed-precondition', result.reason || 'Invalid coupon.');
    amountCents = result.discountedAmountCents;
    appliedCoupon = result.code;
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `ResumeCraftPro — ${pack.label}${appliedCoupon ? ` (${appliedCoupon})` : ''}` },
        unit_amount: amountCents
      },
      quantity: 1
    }],
    // metadata rides along on both the session and (via payment_intent_data)
    // the underlying PaymentIntent, so the webhook can find it either way.
    metadata: { uid: request.auth.uid, credits: String(pack.credits), packId, couponCode: appliedCoupon || '' },
    payment_intent_data: { metadata: { uid: request.auth.uid, credits: String(pack.credits), packId, couponCode: appliedCoupon || '' } },
    success_url: successUrl,
    cancel_url: cancelUrl
  });

  return { url: session.url };
});

// ===================== STRIPE WEBHOOK =====================

exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    // If you see NOTHING in Cloud Logging at all for a payment you just
    // made — not even this error — the webhook endpoint isn't registered
    // in Stripe's dashboard, or Stripe can't reach this URL. This log line
    // only fires if Stripe reached the function at all.
    console.error(JSON.stringify({ tag: 'stripe_webhook_signature_failed', message: err.message }));
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Log every event Stripe sends here, unconditionally — this is the first
  // thing to check when credits aren't landing: if this log is present but
  // event.type is never "checkout.session.completed", the webhook endpoint
  // in Stripe's dashboard isn't subscribed to that event type.
  console.log(JSON.stringify({ tag: 'stripe_webhook_received', eventType: event.type, eventId: event.id }));

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    const credits = parseInt(session.metadata?.credits || '0', 10);

    if (!uid || !credits) {
      // If this fires, the Checkout Session was created without the
      // expected metadata — check createCheckoutSession, not the webhook.
      console.error(JSON.stringify({ tag: 'stripe_webhook_missing_metadata', sessionId: session.id, metadata: session.metadata || null }));
      res.status(200).send('ignored — missing metadata');
      return;
    }

    const historyRef = db.collection('users').doc(uid).collection('billingHistory').doc(session.id);
    const alreadyProcessed = (await historyRef.get()).exists;
    const couponCode = session.metadata?.couponCode || null;

    if (alreadyProcessed) {
      console.log(JSON.stringify({ tag: 'stripe_webhook_already_processed', sessionId: session.id, uid }));
    } else {
      const userRef = db.collection('users').doc(uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const current = snap.exists ? (snap.data().credits ?? 0) : 0;
        const total = snap.exists ? (snap.data().creditsTotal ?? 0) : 0;
        tx.set(userRef, { credits: current + credits, creditsTotal: total + credits }, { merge: true });
        tx.set(historyRef, {
          credits,
          amountCents: session.amount_total,
          currency: session.currency,
          status: 'paid',
          stripeSessionId: session.id,
          couponCode,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // Coupon usage is only incremented here, on CONFIRMED payment — an
        // abandoned checkout (session created, never paid) never counts
        // against the coupon's usage limit.
        if (couponCode) {
          const couponRef = db.collection('coupons').doc(couponCode);
          tx.set(couponRef, { usedCount: admin.firestore.FieldValue.increment(1) }, { merge: true });
        }
      });
      console.log(JSON.stringify({ tag: 'stripe_webhook_credited', uid, credits, sessionId: session.id, couponCode }));
    }
  }

  res.status(200).send('ok');
});

// ============================================================
// AGENT MODULE — parseJD, agentAnalyze, agentBuild
// All LLM calls are server-side only — domain internals
// (categories/skills/strongPoints) never leave the server.
// ============================================================

exports.agentProxy = onCall({ secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { task, payload } = request.data || {};
  const apiKey = ANTHROPIC_API_KEY.value();

  // ---- TASK: parseJD — extract structured requirements from raw JD text ----
  if (task === 'parseJD') {
    const { jobDescriptionId, rawText } = payload || {};
    if (!rawText) throw new HttpsError('invalid-argument', 'rawText is required.');

    const prompt = `Parse this job description and return ONLY raw JSON (no markdown fences):
{
  "company": "company name or null",
  "title": "exact job title",
  "seniority": "Junior|Mid|Senior|Staff|Principal|Director|VP or null",
  "roleFamily": "Engineering|Design|Product|Operations|Finance|HR or null",
  "requirements": [
    { "name": "concise 2-5 word requirement", "importance": "Critical|High|Medium|Low", "mentionCount": 2 }
  ]
}
Rules:
- Requirements = every technical skill, tool, methodology, or qualification explicitly asked for.
- importance: Critical = must-have, listed multiple times or in a "Required" section; High = listed in primary requirements; Medium = nice to have; Low = briefly mentioned.
- mentionCount = how many times it appears in the JD.
- De-duplicate closely related terms (e.g. "React" and "React.js" → "React").
- Requirements list should have 8-20 items — don't omit important ones, don't pad with trivial ones.

JOB DESCRIPTION:
${rawText}`;

    const raw = await callAnthropic(apiKey, prompt, { model: MODEL_QUALITY, maxTokens: 1200, logTag: 'parseJD' });
    const parsed = JSON.parse(stripJsonFence(raw));

    // Persist parsed fields back to the user's jobDescriptions doc
    if (jobDescriptionId) {
      await db.collection('users').doc(uid).collection('jobDescriptions').doc(jobDescriptionId).set(
        { company: parsed.company, title: parsed.title, seniority: parsed.seniority, roleFamily: parsed.roleFamily, requirements: parsed.requirements || [], parsed: true },
        { merge: true }
      );
    }
    return { parsed };
  }

  // ---- TASK: agentAnalyze — map profile evidence against JD requirements ----
  if (task === 'agentAnalyze') {
    const { agentRunId, careerProfile, jobDescription, domainId, subDomainId } = payload || {};
    if (!careerProfile || !jobDescription) throw new HttpsError('invalid-argument', 'careerProfile and jobDescription are required.');

    // Load domain internals server-side — never exposed to client
    let domainContext = '';
    if (domainId) {
      const { vocab, directives } = await loadDomainContent(domainId, subDomainId);
      if (vocab.length || directives.length) {
        domainContext = `\nDomain vocabulary (transferable skill synonyms): ${vocab.join(', ')}\nStyle directives: ${directives.join('; ')}`;
      }
    }

    const profileText = [
      ...(careerProfile.experience || []).map(e => `${e.title} at ${e.company}${e.startDate ? ` (${e.startDate}–${e.endDate || 'Present'})` : ''}`),
      ...(careerProfile.skills || []).map(s => s.label),
      ...(careerProfile.education || []).map(e => `${e.degree} from ${e.school}`),
    ].join('\n');

    const requirements = (jobDescription.requirements || []);
    const reqList = requirements.map(r => `${r.name} (${r.importance})`).join('\n');

    const prompt = `You are mapping a candidate's career profile against job requirements. Return ONLY raw JSON (no markdown fences):
{
  "roleMatch": "Strong|Good|Partial|Weak",
  "evidenceMap": { "requirement name": "STRONG|WEAK|MISSING" },
  "strongestEvidence": ["top 4-5 skills/experiences the candidate clearly has"],
  "positioning": "one sentence positioning statement for this candidate for this role",
  "experiencePriority": [{ "employer": "company name", "level": "Very High|High|Medium" }],
  "skillPriority": ["top skills to highlight, ordered by JD importance"],
  "deemphasize": ["experience entries or skills to downplay for this role"]
}
STRONG = candidate clearly demonstrates this. WEAK = adjacent/transferable evidence. MISSING = no evidence.
roleMatch: Strong = 70%+ of Critical/High requirements are STRONG. Good = 50%+. Partial = 30%+. Weak = below.${domainContext}

CANDIDATE PROFILE:
${profileText}

JD REQUIREMENTS:
${reqList}

JOB TITLE: ${jobDescription.title || ''}`;

    const raw = await callAnthropic(apiKey, prompt, { model: MODEL_QUALITY, maxTokens: 1400, logTag: 'agentAnalyze' });
    const strategy = JSON.parse(stripJsonFence(raw));

    if (agentRunId) {
      await db.collection('users').doc(uid).collection('agentRuns').doc(agentRunId).set(
        { strategySnapshot: strategy, currentStep: 'strategy', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    return { strategy };
  }

  // ---- TASK: agentBuild — generate full resume from profile + strategy ----
  if (task === 'agentBuild') {
    const { agentRunId, careerProfile, jobDescription, strategy, domainId, subDomainId, previousResume } = payload || {};
    if (!careerProfile || !jobDescription || !strategy) throw new HttpsError('invalid-argument', 'careerProfile, jobDescription, and strategy are required.');

    // Spend 1 credit for build
    const cost = 1;
    const remainingAfterSpend = await spendCreditOrThrow(uid, cost);

    // Load domain style directives server-side
    let styleDirectives = [];
    let bulletTemplates = [];
    let domainLabel = '';
    if (domainId) {
      ({ directives: styleDirectives, bulletTemplates, label: domainLabel } = await loadDomainContent(domainId, subDomainId));
    }

    // Contact facts are assembled here rather than left to the model, so the
    // name/phone/links can't be dropped or invented.
    const d = careerProfile.details || {};
    const contactLine = [d.phone, d.email, d.linkedin, d.github, d.portfolio, d.location]
      .map(v => String(v || '').trim()).filter(Boolean).join(' | ');

    const groundTruth = {
      personal: {
        fullName: d.fullName || '',
        tagline: d.tagline || '',
        location: d.location || '',
        email: d.email || '',
        phone: d.phone || '',
        linkedin: d.linkedin || '',
        github: d.github || '',
        portfolio: d.portfolio || '',
      },
      experience: (careerProfile.experience || []).map(e => ({
        title: e.title, company: e.company, startDate: e.startDate, endDate: e.endDate,
        location: e.location, bullets: e.bullets || [], skills: e.skills || [],
      })),
      education: (careerProfile.education || []).map(e => ({
        school: e.school, degree: e.degree, fieldOfStudy: e.fieldOfStudy,
        startDate: e.startDate, endDate: e.endDate, location: e.location, gpa: e.gpa,
      })),
      certifications: (careerProfile.certifications || []).map(c => ({
        name: c.name, issuer: c.issuer, issueDate: c.issueDate, expiryDate: c.expiryDate,
      })),
      skills: (careerProfile.skills || []).map(s => s.label),
      yearsExperience: totalExperienceYears(careerProfile.experience || []),
    };

    const criticalReqs = (jobDescription.requirements || []).filter(r => ['Critical', 'High'].includes(r.importance)).map(r => r.name).join(', ');
    const allReqTerms = [...new Set((jobDescription.requirements || [])
      .flatMap(r => requirementTerms(r.name).terms))].slice(0, 45);
    const styleNote = styleDirectives.slice(0, 4).join('; ');
    // Templates are ranked by JD-term overlap and hard-capped: a domain can hold
    // hundreds, and an unranked dump would both blow the context and bias the
    // model toward irrelevant phrasing.
    const bulletPatterns = bulletTemplates
      .map(text => {
        const lower = text.toLowerCase();
        return { text, score: allReqTerms.filter(t => lower.includes(t.toLowerCase())).length };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map(p => p.text);
    const priorityEmployers = (strategy.experiencePriority || []).filter(e => e.level === 'Very High' || e.level === 'High').map(e => e.employer).join(', ');

    const systemPrompt = [{
      type: 'text',
      cache_control: { type: 'ephemeral' },
      text: `You are building a fully tailored resume. EXTRACT project synopses from ground truth, then REWRITE from scratch for the target role. Never invent employers, dates, or credentials not in the ground truth. Use STAR-shaped bullets with metrics where truthfully supported. No buzzwords.

BULLET REBUILD - apply to every single experience bullet, no exceptions
Do not carry over generic duties. Rebuild each bullet from the underlying project synopsis so it visibly answers a requirement in this JD:
- Lead with the action and the JD's own terminology for the technology, domain, or responsibility involved, wherever the candidate's real evidence supports it.
- State the scope or scale (users, volume, regions, team size, systems) and close with a measurable or concrete outcome whenever the ground truth supports one. Never invent a number.
- Every bullet must earn its place against a JD requirement, but a bullet is justified by covering that requirement through the candidate's own project, never by hosting a keyword. Build bullets around each employer's real initiatives (see RESUME CRAFT below) and let one bullet carry several related requirements. If a bullet cannot be tied to anything the JD asks for, cut it and write a stronger one from the same role's real evidence instead.
- Order bullets within each role so the ones matching Critical/High requirements come first.
- Do not reuse the same leading verb more than twice across the whole resume.

PUNCTUATION - hard rule
Never use em dashes or en dashes anywhere in the output. Use commas, colons, or separate sentences instead. For date ranges use a plain hyphen, e.g. "Jan 2020 - Mar 2023".

IDENTITY - use the ground truth verbatim
The "personal" block in the ground truth holds the candidate's real name and contact details. Copy "fullName" into "name" exactly as written. Build "contact" from the phone, email, linkedin, github, portfolio and location that are present, pipe-separated, in that order. Never invent, abbreviate, or omit a contact field that was provided, and never substitute a placeholder like "Candidate Name" or "email@example.com".

PROFESSIONAL SUMMARY - describe the candidate, not the job
The summary is the one section that must read as a truthful account of who this person is. It is not a restatement of the job posting.
- Open with the candidate's real seniority and total experience using the "yearsExperience" number from the ground truth, in the form "X+ years" - for example "Senior Data Engineer with 9+ years of experience across banking and payments platforms". Use that number only. Never round it up, never invent one, and if it is 0 or missing, omit the years clause entirely rather than guessing.
- Name the domain or speciality supplied as TARGET DOMAIN when one is given, so the summary positions the candidate inside that field.
- Every claim must be traceable to the ground truth: real employers, real systems, real scale. Do not assert familiarity with a tool, platform, or regulation that appears only in the job description.
- Do not copy sentences or distinctive phrases from the job description into the summary, and never describe the role's responsibilities as though they were the candidate's past work.
- Aim for 3-4 sentences, roughly 60-100 words, following the WHO / WHERE / WHAT / HOW / VALUE structure in RESUME CRAFT below. Every claim it makes must be proven by a bullet in the experience section.

KEYWORD COVERAGE - hard requirement, not a stylistic suggestion
The user message lists KEYWORDS TO COVER drawn from this JD. Every one of them that the ground truth truthfully supports must appear in the resume using the JD's own wording, at least once. Placement priority: Professional Summary and the most recent role first, then Technical Skills, then earlier roles. Work them in as part of real accomplishments, never as a keyword list bolted onto the end. Omit only the ones the candidate genuinely has no evidence for, and do not stretch a claim to fit a keyword.

BEFORE RETURNING - internal audit, do not print this reasoning
1. Walk the KEYWORDS TO COVER list and confirm each supported one appears in your draft's exact wording; add any that are missing.
2. Walk the ATS COMPLIANCE list and fix every violation: weak bullet openers, pronouns, unexpanded acronyms, inconsistent dates, banned filler, and bullets with no number where the ground truth supports one.
3. Walk RESUME CRAFT and fix what it catches: cut any bullet that is a JD responsibility flipped into past tense, any bullet that exists only to host a keyword, any generic bullet that could belong to anyone, and any low-value administrative line. Confirm the resume states one primary identity, that bullet counts taper by recency, that each employer tells a distinct story, that the career visibly progresses, and that every summary claim has a bullet proving it.
4. Score the draft 1-10 on ATS relevance (target 9), recruiter readability (9), hiring manager credibility (9), specificity (8), quantification (8.5), career progression (8), natural human writing (9), and interview defensibility (10). Where a score falls short, revise that weakness before returning. Never finalize a draft that scores high on keywords but reads as copied from the JD.

REVISION MODE
If the user message includes an EXISTING DRAFT, you are editing that draft, not authoring a new resume. Preserve its structure, section order, and wording exactly except where an instruction requires a change. Change the minimum needed to satisfy the instructions, then re-check the whole document against the ATS rules below. If no EXISTING DRAFT is provided, build the resume from the ground truth as described above.

${ATS_RULES}

${CRAFT_RULES}

Respond in EXACTLY this JSON format, nothing else:
{
  "name": "candidate name",
  "contact": "phone | email | linkedin | location",
  "sections": [
    { "heading": "PROFESSIONAL SUMMARY", "paragraphs": ["3-4 sentence summary, 60-100 words"] },
    { "heading": "TECHNICAL SKILLS", "paragraphs": ["Category: skill, skill", "Category: skill"] },
    { "heading": "PROFESSIONAL EXPERIENCE", "entries": [{ "title": "Role Title", "subtitle": "Company | Location", "dateRight": "Mon YYYY - Mon YYYY", "bullets": ["bullet 1", "bullet 2"], "footer": "Tools: optional" }] },
    { "heading": "EDUCATION", "entries": [{ "title": "Degree", "subtitle": "School", "dateRight": "YYYY", "bullets": [] }] }
  ]
}`
    }];

    const userPrompt = `GROUND TRUTH (only facts you may use):
${JSON.stringify(groundTruth, null, 2)}

TARGET ROLE: ${jobDescription.title || 'Target Role'}
COMPANY: ${jobDescription.company || ''}
${domainLabel ? `TARGET DOMAIN: ${domainLabel}` : ''}
YEARS OF EXPERIENCE (computed from the ground truth dates, use verbatim): ${groundTruth.yearsExperience || 'unknown'}
CRITICAL REQUIREMENTS: ${criticalReqs}
KEYWORDS TO COVER (use each one's exact wording at least once wherever the ground truth truthfully supports it): ${allReqTerms.join(', ')}
PRIORITY EMPLOYERS TO LEAD WITH: ${priorityEmployers || 'all'}
POSITIONING: ${strategy.positioning || ''}
SKILLS TO HIGHLIGHT: ${(strategy.skillPriority || []).slice(0, 8).join(', ')}
${styleNote ? `STYLE DIRECTIVES: ${styleNote}` : ''}${bulletPatterns.length ? `

DOMAIN PHRASING PATTERNS - curated shapes for this industry, ranked by relevance to this JD. These are guidance on structure and vocabulary, never text to copy:
- Rebuild each one around the candidate's real facts from the ground truth. A pattern is a skeleton, not a sentence to paste.
- Square brackets mark values that must come from the ground truth. If a bracketed value is not supported, drop that clause and keep the rest of the shape. Never emit a bracket, and never invent the value.
- Skip any pattern whose underlying experience the candidate does not actually have. Covering four patterns truthfully beats covering ten loosely.
- The finished bullets must read as this person's own work history. Vary sentence structure and opening verbs so nothing reads as a filled-in template.
${bulletPatterns.map(p => `- ${p}`).join('\n')}` : ''}${previousResume ? `

EXISTING DRAFT — revise this, do not start over:
${JSON.stringify(previousResume)}

Apply the POSITIONING instructions above to the draft as targeted edits. Keep everything that already works (structure, wording, ordering) byte-for-byte unless an instruction calls for changing it. The ground truth above still bounds what may be claimed.` : ''}`;

    async function runAgentBuildPass(userContent, logTag) {
      const rawOut = await callAnthropic(apiKey, userContent, {
        model: MODEL_QUALITY, maxTokens: 8000, system: systemPrompt,
        timeoutMs: 120000, logTag
      });
      return sanitizeResumeContent(JSON.parse(stripJsonFence(rawOut)));
    }

    function scoreAgainstRequirements(resume) {
      const text = resumeToPlainText(resume).toLowerCase();
      const matches = (jobDescription.requirements || []).map(req => {
        const { strength, mentions, terms } = matchRequirement(req.name, text);
        return {
          name: req.name, importance: req.importance, mentionCount: req.mentionCount,
          evidenceStrength: strength, mentions, terms,
        };
      });
      // Critical/High requirements carry more weight than nice-to-haves, so a
      // resume isn't punished equally for missing an optional bonus skill.
      const weightOf = imp => (imp === 'Critical' ? 3 : imp === 'High' ? 2 : 1);
      const creditOf = s => (s === 'STRONG' ? 1 : s === 'WEAK' ? 0.55 : 0);
      let earned = 0, possible = 0;
      for (const m of matches) {
        const w = weightOf(m.importance);
        possible += w;
        earned += w * creditOf(m.evidenceStrength);
      }
      return { matches, score: possible ? Math.round((earned / possible) * 100) : 0 };
    }

    let content = await runAgentBuildPass(userPrompt, 'agentBuild');

    // Identity is a fact, not a generation target — overwrite whatever the model
    // produced with the profile's real values.
    function applyIdentity(resume) {
      if (d.fullName) resume.name = d.fullName;
      if (contactLine) resume.contact = contactLine;
      return resume;
    }
    content = applyIdentity(content);

    let { matches: requirementMatches, score: matchScore } = scoreAgainstRequirements(content);

    // Measured-then-repair: build-from-scratch has no source resume to fall back
    // on, so it needs several shots to converge on the score target.
    let buildAudit = auditAts(content, []);
    for (let attempt = 0; attempt < 3; attempt++) {
      const missing = requirementMatches
        .filter(m => m.evidenceStrength !== 'STRONG')
        .sort((a, b) => (b.importance === 'Critical') - (a.importance === 'Critical'))
        .map(m => `${m.name}${m.evidenceStrength === 'WEAK' ? ' (only partially covered)' : ''}`);

      buildAudit = { ...auditAts(content, []), missingKeywords: missing.slice(0, 14) };
      const repairList = atsRepairInstruction(buildAudit);
      if (matchScore >= ATS_SCORE_TARGET && !repairList) break;

      // Previously the loop bailed whenever the ATS audit was clean, so a draft
      // could ship below target with no attempt to close the coverage gap.
      const gapNote = missing.length
        ? `\nRequirements not yet strongly evidenced, Critical first: ${missing.slice(0, 14).join('; ')}.`
        : '';
      if (!repairList && !gapNote) break;

      try {
        const repaired = await runAgentBuildPass(`${userPrompt}

Your previous draft was audited mechanically against the resume text you produced. It scored ${matchScore}/100 on JD requirement coverage, against a ${ATS_SCORE_TARGET} target. Produce a corrected version that fixes every item below while keeping everything that already works:
${repairList}${gapNote}

Weave each missing requirement into a real accomplishment bullet or the summary using the JD's own wording. Never invent employers, dates, credentials, or metrics that are not in the ground truth — if a requirement genuinely has no supporting evidence, leave it out rather than fabricating one.`, `agentBuild_repair_${attempt + 1}`);
        const rescored = scoreAgainstRequirements(repaired);
        if (rescored.score > matchScore) {
          content = applyIdentity(repaired);
          requirementMatches = rescored.matches;
          matchScore = rescored.score;
        } else {
          break;
        }
      } catch (e) {
        console.error('agentBuild repair pass failed, keeping current draft:', e.message);
        break;
      }
    }

    console.log(JSON.stringify({
      tag: 'agent_build_audit', uid, matchScore,
      missing: requirementMatches.filter(m => m.evidenceStrength === 'MISSING').length,
      weak: requirementMatches.filter(m => m.evidenceStrength === 'WEAK').length,
      quantifiedBullets: buildAudit.quantifiedBullets, totalBullets: buildAudit.totalBullets,
      weakOpeners: buildAudit.weakOpenerBullets.length, pronouns: buildAudit.pronounBullets.length,
    }));

    // Truthfulness flags — verify every named employer/school
    const flags = [];
    for (const entry of (content.sections || []).flatMap(s => s.entries || [])) {
      const employer = entry.subtitle?.split('|')[0]?.trim();
      if (employer) {
        const traceable = groundTruth.experience.some(e => e.company.toLowerCase().includes(employer.toLowerCase()) || employer.toLowerCase().includes(e.company.toLowerCase()));
        if (!traceable && groundTruth.education.every(e => !e.school.toLowerCase().includes(employer.toLowerCase()))) {
          flags.push({ id: 'f_' + Date.now() + Math.random(), claimText: `Employer/school not found in profile: "${employer}"`, status: 'needs_review' });
        }
      }
    }

    // Generate per-section changes
    const changes = [];
    if (content.sections?.find(s => s.heading === 'PROFESSIONAL SUMMARY')) {
      changes.push({ id: 'c_sum_' + Date.now(), section: 'PROFESSIONAL SUMMARY', beforeText: '(no summary)', afterText: content.sections.find(s => s.heading === 'PROFESSIONAL SUMMARY').paragraphs?.[0] || '', rationale: 'AI-generated summary for target role', status: 'pending' });
    }

    // Persist the version
    // Highlights are derived from the finished text rather than the strategy's
    // wish-list, so every term is guaranteed to actually be present to mark up.
    const finalText = resumeToPlainText(content).toLowerCase();
    content.highlights = allReqTerms
      .filter(t => t.length > 2 && finalText.includes(t.toLowerCase()))
      .sort((a, b) => b.length - a.length)
      .slice(0, 24);

    const versionId = 'rv_' + Date.now();
    const versionData = {
      id: versionId, agentRunId: agentRunId || null,
      versionNumber: 1, label: 'Initial Agent build',
      content, matchScore,
      scoreBreakdown: {
        keywordCoverage: matchScore,
        experienceRelevance: matchScore - 5,
        impactMetrics: Math.min(100, Math.round((buildAudit.quantificationRatio / ATS_TARGET_QUANT_RATIO) * 100)),
        roleAlignment: matchScore,
        formatting: 95,
        leadership: 75,
      },
      requirementMatches, changes, flags,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(uid).collection('resumeVersions').doc(versionId).set(versionData);

    if (agentRunId) {
      await db.collection('users').doc(uid).collection('agentRuns').doc(agentRunId).set(
        { resumeVersionId: versionId, currentStep: 'review', status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return { versionId, matchScore, creditsRemaining: remainingAfterSpend };
  }

  // ---- TASK: publicSubDomains — published specialities for a published domain ----
  // Any signed-in user may call this; it returns names only, never the skills,
  // bullet templates or instructions behind them.
  if (task === 'publicSubDomains') {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { domainId } = payload || {};
    if (!domainId) return { subDomains: [] };
    const domSnap = await db.collection('domains').doc(domainId).get();
    if (!domSnap.exists || domSnap.data().status !== 'published') return { subDomains: [] };
    const snap = await db.collection('domains').doc(domainId).collection('subDomains')
      .where('status', '==', 'published').get();
    const subDomains = snap.docs
      .map(d => ({ id: d.id, name: d.data().name, description: d.data().description || '', sortOrder: d.data().sortOrder || 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder, ...rest }) => rest);
    return { subDomains };
  }

  // ---- TASK: domainAdmin — CRUD for domains (admin-only) ----
  if (task === 'domainAdmin') {
    requireAdmin(request);
    const { action, domainId, data } = payload || {};
    // §0 audit trail — recorded on every mutation from day one so it never
    // becomes a backfill problem.
    const audit = {
      updatedBy: request.auth.uid,
      updatedByEmail: request.auth.token.email || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (action === 'create') {
      const ref = db.collection('domains').doc();
      await ref.set({
        name: data.name, summary: data.summary, status: 'draft', categories: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        createdByEmail: request.auth.token.email || null,
        ...audit,
      });
      return { id: ref.id };
    }
    if (action === 'update') {
      await db.collection('domains').doc(domainId).set({ ...data, ...audit }, { merge: true });
      return { ok: true };
    }
    if (action === 'publish') {
      await db.collection('domains').doc(domainId).set({ status: data.status, ...audit }, { merge: true });
      return { ok: true };
    }
    if (action === 'delete') {
      await db.collection('domains').doc(domainId).delete();
      return { ok: true };
    }
    if (action === 'list') {
      const snap = await db.collection('domains').get();
      // Sub-collection counts travel with each domain so this legacy tab can
      // tell "genuinely empty" apart from "authored in the Domain Library".
      const domains = await Promise.all(snap.docs.map(async d => {
        const [subDomains, skills, bulletPoints, instructions] = await Promise.all(
          ['subDomains', 'skills', 'bulletPoints', 'instructions'].map(async c =>
            (await d.ref.collection(c).count().get()).data().count));
        return { id: d.id, ...d.data(), libraryCounts: { subDomains, skills, bulletPoints, instructions } };
      }));
      return { domains };
    }
    throw new HttpsError('invalid-argument', `Unknown domainAdmin action: ${action}`);
  }

  // ---- TASK: domainLibrary — full Domain Library CRUD (admin-only) ----
  //
  // Storage layout:
  //   domains/{domainId}
  //     ├─ subDomains/{id}
  //     ├─ skills/{id}          (carries subDomainId, nullable)
  //     ├─ bulletPoints/{id}    (carries subDomainId, nullable)
  //     └─ instructions/{id}    (carries subDomainId, nullable)
  //
  // Sub-collections rather than top-level collections with a domainId field:
  // scoping every query to a parent doc avoids composite indexes, and deleting
  // a domain becomes a single recursive delete instead of five fan-out queries.
  if (task === 'domainLibrary') {
    requireAdmin(request);
    const { action, payload: p = {} } = payload || {};
    const audit = () => ({
      updatedBy: request.auth.uid,
      updatedByEmail: request.auth.token.email || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const domainsRef = db.collection('domains');
    const sub = (domainId, name) => domainsRef.doc(domainId).collection(name);
    const countOf = async ref => (await ref.count().get()).data().count;
    const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Timestamps must reach the client as ISO strings — the UI sorts and
    // formats with `new Date(...)`, which can't read a Firestore Timestamp.
    const ser = d => {
      const out = { id: d.id };
      for (const [k, v] of Object.entries(d.data() || {})) {
        out[k] = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
      }
      return out;
    };
    const listOf = async ref => (await ref.get()).docs.map(ser);

    async function domainCounts(domainId) {
      const [subDomains, skills, bulletPoints, instructions] = await Promise.all([
        countOf(sub(domainId, 'subDomains')), countOf(sub(domainId, 'skills')),
        countOf(sub(domainId, 'bulletPoints')), countOf(sub(domainId, 'instructions')),
      ]);
      return { subDomains, skills, bulletPoints, instructions };
    }
    async function subDomainCounts(domainId, subDomainId) {
      const [skills, bulletPoints, instructions] = await Promise.all(
        ['skills', 'bulletPoints', 'instructions'].map(c =>
          countOf(sub(domainId, c).where('subDomainId', '==', subDomainId))),
      );
      return { skills, bulletPoints, instructions };
    }
    // Deletes every doc matching a query, in batches — used for cascades.
    async function deleteWhere(ref) {
      const snap = await ref.get();
      if (snap.empty) return;
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    switch (action) {
      case 'stats': {
        const [totalDomains, published, draft, totalSubDomains, totalSkills, totalBulletPoints] =
          await Promise.all([
            countOf(domainsRef),
            countOf(domainsRef.where('status', '==', 'published')),
            countOf(domainsRef.where('status', '==', 'draft')),
            countOf(db.collectionGroup('subDomains')),
            countOf(db.collectionGroup('skills')),
            countOf(db.collectionGroup('bulletPoints')),
          ]);
        return {
          totalDomains, totalSubDomains, totalSkills, totalBulletPoints,
          publishedCount: published, draftCount: draft,
        };
      }

      case 'listDomains': {
        const snap = await domainsRef.get();
        return {
          domains: await Promise.all(snap.docs.map(async d => ({
            ...ser(d), counts: await domainCounts(d.id),
          }))),
        };
      }

      case 'createDomain': {
        const ref = domainsRef.doc();
        await ref.set({
          name: p.name,
          slug: slugify(p.name),
          description: p.description || '',
          // `summary` and `categories` mirror the legacy shape so domains made
          // here stay readable by AgentView and the existing Admin tab.
          summary: p.description || '',
          categories: [],
          icon: p.icon || '📁',
          status: p.status || 'draft',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: request.auth.uid,
          createdByEmail: request.auth.token.email || null,
          ...audit(),
        });
        const doc = await ref.get();
        return { domain: { ...ser(doc), counts: await domainCounts(ref.id) } };
      }

      case 'updateDomain': {
        const patch = { ...p.patch, ...audit() };
        if (patch.name) patch.slug = slugify(patch.name);
        if (typeof patch.description === 'string') patch.summary = patch.description;
        await domainsRef.doc(p.id).set(patch, { merge: true });
        const doc = await domainsRef.doc(p.id).get();
        return { domain: { ...ser(doc), counts: await domainCounts(p.id) } };
      }

      case 'deleteDomain': {
        await db.recursiveDelete(domainsRef.doc(p.id));
        return { ok: true };
      }

      case 'listSubDomains': {
        const docs = await listOf(sub(p.domainId, 'subDomains'));
        const withCounts = await Promise.all(docs.map(async s => ({
          ...s, counts: await subDomainCounts(p.domainId, s.id),
        })));
        return { subDomains: withCounts.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) };
      }

      case 'createSubDomain': {
        const col = sub(p.domainId, 'subDomains');
        const ref = col.doc();
        await ref.set({
          domainId: p.domainId,
          name: p.name,
          description: p.description || '',
          status: p.status || 'draft',
          sortOrder: (await countOf(col)) + 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...audit(),
        });
        const doc = await ref.get();
        return { subDomain: { ...ser(doc), counts: { skills: 0, bulletPoints: 0, instructions: 0 } } };
      }

      case 'updateSubDomain': {
        const ref = sub(p.domainId, 'subDomains').doc(p.id);
        await ref.set({ ...p.patch, ...audit() }, { merge: true });
        const doc = await ref.get();
        return { subDomain: { ...ser(doc), counts: await subDomainCounts(p.domainId, p.id) } };
      }

      case 'deleteSubDomains': {
        for (const id of p.ids) {
          await Promise.all(['skills', 'bulletPoints', 'instructions'].map(c =>
            deleteWhere(sub(p.domainId, c).where('subDomainId', '==', id))));
          await sub(p.domainId, 'subDomains').doc(id).delete();
        }
        return { ok: true };
      }

      case 'bulkUpdateSubDomains': {
        const batch = db.batch();
        const a = audit();
        p.ids.forEach(id => batch.set(sub(p.domainId, 'subDomains').doc(id), { ...p.patch, ...a }, { merge: true }));
        await batch.commit();
        return { ok: true };
      }

      case 'listSkills':
        return { skills: await listOf(sub(p.domainId, 'skills')) };

      case 'addSkills': {
        const col = sub(p.domainId, 'skills');
        const batch = db.batch();
        const a = audit();
        const created = p.names.map(name => {
          const ref = col.doc();
          const row = {
            domainId: p.domainId,
            subDomainId: p.meta?.subDomainId || null,
            name,
            category: p.meta?.category || 'Primary Skills',
            priority: p.meta?.priority || 'medium',
            evidenceWeight: p.meta?.evidenceWeight || 'moderate',
            status: p.meta?.status || 'draft',
            usageScore: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            ...a,
          };
          batch.set(ref, row);
          return { id: ref.id, ...row, createdAt: null, updatedAt: null };
        });
        await batch.commit();
        return { skills: created };
      }

      case 'updateSkill': {
        const ref = sub(p.domainId, 'skills').doc(p.id);
        await ref.set({ ...p.patch, ...audit() }, { merge: true });
        return { skill: ser(await ref.get()) };
      }

      case 'bulkUpdateSkills': {
        const batch = db.batch();
        const a = audit();
        p.ids.forEach(id => batch.set(sub(p.domainId, 'skills').doc(id), { ...p.patch, ...a }, { merge: true }));
        await batch.commit();
        return { ok: true };
      }

      case 'deleteSkills': {
        const batch = db.batch();
        p.ids.forEach(id => batch.delete(sub(p.domainId, 'skills').doc(id)));
        await batch.commit();
        return { ok: true };
      }

      case 'listBulletPoints':
        return { bulletPoints: await listOf(sub(p.domainId, 'bulletPoints')) };

      case 'saveBulletPoint': {
        const col = sub(p.domainId, 'bulletPoints');
        const { id, ...rest } = p.bulletPoint;
        const ref = id ? col.doc(id) : col.doc();
        const base = id ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() };
        await ref.set({ ...rest, domainId: p.domainId, ...base, ...audit() }, { merge: true });
        return { bulletPoint: ser(await ref.get()) };
      }

      case 'deleteBulletPoint': {
        await sub(p.domainId, 'bulletPoints').doc(p.id).delete();
        return { ok: true };
      }

      case 'listInstructions': {
        const docs = await listOf(sub(p.domainId, 'instructions'));
        return { instructions: docs.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) };
      }

      case 'saveInstruction': {
        const col = sub(p.domainId, 'instructions');
        const { id, ...rest } = p.instruction;
        const ref = id ? col.doc(id) : col.doc();
        const base = id ? {} : {
          sortOrder: (await countOf(col)) + 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await ref.set({ ...rest, domainId: p.domainId, ...base, ...audit() }, { merge: true });
        return { instruction: ser(await ref.get()) };
      }

      case 'reorderInstructions': {
        const batch = db.batch();
        p.orderedIds.forEach((id, i) =>
          batch.set(sub(p.domainId, 'instructions').doc(id), { sortOrder: i + 1 }, { merge: true }));
        await batch.commit();
        return { ok: true };
      }

      case 'deleteInstruction': {
        await sub(p.domainId, 'instructions').doc(p.id).delete();
        return { ok: true };
      }

      // No analytics pipeline exists yet. Report that honestly rather than
      // returning invented figures the UI would render as real.
      case 'usage':
        return { available: false, runs: null, matchedJobs: null, avgMatch: null, lastUsed: null };

      default:
        throw new HttpsError('invalid-argument', `Unknown domainLibrary action: ${action}`);
    }
  }

  throw new HttpsError('invalid-argument', `Unknown agent task: ${task}`);
});
