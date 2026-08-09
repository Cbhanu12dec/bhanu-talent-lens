import { prisma } from '../db/client';

// Extract named claims from resume content that must be traceable to the source profile
function extractNamedClaims(content: any): Array<{ text: string; type: 'employer' | 'degree' | 'skill' | 'cert' }> {
  const claims: Array<{ text: string; type: 'employer' | 'degree' | 'skill' | 'cert' }> = [];

  // Employer/company names from experience entries
  for (const exp of (content.experience || [])) {
    if (exp.company) claims.push({ text: exp.company, type: 'employer' });
  }

  // Degree/school from education entries
  for (const edu of (content.education || [])) {
    if (edu.school) claims.push({ text: edu.school, type: 'degree' });
    if (edu.degree) claims.push({ text: edu.degree, type: 'degree' });
  }

  // Certifications
  for (const cert of (content.certifications || [])) {
    claims.push({ text: cert, type: 'cert' });
  }

  return claims;
}

function findInProfile(claim: { text: string; type: string }, profile: any): boolean {
  const needle = claim.text.toLowerCase().trim();

  switch (claim.type) {
    case 'employer':
      return profile.experience.some((e: any) =>
        e.company.toLowerCase().includes(needle) || needle.includes(e.company.toLowerCase())
      );
    case 'degree':
      return profile.education.some((e: any) =>
        e.school.toLowerCase().includes(needle) ||
        e.degree.toLowerCase().includes(needle) ||
        needle.includes(e.school.toLowerCase().slice(0, 8))
      );
    case 'cert':
      // Certs must exist in profile skills or education
      return profile.skills.some((s: any) => s.label.toLowerCase().includes(needle));
    default:
      return true;
  }
}

export async function verifyTruthfulness(
  resumeVersionId: string,
  profile: any
): Promise<void> {
  const version = await prisma.resumeVersion.findUnique({ where: { id: resumeVersionId } });
  if (!version) return;

  const claims = extractNamedClaims(version.content as any);
  const flags: Array<{ resumeVersionId: string; claimText: string; sourceRef: string | null; status: 'NEEDS_REVIEW' }> = [];

  for (const claim of claims) {
    const traceable = findInProfile(claim, profile);
    if (!traceable) {
      flags.push({
        resumeVersionId,
        claimText: `${claim.type}: "${claim.text}"`,
        sourceRef: null,
        status: 'NEEDS_REVIEW',
      });
    }
  }

  if (flags.length > 0) {
    await prisma.qualityFlag.createMany({ data: flags });
  }
}
