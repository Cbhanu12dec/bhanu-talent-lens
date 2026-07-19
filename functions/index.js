const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// Set once with: firebase functions:secrets:set ANTHROPIC_API_KEY
// Never exposed to the browser — only read here, server-side.
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Two tiers: Haiku is much faster for OCR/analysis/email drafting, which
// don't need deep reasoning. Tailoring gets Sonnet, since resume rewriting
// quality matters more there than shaving a couple seconds off.
const MODEL_FAST = 'claude-haiku-4-5-20251001';
const MODEL_QUALITY = 'claude-sonnet-4-6';

async function callAnthropic(apiKey, content, { model = MODEL_FAST, maxTokens = 1200 } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }]
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

function stripJsonFence(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

// minInstances: 1 keeps one instance warm at all times, eliminating cold
// starts entirely — at the cost of paying for that idle instance even when
// nobody's using the app. Uncomment if the cold-start delay bothers you
// more than the extra few dollars/month. Leave commented to save cost.
exports.claudeProxy = onCall({ secrets: [ANTHROPIC_API_KEY], cors: true /*, minInstances: 1 */ }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const { task, payload } = request.data || {};
  const apiKey = ANTHROPIC_API_KEY.value();

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

    if (task === 'tailor') {
      const { jdText, resumeText, prompts, atsTarget } = payload;
      const promptList = (prompts && prompts.length) ? prompts.map(p => `- ${p}`).join('\n') : '- (none specified)';
      const prompt = `You are rewriting this resume from scratch for a specific job description — not lightly editing it. Rebuild the summary, reorder and rewrite every bullet, and adopt the JD's own terminology and priorities throughout, so it would score at least ${atsTarget || 90}/100 against an ATS keyword-matching system for this JD. Use strong, varied action verbs. Do not carry over generic or weak phrasing from the original — reword it. Do not preserve the original bullet order or grouping if the JD's priorities suggest a different structure.

The one constraint: every fact must stay grounded in the original resume. Do not invent employers, titles, dates, tools, or metrics that aren't in the original. Reframing, reprioritizing, and rewording are expected and encouraged; fabricating is not.

Follow these standing instructions from the candidate:
${promptList}

Respond in EXACTLY this format, nothing before or after — no markdown fences, no commentary:

ATS_SCORE: <integer 0-100, your honest estimate of how the resume below would score against this JD>
===RESUME_JSON===
<a single JSON object with this exact shape — real JSON, not a string containing JSON:
{
  "name": "candidate full name",
  "contact": "phone | email | linkedin | location — pipe-separated, only fields present in the original",
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
Include only the sections that make sense for this resume's actual content — don't invent sections. A section has either "paragraphs" or "entries", never both. Every string must be plain text, no markdown bold/asterisks.>

JOB DESCRIPTION:
${jdText}

ORIGINAL RESUME:
${resumeText}`;
      const raw = await callAnthropic(apiKey, prompt, { model: MODEL_QUALITY, maxTokens: 4096 });

      const match = raw.match(/ATS_SCORE:\s*(\d{1,3})\s*\n===RESUME_JSON===\s*\n?([\s\S]*)/i);
      if (!match) {
        throw new Error('Could not parse tailoring response — the model did not follow the expected format.');
      }
      const atsScore = Math.max(0, Math.min(100, parseInt(match[1], 10)));
      let resume;
      try {
        resume = JSON.parse(stripJsonFence(match[2].trim()));
      } catch (e) {
        throw new Error('Tailored resume JSON was malformed — please try again.');
      }
      if (!resume || !resume.name || !Array.isArray(resume.sections)) {
        throw new Error('Tailored resume came back with an unexpected shape — please try again.');
      }
      return { json: { resume, atsScore } };
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
      const { base64, mediaType } = payload;
      const content = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Transcribe the job description text shown in this image exactly, plain text, no commentary.' }
      ];
      const text = await callAnthropic(apiKey, content, { maxTokens: 1200 });
      return { text };
    }

    throw new HttpsError('invalid-argument', `Unknown task: ${task}`);
  } catch (err) {
    console.error('claudeProxy error:', err);
    throw new HttpsError('internal', err.message || 'Claude request failed.');
  }
});
