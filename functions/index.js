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
      const { jdText, resumeText, prompts, atsTarget } = payload;
      const promptList = (prompts && prompts.length) ? prompts.map(p => `- ${p}`).join('\n') : '- (none specified)';
      const MIN_ACCEPTABLE_ATS = 85;
      const effectiveTarget = Math.max(atsTarget || 90, MIN_ACCEPTABLE_ATS);

      // Static instructions + schema — byte-identical on every single call,
      // for every user. Marked as a cache breakpoint so Anthropic can reuse
      // the already-processed prefix instead of reprocessing it each time,
      // which cuts latency on cache hits (5-minute rolling window, shared
      // across all requests to this function, not per-user).
      const system = [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You are rewriting resumes for specific job descriptions — not lightly editing them, but reconstructing them entirely: rebuilding the summary, reordering and rewriting every bullet, adopting the JD's own terminology and priorities throughout. Use strong, varied action verbs. Never carry over generic or weak phrasing — reword it. Don't preserve the original bullet order or grouping if the JD's priorities suggest a different structure.

The one constraint: every fact must stay grounded in the original resume provided by the user. Never invent employers, titles, dates, tools, or metrics that aren't in the original. Reframing, reprioritizing, and rewording are expected and encouraged; fabricating is not.

Respond in EXACTLY this format, nothing before or after — no markdown fences, no commentary:

ATS_SCORE: <integer 0-100, your honest estimate of how the resume below would score against the JD>
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
Include only the sections that make sense for this resume's actual content — don't invent sections. A section has either "paragraphs" or "entries", never both. Every string must be plain text, no markdown bold/asterisks.>`
      }];

      async function runPass(userContent, timeoutMs) {
        const raw = await callAnthropic(apiKey, userContent, { model: MODEL_QUALITY, maxTokens: 4096, system, timeoutMs });
        const match = raw.match(/ATS_SCORE:\s*(\d{1,3})\s*\n===RESUME_JSON===\s*\n?([\s\S]*)/i);
        if (!match) throw new Error('Could not parse tailoring response — the model did not follow the expected format.');
        const score = Math.max(0, Math.min(100, parseInt(match[1], 10)));
        let parsedResume;
        try {
          parsedResume = JSON.parse(stripJsonFence(match[2].trim()));
        } catch (e) {
          throw new Error('Tailored resume JSON was malformed — please try again.');
        }
        if (!parsedResume || !parsedResume.name || !Array.isArray(parsedResume.sections)) {
          throw new Error('Tailored resume came back with an unexpected shape — please try again.');
        }
        return { resume: parsedResume, atsScore: score };
      }

      const baseUserContent = `Follow these standing instructions from the candidate:
${promptList}

Target ATS score: at least ${effectiveTarget}/100 against the job description below — treat this as a hard floor, not an aspiration. Before finalizing, mentally check that every major skill, tool, and qualification the JD asks for that the candidate's original resume actually supports somewhere is explicitly present in your rewrite's wording — don't leave ATS-relevant terms only implied.

JOB DESCRIPTION:
${jdText}

ORIGINAL RESUME:
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
      if (best.atsScore < MIN_ACCEPTABLE_ATS) {
        const retryUserContent = `${baseUserContent}

Your first attempt at this only reached an estimated ${best.atsScore}/100 against this JD, which is below the required ${effectiveTarget}. Try again, and this time be more aggressive about weaving in the JD's specific terminology, required tools, and keywords throughout the summary and bullets — not just the skills section. Stay within the same truthfulness constraint (no fabricated facts), but push harder on phrasing, emphasis, and keyword coverage than the first attempt did.`;
        try {
          const retry = await runPass(retryUserContent, 60000);
          if (retry.atsScore > best.atsScore) best = retry;
        } catch (e) {
          console.error('ATS retry pass failed or timed out, returning first-pass result instead:', e.message);
        }
      }

      return {
        json: { resume: best.resume, atsScore: best.atsScore, metTarget: best.atsScore >= effectiveTarget },
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
      const { jdText, resumeText, company, contactName, senderName } = payload;
      const prompt = `Write a short, professional job application email. Return ONLY raw JSON, no markdown fences: {"subject":"...", "body":"..."}
Recipient name: ${contactName}
Company: ${company}
Sender name: ${senderName}
Keep body under 120 words, reference 1-2 specific things from the resume that match the JD, end with the sender's name on its own line. Do not include a "Subject:" line inside body.

JOB DESCRIPTION:
${jdText}

TAILORED RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt);
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
