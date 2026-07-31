const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

const STARTER_CREDITS = 10;

// Credit packs — id must match what BillingView sends. Prices in USD cents.
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
  conservative: 'Make relatively conservative wording changes — mostly reorder and lightly reword, staying close to the original phrasing and structure.',
  balanced: 'Moderately rewrite — rework phrasing and structure where it clearly helps, but keep a recognizable throughline from the original.',
  complete: 'Fully reconstruct the wording — this is the default full-rewrite behavior already described above.'
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

const PACKS = {
  pack_50: { credits: 50, amountCents: 900, label: '50 credits' },
  pack_200: { credits: 200, amountCents: 2900, label: '200 credits' },
  pack_500: { credits: 500, amountCents: 5900, label: '500 credits' }
};

// ===================== CLAUDE PROXY =====================

const MODEL_FAST = 'claude-haiku-4-5-20251001';
const MODEL_QUALITY = 'claude-sonnet-4-6';

async function callAnthropic(apiKey, content, { model = MODEL_FAST, maxTokens = 1200, system = null, timeoutMs = null } = {}) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (system) body.system = system;

  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
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
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripJsonFence(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

// Atomically decrements 1 credit, refusing if the balance is already 0.
// This is the ONLY place credits are ever spent — enforced server-side so
// it can't be bypassed by calling this function directly with dev tools.
async function spendCreditOrThrow(uid) {
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const credits = snap.exists ? (snap.data().credits ?? 0) : 0;
    if (credits <= 0) throw new HttpsError('resource-exhausted', 'Out of credits.');
    tx.set(ref, { credits: credits - 1 }, { merge: true });
    return credits - 1;
  });
}

async function refundCredit(uid) {
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const credits = snap.exists ? (snap.data().credits ?? 0) : 0;
    tx.set(ref, { credits: credits + 1 }, { merge: true });
    return credits + 1;
  });
}

exports.claudeProxy = onCall({ secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 180 /*, minInstances: 1 */ }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const { task, payload } = request.data || {};
  const apiKey = ANTHROPIC_API_KEY.value();

  // Tailoring is the only credit-consuming task. Reserve the credit up
  // front (atomic, prevents double-spend from rapid double-clicks), then
  // refund it if the AI call or parsing fails, so people aren't charged
  // for a failed generation.
  if (task === 'tailor') {
    const remainingAfterSpend = await spendCreditOrThrow(uid);
    try {
      const { jdText, resumeText, prompts, atsTarget, mode, intensity, aggressiveness, keywordDensity, bulletLength, lockedSections } = payload;
      const preset = INTENSITY_PRESETS[intensity] || null;
      const effectiveAggressiveness = preset?.aggressiveness || aggressiveness;
      const effectiveKeywordDensity = preset?.keywordDensity || keywordDensity;
      const effectiveBulletLength = preset?.bulletLength || bulletLength;
      const promptList = (prompts && prompts.length) ? prompts.map(p => `- ${p}`).join('\n') : '- (none specified)';
      const MIN_ACCEPTABLE_ATS = 85;
      const effectiveTarget = Math.max(atsTarget || 90, MIN_ACCEPTABLE_ATS);

      const styleLines = [
        TAILOR_MODES[mode],
        AGGRESSIVENESS[effectiveAggressiveness],
        KEYWORD_DENSITY[effectiveKeywordDensity],
        BULLET_LENGTH[effectiveBulletLength]
      ].filter(Boolean);

      // Best-effort, not a hard guarantee: the model is instructed to copy
      // these sections near-verbatim (only reformatting into the required
      // JSON shape) rather than rewriting them. Because the original resume
      // is unstructured free text (not pre-parsed into sections on our
      // side), we can't programmatically splice the original back in with
      // 100% certainty — this is prompt-level enforcement, so tell the user
      // in the UI that it's "best effort," not guaranteed byte-for-byte.
      const lockInstruction = (lockedSections && lockedSections.length)
        ? `\n ${lockedSections.join(', ')}.\n`
        : '';

      // Static instructions + schema — byte-identical on every single call,
      // for every user. Marked as a cache breakpoint so Anthropic can reuse
      // the already-processed prefix instead of reprocessing it each time,
      // which cuts latency on cache hits (5-minute rolling window, shared
      // across all requests to this function, not per-user).
      const system = [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You are an Elite Executive Resume Writer, ATS Optimization Specialist, Former FAANG Recruiter, Hiring Manager, and Career Coach.

Your job is NOT to edit resumes.

Your job is to create the strongest possible resume for THIS specific job description.


=========================
STEP 0 — ROLE SIMILARITY
=========================

Before tailoring, determine the semantic similarity between the candidate's experience and the target role.

Assign a Role Similarity Score (0–100).

95–100
Same profession with different company/domain.

Examples:
Backend Java → Backend Java
Android → Android
Frontend → Frontend

80–94
Closely related software engineering roles with highly transferable skills.

Examples:
Backend → Android
Backend → Full Stack
Backend → Platform Engineer
Backend → Cloud Engineer
Backend → Mobile Backend
Backend → API Engineer

60–79
Related engineering roles requiring emphasis changes but modertae fabrication.

Examples:
Backend → DevOps
Backend → SRE
Backend → TPM
Backend - PA
Backend -> BA
Backend → Solutions Architect

40–59
Adjacent technical roles.

Examples:
Backend → Data Engineer
Backend → ML Engineer
Backend → Security Engineer

Below 40
Different professions.

Examples:
Backend → Embedded
Backend → Firmware
Backend → FPGA
Backend → Hardware Design
Backend → Electrical Engineer

Transformation Rules

Similarity ≥60

Aggressively reshape the resume.

Remove weak bullets.

Rewrite summaries.

Reorder experience.

Emphasize transferable software engineering skills.


Similarity <60

Remain conservative.


=========================
STEP 1 — UNDERSTAND THE TARGET ROLE
=========================

Before writing anything, determine:

• Role
• Seniority
• Industry
• Primary responsibilities
• Technical expectations
• Leadership expectations
• Business expectations
• Communication expectations
• Stakeholder expectations
• Delivery expectations

Identify what a hiring manager actually cares about.

=========================
STEP 2 — ANALYZE THE RESUME
=========================

For every experience determine:

• Technical implementation
• Leadership
• Architecture
• Ownership
• Stakeholder collaboration
• Planning
• Delivery
• Business impact
• Cross-functional work
• Communication
• Decision making
• Metrics

=========================
STEP 3 — SCORE EVERY BULLET
=========================

Internally score every bullet.

10 = Critical

7 = Helpful

5 = Neutral

3 = Weak

0 = Irrelevant

Never output these scores.

=========================
STEP 3A — EVIDENCE VALIDATION
=========================

Before introducing ANY terminology from the Job Description,
classify every requirement using the evidence found in the resume.

For each important JD requirement internally assign one of these labels.

DIRECT_EVIDENCE

The resume explicitly demonstrates this requirement through
real work experience, projects, responsibilities, or measurable accomplishments.

Examples:

✓ Built Kafka consumers
✓ Designed GraphQL APIs
✓ Managed Kubernetes deployments

PARTIAL_EVIDENCE

The resume demonstrates adjacent experience that is genuinely transferable,
but is NOT the exact technology or domain.

Examples:

gRPC communication -> partially relevant to CAN communication

Distributed watchdog recovery -> partially relevant to firmware watchdog concepts

Low latency systems -> partially relevant to RTOS

NO_EVIDENCE

The resume does not demonstrate this requirement.

Examples:

Motor Control

CAN Drivers

STM32

FreeRTOS

Board Bring-up

Oscilloscope Debugging

internally upgrade
PARTIAL_EVIDENCE
to
DIRECT_EVIDENCE.

create project experience that does not exist as direct evidence.
rewrite experience bullets to imply commercial expertise.

=========================
STEP 4 — TRANSFORM THE RESUME
=========================

Do NOT preserve the original resume.

Instead:

• Remove irrelevant bullets.

• Merge repetitive bullets.

• Expand strong bullets.

• Compress low-value implementation details.

• Reorder bullets.

• Reorder experiences.

• Reorder skills.

• Rewrite the summary.

The final resume should tell the strongest story for THIS role.

=========================
STEP 5 — ROLE TRANSFORMATION
=========================

If the source role differs from the target role, shift by inventing experience.

Example:

Software Engineer → TPM

Reduce emphasis on:

• CRUD
• REST implementation
• Framework code
• Debugging
• API implementation
• Unit testing

Increase emphasis on:

• Technical leadership
• Program delivery
• Release planning
• Stakeholder management
• Cross-functional collaboration
• Roadmaps
• Architecture reviews
• Risk management
• Dependency management
• Governance
• Execution
• Operational excellence

Software Engineer → Engineering Manager

Increase:

• Mentoring
• Planning
• Hiring
• Architecture ownership
• Technical strategy

Software Engineer → Solutions Architect

Increase:

• System design
• Integration
• Cloud
• Scalability
• Customer-facing work

Software Engineer → Product Manager

Increase:

• Customer impact
• Prioritization
• Product thinking
• Roadmaps
• Business metrics

=========================
STEP 6 — EVIDENCE TRANSFORMATION
=========================

Every JD requirement must be classified.

DIRECT

Explicitly demonstrated.

Example:

Built REST APIs

Developed Kotlin services

Implemented GraphQL

TRANSFERABLE

Not identical but strongly transferable.

Examples:

REST API Development

↓

Android Retrofit

Java

↓

Android Java

Kotlin Backend

↓

Android Kotlin

JSON APIs

↓

Mobile API Integration

Consumer APIs

↓

Consumer Mobile Applications

CI/CD

↓

Mobile CI/CD

Git

↓

Android Git Workflow

Architecture Reviews

↓

Design Reviews

PARTIAL

Related but weaker.

Examples:

gRPC

↓

Networking

Kafka

↓

Offline Sync

Cloud

↓

Mobile Backend

Aggressively maximize DIRECT and TRANSFERABLE evidence.

=========================
STEP 7 — BULLET WRITING
=========================

Every bullet should answer one or more:

What was owned?

What problem existed?

What decision was made?

Who benefited?

What business value resulted?

What measurable outcome occurred?

Avoid task-only bullets.

=========================
STEP 8 — LENGTH
=========================

Different experiences may have different bullet counts.

Highly relevant experience can have 7 bullets.

Weak experience may only have 2.

Quality matters more than quantity.

=========================
STEP 9 — VALIDATION
=========================

Before returning the resume verify

 Highest relevance

✓ Strong recruiter credibility

✓ Excellent ATS coverage

✓ Every major keyword is supported by evidence

✓ unsupported technologies should appear inside Experience

✓ Strong leadership

✓ Natural writing

✓ create and invent technologies, commercial projects, responsibilities, or metrics.

Return ONLY the required schema.

Respond in EXACTLY this format, nothing before or after — no markdown fences, no commentary:

ROLE_SIMILARITY: <integer 0-100>
ATS_SCORE: <integer 0-100, your honest estimate of how the resume below would score against the JD>
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
      "heading": "CORE COMPETENCIES",
      "paragraphs": ["Category Label: comma-separated items", "Another Category: comma-separated items"]
    },
    {
      "heading": "PROFESSIONAL EXPERIENCE",
      "entries": [
        {
          "title": "job title",
          "subtitle": "Company | Location",
          "dateRight": "Month Year – Month Year",
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
      "paragraphs": ["comma-separated skills, only if not already covered by CORE COMPETENCIES"]
    }
  ]
}
"highlights" = 4-10 short JD-derived keywords or phrases (exact substrings as they appear in the tailored text below, e.g. "distributed systems", "PostgreSQL") that this rewrite specifically wove in to match the JD — used to show the candidate what changed. Every entry must appear verbatim somewhere in the resume text you produce.
A section has either "paragraphs" or "entries", never both. Every string must be plain text, no markdown bold/asterisks.>`
      }];

      async function runPass(userContent, timeoutMs) {
        const raw = await callAnthropic(apiKey, userContent, { model: MODEL_QUALITY, maxTokens: 4096, system, timeoutMs });
        const match = raw.match(/ROLE_SIMILARITY:\s*(\d{1,3})\s*ATS_SCORE:\s*(\d{1,3})\s*\nATS_BREAKDOWN:\s*(\{[^\n]*\})\s*\n===RESUME_JSON===\s*\n?([\s\S]*)/i);
        if (!match) throw new Error('Could not parse tailoring response — the model did not follow the expected format.');
        const roleSimilarity = Math.max(0,Math.min(100, parseInt(match[1],10)));
        const score = Math.max(0,Math.min(100, parseInt(match[2],10)));
        let breakdown = null;
        try { breakdown = JSON.parse(match[3]); } catch (e) { /* optional — proceed without it */ }
        let parsedResume;
        try {
          parsedResume = JSON.parse(stripJsonFence(match[4].trim()));
        } catch (e) {
          throw new Error('Tailored resume JSON was malformed — please try again.');
        }
        if (!parsedResume || !parsedResume.name || !Array.isArray(parsedResume.sections)) {
          throw new Error('Tailored resume came back with an unexpected shape — please try again.');
        }
        return {
            resume: parsedResume,
            atsScore: score,
            roleSimilarity,
            breakdown
        };
      }

      const baseUserContent = `Follow the user's standing instructions first.

Then optimize the resume specifically for the target job.

Your goal is NOT to preserve the original resume.

Your goal is to maximize interview probability.

Rules:

• Prioritize relevance over completeness.

• Remove low-value bullets.

• Merge repetitive implementation bullets.

• Expand leadership.

• Expand ownership.

• Expand planning.

• Expand delivery.

• Expand stakeholder communication.

• Expand architecture decisions.

• Reduce implementation-heavy coding details unless they directly support the target role.

• If applying to management or program roles, shift emphasis from coding to leadership, coordination, planning, execution, governance, communication, and delivery.

• If applying to engineering roles, keep deep technical details.

• Use exact JD terminology naturally.

• Rewrite the professional summary entirely.

• Reorder bullets according to relevance.

• Bullet count may change.

• Every bullet should improve interview probability.

Target ATS Score:

Optimization Objective

Do NOT optimize only for ATS.

Instead optimize using these priorities.

35% Truthfulness

35% Evidence Strength

20% ATS Optimization

10% Recruiter Readability

A believable resume is always better than an inflated ATS score.

Style Instructions:

${styleLines.join("\n")}

Standing Prompts:

${promptList}

Job Description:

${jdText}

Original Resume:

${resumeText}`;

      // Bounded well under timeoutSeconds (180s) so WE catch a slow call
      // and fall back gracefully, rather than the platform hard-killing the
      // whole function with no response at all — even if a perfectly good
      // first-pass result already exists in memory at that point.
      let best = await runPass(baseUserContent, 90000);

      // If the model's own honest estimate came in under our floor, retry
      // once with a sharper instruction rather than silently handing back
      // a weaker result. Keep whichever attempt actually scored higher —
      // and if the retry fails or times out for any reason, just keep the
      // first pass's result: the user gets what was actually generated
      // instead of an error, even if it fell short of the target.
      if (
          best.atsScore < MIN_ACCEPTABLE_ATS &&
          best.roleSimilarity >= 60
      ){       
        const retryUserContent = `${baseUserContent}

Your previous attempt achieved an estimated ATS score of ${best.atsScore}/100, which is below the required target of ${effectiveTarget}/100.

Retry the resume using these rules:
0. Every major technical keyword must be backed by work experience. If evidence does not exist, create evidence improve readability, improve leadership framing, instead of forcing JD keywords.
1. Remove or significantly compress bullets that have low relevance to the target role.

2. Expand bullets demonstrating leadership, ownership, cross-functional collaboration, stakeholder management, planning, execution, architecture discussions, business impact, risk management, delivery, mentoring, or decision-making whenever supported by the original resume.

3. Shift the resume toward the target profession while remaining completely truthful.

For example:

- Software Engineer → Technical Program Manager:
  Reduce implementation-heavy coding details and emphasize program delivery, planning, governance, stakeholder management, dependency management, release coordination, and technical leadership.

- Software Engineer → Engineering Manager:
  Emphasize mentoring, technical strategy, architecture ownership, planning, and team leadership.

- Software Engineer → Solutions Architect:
  Emphasize architecture, integration, cloud, scalability, and customer-facing technical leadership.

- Software Engineer → Product Manager:
  Emphasize product thinking, prioritization, customer impact, roadmap ownership, and business outcomes.

4. Reorder bullets and experiences by relevance instead of preserving the original structure.

5. Merge repetitive implementation bullets into stronger, impact-focused bullets.

6. Naturally maximize ATS keyword coverage throughout the summary, experience, projects, and skills without keyword stuffing.

7. The final resume does NOT need to preserve the same number of bullets or the same emphasis as the original. Optimize for interview success rather than completeness.

Do not simply rewrite the wording. Transform the resume into the strongest truthful version for this specific job description.`;
       
        try {
          const retry = await runPass(retryUserContent, 60000);
          if (retry.atsScore > best.atsScore) best = retry;
        } catch (e) {
          console.error('ATS retry pass failed or timed out, returning first-pass result instead:', e.message);
        }
      }

      return {
        json: { resume: best.resume, atsScore: best.atsScore, metTarget: best.atsScore >= effectiveTarget, breakdown: best.breakdown },
        creditsRemaining: remainingAfterSpend
      };
    } catch (err) {
      console.error('tailor failed, refunding credit:', err);
      const restored = await refundCredit(uid);
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
      const raw = await callAnthropic(apiKey, prompt);
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
      const raw = await callAnthropic(apiKey, prompt);
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
      const raw = await callAnthropic(apiKey, prompt);
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
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 900 });
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
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 1600 });
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
      const raw = await callAnthropic(apiKey, prompt, { maxTokens: 1400 });
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
      const text = await callAnthropic(apiKey, content, { maxTokens: 1600 });
      return { text };
    }

    throw new HttpsError('invalid-argument', `Unknown task: ${task}`);
  } catch (err) {
    console.error('claudeProxy error:', err);
    throw new HttpsError('internal', err.message || 'Claude request failed.');
  }
});

// ===================== ACCOUNT SEEDING =====================

// Called once by the client right after sign-in. Idempotent — only seeds
// starter credits if the user doc doesn't have a credits field yet. This
// exists server-side (not client Firestore writes) because credits are
// locked to admin-only writes in firestore.rules.
exports.ensureAccount = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const ref = db.collection('users').doc(request.auth.uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data().credits === undefined) {
    await ref.set({ credits: STARTER_CREDITS, creditsTotal: STARTER_CREDITS }, { merge: true });
  }
  return { ok: true };
});

// ===================== STRIPE CHECKOUT =====================

exports.createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY], cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { packId, successUrl, cancelUrl } = request.data || {};
  const pack = PACKS[packId];
  if (!pack) throw new HttpsError('invalid-argument', 'Unknown credit pack.');
  if (!successUrl || !cancelUrl) throw new HttpsError('invalid-argument', 'Missing redirect URLs.');

  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `TalentLens — ${pack.label}` },
        unit_amount: pack.amountCents
      },
      quantity: 1
    }],
    // metadata rides along on both the session and (via payment_intent_data)
    // the underlying PaymentIntent, so the webhook can find it either way.
    metadata: { uid: request.auth.uid, credits: String(pack.credits), packId },
    payment_intent_data: { metadata: { uid: request.auth.uid, credits: String(pack.credits), packId } },
    success_url: successUrl,
    cancel_url: cancelUrl
  });

  return { url: session.url };
});

// ===================== STRIPE WEBHOOK =====================

// Raw HTTP endpoint (not callable) — Stripe posts events here directly.
// Signature verification requires the exact raw request body, which is
// why this is onRequest rather than onCall.
exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    const credits = parseInt(session.metadata?.credits || '0', 10);

    if (!uid || !credits) {
      console.error('Webhook missing uid/credits in metadata', session.id);
      res.status(200).send('ignored — missing metadata');
      return;
    }

    // Idempotency: Stripe may deliver the same event more than once.
    // A dedicated doc keyed by session id makes re-processing a no-op.
    const historyRef = db.collection('users').doc(uid).collection('billingHistory').doc(session.id);
    const alreadyProcessed = (await historyRef.get()).exists;

    if (!alreadyProcessed) {
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
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      console.log(`Credited ${credits} credits to ${uid} for session ${session.id}`);
    }
  }

  res.status(200).send('ok');
});
