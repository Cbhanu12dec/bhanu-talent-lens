import { prisma } from '../db/client';

type EvidenceStrength = 'STRONG' | 'WEAK' | 'MISSING';

interface EvidenceResult {
  jdRequirementId: string;
  evidenceStrength: EvidenceStrength;
  resumeLocations: string[];
}

// Fuzzy text matching — checks if a requirement name appears in profile data
function scoreEvidence(
  requirementName: string,
  profileText: string[],
  domainVocabulary: string[]
): { strength: EvidenceStrength; locations: string[] } {
  const needle = requirementName.toLowerCase();
  const locations: string[] = [];

  for (let i = 0; i < profileText.length; i++) {
    const hay = profileText[i].toLowerCase();
    if (hay.includes(needle) || needle.includes(hay.slice(0, Math.min(hay.length, 6)))) {
      locations.push(`profile_text:${i}`);
    }
  }

  // Boost if the requirement is a known domain skill (synonym coverage)
  const domainMatch = domainVocabulary.some(v =>
    v.toLowerCase().includes(needle) || needle.includes(v.toLowerCase().slice(0, 4))
  );

  if (locations.length >= 2 || (locations.length >= 1 && domainMatch)) return { strength: 'STRONG', locations };
  if (locations.length === 1 || domainMatch) return { strength: 'WEAK', locations };
  return { strength: 'MISSING', locations: [] };
}

export async function mapEvidenceAndBuildStrategy(agentRunId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    include: {
      careerProfile: { include: { experience: true, education: true, skills: true } },
      jobDescription: { include: { requirements: true } },
      domain: { include: { categories: { include: { skills: true } } } },
    },
  });
  if (!run) throw new Error(`AgentRun ${agentRunId} not found`);

  const { careerProfile: profile, jobDescription: jd, domain } = run;

  // Build a flat text corpus from the profile to match against
  const profileText: string[] = [
    ...profile.experience.map(e => `${e.title} ${e.company} ${e.location || ''}`),
    ...profile.skills.map(s => s.label),
    ...profile.education.map(e => `${e.degree} ${e.fieldOfStudy || ''} ${e.school}`),
  ];

  const domainVocabulary = domain.categories.flatMap(c => c.skills.map(s => s.label));

  // Map evidence for every JD requirement
  const evidenceMap: Record<string, EvidenceStrength> = {};
  const matches: EvidenceResult[] = jd.requirements.map(req => {
    const { strength, locations } = scoreEvidence(req.name, profileText, domainVocabulary);
    evidenceMap[req.id] = strength;
    return { jdRequirementId: req.id, evidenceStrength: strength, resumeLocations: locations };
  });

  // Score overall role match based on critical/high requirement coverage
  const criticalReqs = jd.requirements.filter(r => ['Critical', 'High'].includes(r.importance));
  const strongCritical = criticalReqs.filter(r => evidenceMap[r.id] === 'STRONG').length;
  const coveragePct = criticalReqs.length > 0 ? strongCritical / criticalReqs.length : 0.5;
  const roleMatch = coveragePct >= 0.7 ? 'Strong' : coveragePct >= 0.4 ? 'Good' : coveragePct >= 0.2 ? 'Partial' : 'Weak';

  // Build strategy
  const skillPriority = jd.requirements
    .filter(r => evidenceMap[r.id] !== 'MISSING')
    .sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      return (order[a.importance as keyof typeof order] ?? 3) - (order[b.importance as keyof typeof order] ?? 3);
    })
    .map(r => r.name)
    .slice(0, 10);

  const deemphasize = profile.experience
    .filter(e => {
      const expText = `${e.title} ${e.company}`.toLowerCase();
      return !jd.requirements.some(r => expText.includes(r.name.toLowerCase()));
    })
    .map(e => e.company)
    .slice(0, 2);

  const experiencePriority = profile.experience.map(e => {
    const relevantReqs = jd.requirements.filter(r =>
      `${e.title} ${e.company}`.toLowerCase().includes(r.name.toLowerCase())
    ).length;
    const level = relevantReqs >= 3 ? 'Very High' : relevantReqs >= 1 ? 'High' : 'Medium';
    return { employer: e.company, level };
  });

  const strategy = {
    roleMatch,
    positioning: `${profile.experience[0]?.title || 'Professional'} with experience aligning to ${jd.title || 'target role'} requirements`,
    experiencePriority,
    skillPriority,
    deemphasize,
    evidenceMap,
    targets: { resumeLength: '2 pages', targetMatchScore: 92 },
  };

  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      strategySnapshot: strategy,
      currentStep: 'STRATEGY',
      status: 'IN_PROGRESS',
    },
  });
}
