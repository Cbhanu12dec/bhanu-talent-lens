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

// Authorization is always re-checked server-side against this list on every
// admin-only call — the client-visible `role` field on the user doc is
// display-only, never trusted for actual access control.
const ADMIN_EMAILS = ['cbhanu12dec@gmail.com'];

function isAdmin(request) {
  return !!request.auth?.token?.email && ADMIN_EMAILS.includes(request.auth.token.email);
}
function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (!isAdmin(request)) throw new HttpsError('permission-denied', 'Admin access required.');
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
      const { jdText, resumeText, prompts, atsTarget, mode, intensity, aggressiveness, keywordDensity, bulletLength, lockedSections, allowRetry, experimentalFastModel } = payload;
      const preset = INTENSITY_PRESETS[intensity] || null;
      const effectiveAggressiveness = preset?.aggressiveness || aggressiveness;
      const effectiveKeywordDensity = preset?.keywordDensity || keywordDensity;
      const effectiveBulletLength = preset?.bulletLength || bulletLength;
      const promptList = (prompts && prompts.length) ? prompts.map(p => `- ${p}`).join('\n') : '- (none specified)';
      const MIN_ACCEPTABLE_ATS = 85;
      const effectiveTarget = Math.max(atsTarget || 92, MIN_ACCEPTABLE_ATS);

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
      // Reframed the opening as an explicit extract-then-rewrite method:
      // pull the factual project synopsis out of each bullet first, then
      // author fresh content from those facts for the JD — rather than
      // editing the original sentence in place, which is what caused
      // titles/bullets to stay recognizably the original with a few
      // keywords swapped in.
      const system = [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You are rewriting resumes for specific job descriptions. Work in two explicit steps, not one: (1) EXTRACT — from each experience entry and the candidate's overall profile, pull out only the underlying project synopsis: the real scope of what was owned, what was actually built or delivered, the technologies genuinely used, the scale, and the measurable outcome — treat this as raw factual material, not as sentences to preserve. (2) REWRITE — using only that extracted material, write the resume from scratch so it's built to exactly fit this JD: its target function, domain, tech stack, and terminology throughout. Inserting a keyword into an otherwise-untouched original sentence is a failure, not a rewrite — every section must read as if it were authored for this JD from the facts above, not edited from the original text.

WORDING INTENSITY — the user message below carries a wording-change level (conservative / balanced / complete); it controls step (2)'s sentence-level rewriting only, not step (1) or the rules below. Conservative/balanced still require the full EXTRACT step, still require every requirement backed by DIRECT/TRANSFERABLE evidence to be worked in using the JD's own terms, still require the Skills section to be categorized by JD domain, and still require the title-framing rule below — they only mean lighter touch on sentence phrasing/structure, never skipping the underlying rebuild of what each bullet is actually saying. "Full reconstruction" above describes the complete level; treat conservative/balanced as genuinely lighter, not as a synonym for it.

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

ROLE FIT (0-100, estimate internally): 80-100 same or closely related discipline — rewrite aggressively, reorder freely; 60-79 adjacent discipline — moderate rewrite, lead with transferable strengths; below 60 meaningfully different discipline — "conservative" here means never fabricate formal experience, titles, or credentials in the new domain that the resume doesn't support, NOT leaving the rewrite shallow: still fully rebuild the summary, skills, and every bullet, dropping implementation-level detail (specific code, architecture, low-level technical tasks) entirely and re-expressing the same underlying work through whatever genuinely transferable angle exists (e.g. software engineer to project manager: no coding or application-development framing anywhere in the output — lead every bullet with delivery ownership, cross-team coordination, timeline/scope/risk management, and stakeholder communication, built only from what the original bullet actually demonstrates). If the target role differs from the resume's actual background, shift EMPHASIS, not facts (e.g. engineer to TPM means less code-level detail and more delivery/planning/stakeholder framing, built entirely from DIRECT and TRANSFERABLE evidence already present) — this includes leading each job title with the JD's target function per the REWRITE DEPTH rule above, not just the bullet content.

KEYWORD COVERAGE — hard requirement, not a stylistic suggestion
Every JD requirement backed by DIRECT or TRANSFERABLE evidence must appear using the JD's own wording, at least once, somewhere in the resume — don't omit a supported keyword for style reasons. Placement priority: Summary and most recent role first, then Technical Skills, then earlier roles.

BULLET JUSTIFICATION — every experience bullet, no exceptions
Each bullet must be traceable to a specific JD requirement. For every bullet: lead with the action using the JD's own terminology for the technology/domain/responsibility, state the scope or scale where the source supports it, and close on a concrete outcome. If a bullet cannot be tied to anything the JD asks for, cut it and write a stronger one from the same role's real evidence instead. Order bullets inside each role so the ones covering Critical/High requirements come first. Do not reuse the same leading verb more than twice across the whole resume.

PUNCTUATION — hard rule
Never use em dashes or en dashes anywhere in the resume output. Use commas, colons, or separate sentences instead. For date ranges use a plain hyphen, e.g. "Jan 2020 - Mar 2023".

PRIORITY ORDER when tensions arise: truthfulness > evidence strength > required JD coverage > recruiter readability > style polish.

BEFORE RETURNING — internal audit, do not print any of this reasoning, only the final output
1. List the JD's most important requirements with your evidence classification for each, and confirm every DIRECT/TRANSFERABLE requirement actually appears in your draft's exact wording — add any that are missing.
2. Check every changed bullet, the Skills section, and every job title against REWRITE DEPTH above — flag and rewrite any bullet that's just the original sentence with a keyword swapped in, any Skills list that's a flat uncategorized dump, and any title that still leads with a different function than what this JD is hiring for. Cut bullets that don't earn their place, merge redundant ones, then re-read only the summary and most recent role: could a recruiter identify the target role, seniority, and 2-3 core strengths in 10 seconds? If not, revise those two sections before moving on.
3. Only after this pass, assign the ATS score and breakdown honestly based on the resume you actually produced.

Respond in EXACTLY this format, nothing before or after — no markdown fences, no commentary:

ROLE_SIMILARITY: <integer 0-100>
ATS_SCORE: <integer 0-100, your honest estimate after the audit above>
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
        const resumeIdx = raw.search(/===RESUME_JSON===/i);

        if (!atsMatch || resumeIdx === -1) {
          throw new Error('Could not parse tailoring response — the model did not follow the expected format.');
        }
        const roleSimilarity = roleMatch ? Math.max(0, Math.min(100, parseInt(roleMatch[1], 10))) : 70;
        const score = Math.max(0, Math.min(100, parseInt(atsMatch[1], 10)));
        let breakdown = null;
        if (breakdownMatch) { try { breakdown = JSON.parse(breakdownMatch[1]); } catch (e) { /* optional */ } }

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
        return { resume: sanitizeResumeContent(parsedResume), atsScore: score, roleSimilarity, breakdown };
      }

      async function runPass(userContent, timeoutMs, logTag, model) {
        const raw = await callAnthropic(apiKey, userContent, { model: model || MODEL_QUALITY, maxTokens: 4096, system, timeoutMs, logTag });
        return parseTailorResponse(raw);
      }

      const baseUserContent = `Standing instructions from the candidate:
${promptList}
${styleLines.length ? '\nStyle directives for this rewrite:\n' + styleLines.map(l => `- ${l}`).join('\n') + '\n' : ''}${lockInstruction}
Target ATS score: at least ${effectiveTarget}/100 — run the internal audit from your instructions before estimating this, don't skip it.

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
      if (allowRetry !== false && best.atsScore < MIN_ACCEPTABLE_ATS && best.roleSimilarity >= 60) {
        const retryUserContent = `${baseUserContent}

Your previous attempt scored an estimated ${best.atsScore}/100, below the ${effectiveTarget} target. Redo the internal audit: specifically check for DIRECT or TRANSFERABLE requirements missing from your draft's exact wording, and add them using the JD's own terms wherever truthfully supported. Cut lower-value bullets to make room if needed. Do not fabricate anything not already grounded in the original resume — the truthfulness constraint still applies without exception.`;
        try {
          const retry = await runPass(retryUserContent, 60000, 'tailor_retry');
          if (retry.atsScore > best.atsScore) best = retry;
        } catch (e) {
          console.error('ATS retry pass failed or timed out, returning first-pass result instead:', e.message);
        }
      }

      const resultJson = { resume: best.resume, atsScore: best.atsScore, metTarget: best.atsScore >= effectiveTarget, breakdown: best.breakdown };

      // Cache the successful result under this request's content hash so a
      // duplicate submission within the window is served without spending
      // another credit or calling Anthropic again.
      try {
        await cacheRef.set({ result: resultJson, creditsRemainingAtTime: remainingAfterSpend, createdAtMs: Date.now() });
      } catch (e) {
        console.error('Failed to write tailor cache (non-fatal):', e.message);
      }

      return { json: resultJson, creditsRemaining: remainingAfterSpend };
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
  "requiredSkills": ["skill1", "skill2"],
  "preferredSkills": ["skill1"],
  "responsibilities": ["short responsibility phrase"],
  "leadership": ["leadership expectation, omit array entries if none implied"],
  "softSkills": ["communication", "ownership"],
  "techCategories": { "Cloud": ["AWS","Terraform"], "AI": [], "Security": [], "DevOps": [] },
  "matchMatrix": [ { "term": "Kafka", "status": "strong" }, { "term": "Snowflake", "status": "missing" } ],
  "missingKeywords": { "Programming": ["term"], "Cloud": ["term"], "Soft Skills": ["term"] }
}
techCategories: only include categories that are actually relevant to this JD's tech stack (skip empty/irrelevant ones — don't force all four). Add other categories beyond Cloud/AI/Security/DevOps if the JD's stack calls for it (e.g. "Frontend", "Data").
matchMatrix: cover the 6-10 most important JD requirements. status is "strong" (resume clearly demonstrates it), "partial" (adjacent/related experience but not exact), or "missing" (not evidenced in the resume at all). Base this strictly on what the resume actually says — do not assume.
missingKeywords: every term from matchMatrix with status "missing", grouped into sensible categories (only include categories that have at least one term). These are meant to be shown to the candidate as things to consider genuinely gaining or emphasizing — not fabricating.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 1600, logTag: 'jdBreakdown' });
      return { json: JSON.parse(stripJsonFence(raw)) };
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
    const { agentRunId, careerProfile, jobDescription, domainId } = payload || {};
    if (!careerProfile || !jobDescription) throw new HttpsError('invalid-argument', 'careerProfile and jobDescription are required.');

    // Load domain internals server-side — never exposed to client
    let domainContext = '';
    if (domainId) {
      const domainSnap = await db.collection('domains').doc(domainId).get();
      if (domainSnap.exists) {
        const d = domainSnap.data();
        const vocab = (d.categories || []).flatMap(c => c.skills || []).map(s => s.label).join(', ');
        const directives = (d.categories || []).flatMap(c => c.strongPoints || []).map(sp => sp.text).join('; ');
        domainContext = `\nDomain vocabulary (transferable skill synonyms): ${vocab}\nStyle directives: ${directives}`;
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
    const { agentRunId, careerProfile, jobDescription, strategy, domainId } = payload || {};
    if (!careerProfile || !jobDescription || !strategy) throw new HttpsError('invalid-argument', 'careerProfile, jobDescription, and strategy are required.');

    // Spend 1 credit for build
    const cost = 1;
    const remainingAfterSpend = await spendCreditOrThrow(uid, cost);

    // Load domain style directives server-side
    let styleDirectives = [];
    if (domainId) {
      const domainSnap = await db.collection('domains').doc(domainId).get();
      if (domainSnap.exists) {
        styleDirectives = (domainSnap.data().categories || []).flatMap(c => c.strongPoints || []).map(sp => sp.text);
      }
    }

    const groundTruth = {
      experience: (careerProfile.experience || []).map(e => ({ title: e.title, company: e.company, startDate: e.startDate, endDate: e.endDate, location: e.location })),
      education: (careerProfile.education || []).map(e => ({ school: e.school, degree: e.degree, fieldOfStudy: e.fieldOfStudy, startDate: e.startDate, endDate: e.endDate })),
      skills: (careerProfile.skills || []).map(s => s.label),
    };

    const criticalReqs = (jobDescription.requirements || []).filter(r => ['Critical', 'High'].includes(r.importance)).map(r => r.name).join(', ');
    const styleNote = styleDirectives.slice(0, 4).join('; ');
    const priorityEmployers = (strategy.experiencePriority || []).filter(e => e.level === 'Very High' || e.level === 'High').map(e => e.employer).join(', ');

    const systemPrompt = [{
      type: 'text',
      cache_control: { type: 'ephemeral' },
      text: `You are building a fully tailored resume. EXTRACT project synopses from ground truth, then REWRITE from scratch for the target role. Never invent employers, dates, or credentials not in the ground truth. Use STAR-shaped bullets with metrics where truthfully supported. No buzzwords.

BULLET REBUILD - apply to every single experience bullet, no exceptions
Do not carry over generic duties. Rebuild each bullet from the underlying project synopsis so it visibly answers a requirement in this JD:
- Lead with the action and the JD's own terminology for the technology, domain, or responsibility involved, wherever the candidate's real evidence supports it.
- State the scope or scale (users, volume, regions, team size, systems) and close with a measurable or concrete outcome whenever the ground truth supports one. Never invent a number.
- Every bullet must be traceable to a JD requirement. If a bullet cannot be tied to anything the JD asks for, cut it and write a stronger one from the same role's real evidence instead.
- Order bullets within each role so the ones matching Critical/High requirements come first.
- Do not reuse the same leading verb more than twice across the whole resume.

PUNCTUATION - hard rule
Never use em dashes or en dashes anywhere in the output. Use commas, colons, or separate sentences instead. For date ranges use a plain hyphen, e.g. "Jan 2020 - Mar 2023".

Respond in EXACTLY this JSON format, nothing else:
{
  "name": "candidate name",
  "contact": "phone | email | linkedin | location",
  "sections": [
    { "heading": "PROFESSIONAL SUMMARY", "paragraphs": ["2-3 sentence summary"] },
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
CRITICAL REQUIREMENTS: ${criticalReqs}
PRIORITY EMPLOYERS TO LEAD WITH: ${priorityEmployers || 'all'}
POSITIONING: ${strategy.positioning || ''}
SKILLS TO HIGHLIGHT: ${(strategy.skillPriority || []).slice(0, 8).join(', ')}
${styleNote ? `STYLE DIRECTIVES: ${styleNote}` : ''}`;

    const raw = await callAnthropic(apiKey, userPrompt, {
      model: MODEL_QUALITY, maxTokens: 4096, system: systemPrompt,
      timeoutMs: 120000, logTag: 'agentBuild'
    });

    const content = sanitizeResumeContent(JSON.parse(stripJsonFence(raw)));

    // Score match against requirements
    const contentText = JSON.stringify(content).toLowerCase();
    const requirementMatches = (jobDescription.requirements || []).map(req => {
      const needle = req.name.toLowerCase();
      const mentions = (contentText.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      return { name: req.name, importance: req.importance, mentionCount: req.mentionCount, evidenceStrength: mentions >= 2 ? 'STRONG' : mentions === 1 ? 'WEAK' : 'MISSING', mentions };
    });
    const strong = requirementMatches.filter(m => m.evidenceStrength === 'STRONG').length;
    const weak = requirementMatches.filter(m => m.evidenceStrength === 'WEAK').length;
    const total = requirementMatches.length || 1;
    const matchScore = Math.round(((strong + weak * 0.5) / total) * 100);

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
    const versionId = 'rv_' + Date.now();
    const versionData = {
      id: versionId, agentRunId: agentRunId || null,
      versionNumber: 1, label: 'Initial Agent build',
      content, matchScore,
      scoreBreakdown: { keywordCoverage: matchScore, experienceRelevance: matchScore - 5, impactMetrics: 65, roleAlignment: matchScore, formatting: 95, leadership: 75 },
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

  // ---- TASK: domainAdmin — CRUD for domains (admin-only) ----
  if (task === 'domainAdmin') {
    requireAdmin(request);
    const { action, domainId, data } = payload || {};

    if (action === 'create') {
      const ref = db.collection('domains').doc();
      await ref.set({ name: data.name, summary: data.summary, status: 'draft', categories: [], createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return { id: ref.id };
    }
    if (action === 'update') {
      await db.collection('domains').doc(domainId).set(data, { merge: true });
      return { ok: true };
    }
    if (action === 'publish') {
      await db.collection('domains').doc(domainId).set({ status: data.status }, { merge: true });
      return { ok: true };
    }
    if (action === 'delete') {
      await db.collection('domains').doc(domainId).delete();
      return { ok: true };
    }
    if (action === 'list') {
      const snap = await db.collection('domains').get();
      return { domains: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }
    throw new HttpsError('invalid-argument', `Unknown domainAdmin action: ${action}`);
  }

  throw new HttpsError('invalid-argument', `Unknown agent task: ${task}`);
});
