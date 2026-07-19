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

  const promptList =
    (prompts && prompts.length)
      ? prompts.map(p => `- ${p}`).join('\n')
      : '- (none specified)';

  const prompt = `
You are one of the world's best executive resume writers and ATS optimization experts.

Your objective is NOT to lightly edit this resume.

Your objective is to completely rebuild it so it appears as if it was originally written specifically for this job description.

Optimize the resume to maximize ATS keyword coverage while remaining 100% truthful.

========================
PRIMARY GOALS
========================

• Rewrite EVERY sentence.
• Rewrite EVERY bullet.
• Rewrite EVERY section.
• Do NOT preserve the wording of the original resume.
• Target less than 20% wording overlap with the original.
• Use strong, varied action verbs.
• Use concise, professional language.
• Make the resume read naturally instead of keyword stuffing.
• Preserve every factual detail.

========================
ATS OPTIMIZATION
========================

Analyze the Job Description first.

Extract the most important:

- technical skills
- frameworks
- cloud platforms
- methodologies
- leadership qualities
- business terminology
- action verbs


Prefer the Job Description wording over synonyms.

Increase keyword coverage as much as possible without fabricating anything.

========================
REWRITE INTENSITY
========================

Treat the original resume as a rough draft.

Your mission is to produce a resume that looks like it was written by a senior FAANG resume writer.

Aggressively improve:

• summary
• bullet quality
• impact
• readability
• keyword placement
• ordering
• section organization

Do NOT simply paraphrase.

Completely rewrite.

========================
REORDERING
========================

You MAY:

• reorder sections
• reorder jobs
• reorder bullets
• merge bullets
• split bullets
• remove weak bullets
• emphasize more relevant accomplishments
• move relevant technologies closer to the top

The final resume should prioritize the experience most relevant to this job.

========================
SUMMARY
========================

Create a brand-new professional summary.

It should:

• immediately match this job
• naturally include important keywords
• highlight the strongest qualifications
• avoid generic buzzwords

========================
CORE COMPETENCIES
========================

Completely rebuild the Core Competencies section.

Do NOT preserve the original categories.

Create new competency categories that best match the Job Description.

Use the exact terminology from the Job Description whenever supported by the candidate's experience.

Order the categories from most relevant to least relevant.

Within each category, order skills by relevance to the Job Description.

You MAY:

• rename categories
• merge categories
• split categories
• reorder categories
• move technologies between categories
• remove duplicate technologies
• prioritize technologies appearing in the Job Description

Example categories include:

Backend Development
Programming Languages
Cloud Platforms
Microservices
API Technologies
Architecture
Messaging
Databases
DevOps
CI/CD
Observability
Testing
Security
Frontend Technologies
Developer Tools

Only include technologies, tools, methodologies, frameworks, platforms, or concepts that are supported by the candidate's resume.

The Core Competencies section should look as though it was written specifically for this Job Description.

========================
EXPERIENCE
========================

Completely rebuild every experience entry.

Every bullet must be newly written.

Never copy wording from the original resume.

Use the original resume only as the factual source.

For every role:

- Identify the accomplishments most relevant to the Job Description.
- Rewrite every bullet using stronger action verbs.
- Expand concise bullets into richer accomplishment statements when the original facts support it.
- Combine multiple related bullets into a stronger impact-focused bullet where appropriate.
- Split broad bullets into multiple focused bullets where it improves readability.
- Reorder bullets so the most relevant accomplishments appear first.
- Use the exact terminology from the Job Description whenever it accurately reflects the candidate's experience.
- Emphasize measurable outcomes, technical depth, leadership, architecture, scalability, reliability, performance, or business impact whenever those are supported by the original resume.
- Job titles should be rewritten into equivalent jd relevent titles if they accurately describe the same role.

If the original resume implies experience that is only briefly mentioned, you may elaborate on that experience in greater detail, provided every statement remains consistent with the original facts.

========================
SKILLS
========================

Completely rebuild the Skills section.

Do NOT preserve the original ordering.

Do NOT preserve the original grouping.

Use the Job Description to determine which skills should appear first.

Include only skills that are supported by the candidate's resume.

Use the exact wording from the Job Description whenever possible.

Remove duplicate skills that already appear in Core Competencies unless they improve ATS coverage.

Organize the skills naturally for recruiters and ATS systems.

Prioritize the following order:

1. Required Skills
2. Preferred Skills
3. Supporting Technologies
4. Tools
5. Methodologies

The Skills section should appear as though it was written specifically for this Job Description.

========================
LENGTH
========================

Maintain approximately the same resume length.

Do not shorten simply to make it concise.


========================
INTERNAL THINKING
========================

Before generating the resume:

1. Analyze the Job Description.
2. Extract the top ATS keywords.
3. Rank the candidate's experience by relevance.
4. Decide the optimal section ordering.
5. Rewrite the entire resume.
6. Verify every important JD keyword has been incorporated wherever truthfully possible.
7. Estimate the ATS score.

Do NOT output these internal steps.

========================
CANDIDATE PREFERENCES
========================

${promptList}

========================
OUTPUT FORMAT
========================

Respond in EXACTLY this format.

No markdown.

No commentary.

No explanations.

ATS_SCORE: <integer 0-100, your honest estimate after optimization>

===RESUME_JSON===

{
  "name": "candidate full name",
  "contact": "phone | email | linkedin | location",

  "sections": [
    {
      "heading": "PROFESSIONAL SUMMARY",
      "paragraphs": [
        "..."
      ]
    },
    {
      "heading": "CORE COMPETENCIES",
      "paragraphs": [
        "Programming Languages: ...",
        "Frameworks: ...",
        "Cloud: ..."
      ]
    },
    {
      "heading": "PROFESSIONAL EXPERIENCE",
      "entries": [
        {
          "title": "...",
          "subtitle": "...",
          "dateRight": "...",
          "bullets": [
            "...",
            "..."
          ],
          "footer": "optional"
        }
      ]
    },
    {
      "heading": "EDUCATION",
      "entries": [
        {
          "title": "...",
          "subtitle": "...",
          "dateRight": "...",
          "bullets": []
        }
      ]
    },
    {
      "heading": "SKILLS",
      "paragraphs": [
        "..."
      ]
    }
  ]
}

A section must contain EITHER:

- paragraphs

OR

- entries

Never both.

Every string must be plain text.

========================
JOB DESCRIPTION
========================

${jdText}

========================
ORIGINAL RESUME
========================

${resumeText}
`;

  const raw = await callAnthropic(apiKey, prompt, {
    model: MODEL_QUALITY,
    maxTokens: 8192
  });

  const match = raw.match(
    /ATS_SCORE:\s*(\d{1,3})[\r\n]+===RESUME_JSON===\s*[\r\n]*([\s\S]*)/i
  );

  if (!match) {
    throw new Error(
      'Could not parse tailoring response — the model did not follow the expected format.'
    );
  }

  const atsScore = Math.max(
    0,
    Math.min(100, parseInt(match[1], 10))
  );

  let resume;

  try {
    resume = JSON.parse(stripJsonFence(match[2].trim()));
  } catch (e) {
    throw new Error(
      'Tailored resume JSON was malformed — please try again.'
    );
  }

  if (!resume || !resume.name || !Array.isArray(resume.sections)) {
    throw new Error(
      'Tailored resume came back with an unexpected shape — please try again.'
    );
  }

  return {
    json: {
      resume,
      atsScore
    }
  };
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
