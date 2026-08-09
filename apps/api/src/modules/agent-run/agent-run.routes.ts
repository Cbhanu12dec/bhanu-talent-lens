import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';
import { mapEvidenceAndBuildStrategy } from '../../agent-service/mapEvidence';
import { buildResumeFromStrategy } from '../../agent-service/generateResume';

const ANALYZE_STEPS = [
  { label: 'Parsing job description', state: 'pending' as const },
  { label: 'Mapping evidence from profile', state: 'pending' as const },
  { label: 'Scoring requirement gaps', state: 'pending' as const },
  { label: 'Building strategy', state: 'pending' as const },
];
const BUILD_STEPS = [
  { label: 'Loading ground truth', state: 'pending' as const },
  { label: 'Generating summary', state: 'pending' as const },
  { label: 'Rewriting experience bullets', state: 'pending' as const },
  { label: 'Composing skills section', state: 'pending' as const },
  { label: 'Running truthfulness check', state: 'pending' as const },
  { label: 'Calculating match score', state: 'pending' as const },
];

export async function agentRunRoutes(app: FastifyInstance) {
  // Create agent run
  app.post('/agent-runs', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const body = z.object({
      careerProfileId: z.string(),
      domainId: z.string(),
      jobDescriptionId: z.string(),
    }).parse(req.body);

    // Verify ownership
    const [profile, domain, jd] = await Promise.all([
      prisma.careerProfile.findFirst({ where: { id: body.careerProfileId, userId: uid } }),
      prisma.domain.findFirst({ where: { id: body.domainId, status: 'PUBLISHED' } }),
      prisma.jobDescription.findFirst({ where: { id: body.jobDescriptionId, userId: uid } }),
    ]);
    if (!profile) return reply.status(400).send({ error: 'Career profile not found' });
    if (!domain) return reply.status(400).send({ error: 'Domain not found or not published' });
    if (!jd) return reply.status(400).send({ error: 'Job description not found' });

    const run = await prisma.agentRun.create({
      data: { userId: uid, ...body, currentStep: 'SETUP', status: 'IN_PROGRESS' },
    });
    return reply.status(201).send({ id: run.id, currentStep: run.currentStep, status: run.status });
  });

  // Get agent run details
  app.get('/agent-runs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const run = await prisma.agentRun.findFirst({
      where: { id: (req.params as any).id, userId: uid },
      include: {
        careerProfile: { select: { id: true, name: true } },
        domain: { select: { id: true, name: true } },
        jobDescription: { select: { id: true, company: true, title: true } },
      },
    });
    if (!run) return reply.status(404).send({ error: 'Not found' });
    return reply.send(run);
  });

  // Get status (poll target)
  app.get('/agent-runs/:id/status', { preHandler: requireAuth }, async (req, reply) => {
    const run = await prisma.agentRun.findUnique({
      where: { id: (req.params as any).id },
      select: { currentStep: true, status: true, buildLog: true },
    });
    if (!run) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ currentStep: run.currentStep, status: run.status, buildLog: run.buildLog });
  });

  // Advance to INTELLIGENCE step — triggers analyze pipeline
  app.post('/agent-runs/:id/analyze', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const run = await prisma.agentRun.findFirst({
      where: { id: (req.params as any).id, userId: uid },
    });
    if (!run) return reply.status(404).send({ error: 'Not found' });
    if (run.currentStep !== 'SETUP') return reply.status(400).send({ error: 'Already analyzed' });

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { currentStep: 'INTELLIGENCE', status: 'IN_PROGRESS' },
    });

    // Run analysis async
    mapEvidenceAndBuildStrategy(run.id).catch(err =>
      console.error('[analyze] failed for run', run.id, err.message)
    );

    return reply.status(202).send({ id: run.id, currentStep: 'INTELLIGENCE', status: 'IN_PROGRESS' });
  });

  // Get findings (populates Step 2 panel)
  app.get('/agent-runs/:id/findings', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const run = await prisma.agentRun.findFirst({
      where: { id: (req.params as any).id, userId: uid },
      include: {
        jobDescription: { include: { requirements: true } },
        careerProfile: { include: { skills: true, experience: true } },
      },
    });
    if (!run) return reply.status(404).send({ error: 'Not found' });

    const strategy = run.strategySnapshot as any;
    if (!strategy) return reply.send({ roleMatch: 'Partial', strongestEvidence: [], gaps: [] });

    const gaps = (run.jobDescription.requirements || [])
      .filter((r: any) => ['Critical', 'High'].includes(r.importance))
      .map((req: any) => ({
        requirement: req.name,
        strength: strategy.evidenceMap?.[req.id] || 'MISSING',
        promptUser: (strategy.evidenceMap?.[req.id] || 'MISSING') === 'MISSING',
      }));

    return reply.send({
      roleMatch: strategy.roleMatch || 'Partial',
      strongestEvidence: strategy.skillPriority?.slice(0, 5) || [],
      gaps,
    });
  });

  // Update strategy (Step 3)
  app.patch('/agent-runs/:id/strategy', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const run = await prisma.agentRun.findFirst({ where: { id: (req.params as any).id, userId: uid } });
    if (!run) return reply.status(404).send({ error: 'Not found' });

    const existing = (run.strategySnapshot as any) || {};
    const patch = req.body as any;
    const merged = { ...existing, ...patch };

    const updated = await prisma.agentRun.update({
      where: { id: run.id },
      data: { strategySnapshot: merged, currentStep: 'STRATEGY' },
      select: { strategySnapshot: true },
    });
    return reply.send(updated);
  });

  // Trigger build (Step 4)
  app.post('/agent-runs/:id/build', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const run = await prisma.agentRun.findFirst({ where: { id: (req.params as any).id, userId: uid } });
    if (!run) return reply.status(404).send({ error: 'Not found' });
    if (!['INTELLIGENCE', 'STRATEGY'].includes(run.currentStep)) {
      return reply.status(400).send({ error: 'Must complete analysis first' });
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { currentStep: 'BUILD', status: 'IN_PROGRESS', buildLog: [] },
    });

    buildResumeFromStrategy(run.id).catch(err =>
      console.error('[build] failed for run', run.id, err.message)
    );

    return reply.status(202).send({ id: run.id, currentStep: 'BUILD', status: 'IN_PROGRESS' });
  });

  // Build activity log
  app.get('/agent-runs/:id/build-activity', { preHandler: requireAuth }, async (req, reply) => {
    const run = await prisma.agentRun.findUnique({
      where: { id: (req.params as any).id },
      select: { buildLog: true, status: true, currentStep: true },
    });
    if (!run) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ items: run.buildLog || [], status: run.status, currentStep: run.currentStep });
  });

  // List user's agent runs
  app.get('/agent-runs', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const runs = await prisma.agentRun.findMany({
      where: { userId: uid },
      include: {
        domain: { select: { id: true, name: true } },
        jobDescription: { select: { id: true, company: true, title: true } },
        careerProfile: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
    return reply.send(runs);
  });
}
