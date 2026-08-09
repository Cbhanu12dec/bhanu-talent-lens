import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/client';
import type { JobDescription } from '@prisma/client';

const anthropic = new Anthropic({ apiKey: process.env.LLM_API_KEY });

const JD_EXTRACTION_PROMPT = `You are a job description parser. Extract structured information from the following job description.

Return EXACTLY this JSON (no markdown, no extra text):
{
  "company": "company name or null",
  "title": "job title",
  "seniority": "Junior|Mid|Senior|Staff|Principal|Director|VP or null",
  "roleFamily": "Engineering|Design|Product|Operations|Sales|Marketing|Finance|HR or null",
  "parsedDomainGuess": "Technology|Finance|Healthcare|Government|Education or null",
  "requirements": [
    {
      "name": "requirement name (concise, 2-6 words)",
      "importance": "Critical|High|Medium|Low",
      "mentionCount": 2
    }
  ]
}

Rules for requirements:
- Include all technical skills, tools, methodologies mentioned
- "Critical" = explicitly required, mentioned multiple times or in must-have list
- "High" = strongly preferred, listed in primary requirements
- "Medium" = nice to have, listed in secondary requirements  
- "Low" = briefly mentioned, bonus
- mentionCount = how many times the requirement appears across the JD
- De-duplicate similar requirements (combine "React" and "React.js" → "React")`;

export async function parseJobDescription(jd: JobDescription): Promise<void> {
  try {
    const response = await anthropic.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: `${JD_EXTRACTION_PROMPT}\n\nJOB DESCRIPTION:\n${jd.rawText}` }],
    });

    const text = (response.content[0] as any).text;
    const parsed = JSON.parse(text.replace(/```json?\n?|\n?```/g, '').trim());

    await prisma.jobDescription.update({
      where: { id: jd.id },
      data: {
        company: parsed.company,
        title: parsed.title,
        seniority: parsed.seniority,
        roleFamily: parsed.roleFamily,
        parsedDomainGuess: parsed.parsedDomainGuess,
      },
    });

    if (parsed.requirements?.length > 0) {
      await prisma.jDRequirement.createMany({
        data: parsed.requirements.map((r: any) => ({
          jobDescriptionId: jd.id,
          name: r.name,
          importance: r.importance || 'Medium',
          mentionCount: r.mentionCount || 1,
        })),
        skipDuplicates: true,
      });
    }
  } catch (err) {
    console.error('[parseJobDescription] error:', err);
    throw err;
  }
}
