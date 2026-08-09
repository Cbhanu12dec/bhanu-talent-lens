import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';

export async function resumeRoutes(app: FastifyInstance) {
  // List user's resumes
  app.get('/resumes', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const resumes = await prisma.resume.findMany({
      where: { userId: uid },
      include: {
        domain: { select: { id: true, name: true } },
        jobDescription: { select: { id: true, company: true, title: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send(resumes);
  });

  // Get resume with current version
  app.get('/resumes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const resume = await prisma.resume.findFirst({
      where: { id: (req.params as any).id, userId: uid },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!resume) return reply.status(404).send({ error: 'Not found' });
    return reply.send(resume);
  });

  // Get specific version
  app.get('/resumes/:id/versions/:versionId', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const resume = await prisma.resume.findFirst({ where: { id: (req.params as any).id, userId: uid } });
    if (!resume) return reply.status(404).send({ error: 'Not found' });

    const version = await prisma.resumeVersion.findFirst({
      where: { id: (req.params as any).versionId, resumeId: resume.id },
    });
    if (!version) return reply.status(404).send({ error: 'Version not found' });
    return reply.send(version);
  });

  // Get changes for a version
  app.get('/resume-versions/:id/changes', { preHandler: requireAuth }, async (req, reply) => {
    const changes = await prisma.resumeChange.findMany({
      where: { resumeVersionId: (req.params as any).id },
      orderBy: { id: 'asc' },
    });
    return reply.send(changes);
  });

  // Accept / revert a change
  app.patch('/resume-changes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ status: z.enum(['ACCEPTED', 'REVERTED']) }).parse(req.body);
    const change = await prisma.resumeChange.update({
      where: { id: (req.params as any).id },
      data: { status: body.status },
    });
    return reply.send(change);
  });

  // Accept all changes
  app.post('/resume-versions/:id/changes/accept-all', { preHandler: requireAuth }, async (req, reply) => {
    const result = await prisma.resumeChange.updateMany({
      where: { resumeVersionId: (req.params as any).id, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    return reply.send({ updated: result.count });
  });

  // Get requirement matches
  app.get('/resume-versions/:id/requirement-matches', { preHandler: requireAuth }, async (req, reply) => {
    const matches = await prisma.resumeRequirementMatch.findMany({
      where: { resumeVersionId: (req.params as any).id },
      include: { jdRequirement: true },
    });
    return reply.send(matches.map(m => ({
      requirementName: m.jdRequirement.name,
      importance: m.jdRequirement.importance,
      mentions: m.jdRequirement.mentionCount,
      evidenceStrength: m.evidenceStrength,
      resumeLocations: m.resumeLocations,
    })));
  });

  // Get quality flags
  app.get('/resume-versions/:id/quality-flags', { preHandler: requireAuth }, async (req, reply) => {
    const flags = await prisma.qualityFlag.findMany({
      where: { resumeVersionId: (req.params as any).id },
    });
    return reply.send(flags);
  });

  // Update quality flag
  app.patch('/quality-flags/:id', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ status: z.enum(['VERIFIED']) }).parse(req.body);
    const flag = await prisma.qualityFlag.update({
      where: { id: (req.params as any).id },
      data: { status: body.status },
    });
    return reply.send(flag);
  });

  // Inline AI edit (suggestion only — not persisted until user accepts)
  app.post('/resume-versions/:id/inline-ai', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({
      section: z.string(),
      action: z.enum(['improve_impact', 'shorten', 'add_metrics', 'match_jd', 'emphasize_leadership']),
      selectedText: z.string().min(1),
    }).parse(req.body);

    const actionInstructions: Record<string, string> = {
      improve_impact: 'Rewrite to have a stronger impact statement with a clear action verb and measurable outcome.',
      shorten: 'Make this more concise while retaining all key information.',
      add_metrics: 'Add specific quantifiable metrics to make this bullet more impactful.',
      match_jd: 'Rewrite to better align with the job description terminology.',
      emphasize_leadership: 'Reframe to emphasize leadership, ownership, and decision-making.',
    };

    // In production this calls the LLM — returns placeholder in dev
    const suggestion = `${actionInstructions[body.action]} Applied to: "${body.selectedText}"`;
    return reply.send({
      suggestion,
      rationale: `Action "${body.action}" applied to improve the selected text.`,
    });
  });

  // Export
  app.post('/resumes/:id/export', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const resume = await prisma.resume.findFirst({ where: { id: (req.params as any).id, userId: uid } });
    if (!resume) return reply.status(404).send({ error: 'Not found' });

    const body = z.object({
      format: z.enum(['pdf', 'docx']),
      type: z.enum(['resume', 'cover_letter', 'recruiter_email']),
      templateId: z.string().optional(),
    }).parse(req.body);

    // In production this calls the export service — returns signed URL
    const downloadUrl = `${process.env.EXPORT_SERVICE_URL}/downloads/${resume.id}.${body.format}?ttl=${process.env.SIGNED_URL_TTL_SECONDS || 300}`;
    return reply.send({ downloadUrl });
  });
}
