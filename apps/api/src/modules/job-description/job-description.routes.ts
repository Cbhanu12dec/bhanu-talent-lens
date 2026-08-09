import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';
import { parseJobDescription } from '../../agent-service/parseJobDescription';

export async function jobDescriptionRoutes(app: FastifyInstance) {
  // Create and auto-parse JD
  app.post('/job-descriptions', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const body = z.object({ rawText: z.string().min(50) }).parse(req.body);

    const jd = await prisma.jobDescription.create({
      data: { userId: uid, rawText: body.rawText },
    });

    // Parse asynchronously — do not block the 201 response
    parseJobDescription(jd).catch(err =>
      console.error('[parseJD] failed for', jd.id, err.message)
    );

    return reply.status(201).send({
      id: jd.id, rawText: jd.rawText,
      company: null, title: null, seniority: null, roleFamily: null, parsedDomainGuess: null,
    });
  });

  // Get JD with its parsed requirements
  app.get('/job-descriptions/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const jd = await prisma.jobDescription.findUnique({
      where: { id: (req.params as any).id },
      include: { requirements: true },
    });
    if (!jd || jd.userId !== uid) return reply.status(404).send({ error: 'Not found' });
    return reply.send(jd);
  });

  // List user's JDs
  app.get('/job-descriptions', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const jds = await prisma.jobDescription.findMany({
      where: { userId: uid },
      include: { _count: { select: { requirements: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(jds);
  });
}
