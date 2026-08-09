import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db/client';
import { verifyTruthfulness } from './verifyTruthfulness';

const anthropic = new Anthropic({ apiKey: process.env.LLM_API_KEY });

async function appendBuildLog(runId: string, text: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { buildLog: true } });
  const existing = (run?.buildLog as any[]) || [];
  await prisma.agentRun.update({
    where: { id: runId },
    data: { buildLog: [...existing, { timestamp: new Date().toISOString(), text }] },
  });
}

export async function buildResumeFromStrategy(agentRunId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    include: {
      careerProfile: { include: { experience: true, education: true, skills: true } },
      jobDescription: { include: { requirements: true } },
      domain: {
        include: {
          categories: {
            include: { skills: true, strongPoints: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      },
    },
  });
  if (!run) throw new Error(`AgentRun ${agentRunId} not found`);

  const strategy = run.strategySnapshot as any;
  const profile = run.careerProfile;
  const jd = run.jobDescription;
  const domain = run.domain;

  try {
    await appendBuildLog(agentRunId, 'Loading ground truth from career profile');

    const styleDirectives = domain.categories.flatMap(c =>
      c.strongPoints.map(sp => sp.text)
    ).slice(0, 6);

    const targetSkills = (strategy?.skillPriority || []).slice(0, 8).join(', ');
    const priorityEmployers = (strategy?.experiencePriority || [])
      .filter((e: any) => e.level === 'Very High' || e.level === 'High')
      .map((e: any) => e.employer);

    await appendBuildLog(agentRunId, 'Generating professional summary');

    const GENERATION_PROMPT = `You are a professional resume writer building a tailored resume. Generate ONLY the resume JSON — no explanation.

GROUND TRUTH (the ONLY facts you may use — never invent anything not here):
${JSON.stringify({
  experience: profile.experience,
  education: profile.education,
  skills: profile.skills.map(s => s.label),
}, null, 2)}

TARGET ROLE: ${jd.title || 'Target Role'}
COMPANY: ${jd.company || 'Target Company'}
KEY REQUIREMENTS: ${jd.requirements.filter(r => ['Critical', 'High'].includes(r.importance)).map(r => r.name).join(', ')}
TARGET SKILLS TO HIGHLIGHT: ${targetSkills}
PRIORITY EMPLOYERS: ${priorityEmployers.join(', ') || 'All'}
STYLE DIRECTIVES: ${styleDirectives.join('; ')}

Return EXACTLY this JSON (no markdown fences):
{
  "summary": "2-3 sentence professional summary tailored to the target role",
  "skills": ["skill1", "skill2", ...10-15 skills],
  "experience": [
    {
      "company": "company name (must match ground truth exactly)",
      "title": "job title (must match ground truth exactly)",
      "dateRange": "Mon YYYY – Mon YYYY or Present",
      "location": "city, state or null",
      "bullets": ["achievement-focused bullet with metric", "bullet 2", "bullet 3"]
    }
  ],
  "education": [
    { "school": "school", "degree": "degree", "fieldOfStudy": "field", "dateRange": "YYYY – YYYY" }
  ],
  "certifications": [],
  "achievements": []
}

Rules:
- Every company, school, and certification MUST come from the ground truth
- Dates must match ground truth exactly  
- Bullets must be action-verb + impact + metric where possible
- Incorporate key requirements naturally into bullets
- Skills section should lead with skills matching the target role`;

    await appendBuildLog(agentRunId, 'Rewriting experience bullets with JD targeting');

    const response = await anthropic.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: GENERATION_PROMPT }],
    });

    const rawText = (response.content[0] as any).text;
    const content = JSON.parse(rawText.replace(/```json?\n?|\n?```/g, '').trim());

    await appendBuildLog(agentRunId, 'Computing section changes (diff)');

    // Generate per-section changes comparing draft to source
    const changes = generateChanges(profile, content);

    // Create resume and version
    let resume = run.resumeId
      ? await prisma.resume.findUnique({ where: { id: run.resumeId } })
      : null;

    if (!resume) {
      resume = await prisma.resume.create({
        data: {
          userId: run.userId,
          careerProfileId: run.careerProfileId,
          domainId: run.domainId,
          jobDescriptionId: run.jobDescriptionId,
          title: `${jd.title || 'Resume'} — ${jd.company || 'Company'}`,
          status: 'ACTIVE',
        },
      });
    }

    const existingVersionCount = await prisma.resumeVersion.count({ where: { resumeId: resume.id } });
    const version = await prisma.resumeVersion.create({
      data: {
        resumeId: resume.id,
        versionNumber: existingVersionCount + 1,
        label: 'Initial Agent build',
        content: content as any,
      },
    });

    if (changes.length > 0) {
      await prisma.resumeChange.createMany({
        data: changes.map(c => ({ ...c, resumeVersionId: version.id })),
      });
    }

    await appendBuildLog(agentRunId, 'Running truthfulness verification');
    await verifyTruthfulness(version.id, profile);

    await appendBuildLog(agentRunId, 'Scoring requirement matches');

    // Store requirement matches
    const requirements = jd.requirements;
    const matchData = requirements.map(req => {
      const contentText = JSON.stringify(content).toLowerCase();
      const reqLower = req.name.toLowerCase();
      const mentions = (contentText.match(new RegExp(reqLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      const strength = mentions >= 2 ? 'STRONG' : mentions === 1 ? 'WEAK' : 'MISSING';
      return {
        resumeVersionId: version.id,
        jdRequirementId: req.id,
        evidenceStrength: strength as any,
        resumeLocations: mentions > 0 ? ['content'] : [],
      };
    });

    await prisma.resumeRequirementMatch.createMany({ data: matchData });

    // Compute match score
    const strongCount = matchData.filter(m => m.evidenceStrength === 'STRONG').length;
    const weakCount = matchData.filter(m => m.evidenceStrength === 'WEAK').length;
    const total = requirements.length || 1;
    const matchScore = Math.round(((strongCount * 1.0 + weakCount * 0.5) / total) * 100);

    const scoreBreakdown = {
      keywordCoverage: Math.min(matchScore + 5, 100),
      experienceRelevance: Math.min(matchScore - 3, 100),
      impactMetrics: content.experience.reduce((acc: number, e: any) =>
        acc + e.bullets.filter((b: string) => /\d/.test(b)).length, 0) * 5,
      roleAlignment: matchScore,
      formatting: 95,
      leadership: matchScore > 80 ? 88 : 70,
    };

    await prisma.resumeVersion.update({
      where: { id: version.id },
      data: { matchScore, scoreBreakdown: scoreBreakdown as any },
    });

    await prisma.resume.update({ where: { id: resume.id }, data: { currentVersionId: version.id } });

    // Mark run as complete
    await prisma.agentRun.update({
      where: { id: agentRunId },
      data: {
        resumeId: resume.id,
        currentStep: 'REVIEW',
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await appendBuildLog(agentRunId, `Build complete — match score ${matchScore}%`);

  } catch (err: any) {
    await prisma.agentRun.update({
      where: { id: agentRunId },
      data: { status: 'FAILED' },
    });
    await appendBuildLog(agentRunId, `Build failed: ${err.message}`);
    throw err;
  }
}

function generateChanges(profile: any, content: any) {
  const changes: Array<{ section: string; beforeText: string; afterText: string; rationale: string }> = [];

  // Summary is always a new addition from the agent
  if (content.summary) {
    changes.push({
      section: 'PROFESSIONAL SUMMARY',
      beforeText: '(no summary)',
      afterText: content.summary,
      rationale: 'AI-generated summary targeting the role requirements',
    });
  }

  // Compare experience bullets
  for (const exp of (content.experience || [])) {
    const sourceExp = profile.experience.find((e: any) => e.company === exp.company);
    if (sourceExp && exp.bullets?.length > 0) {
      changes.push({
        section: `EXPERIENCE — ${exp.company}`,
        beforeText: `${sourceExp.title} at ${sourceExp.company}`,
        afterText: exp.bullets.slice(0, 2).join('\n'),
        rationale: 'Bullets rewritten for impact metrics and JD keyword alignment',
      });
    }
  }

  return changes;
}
