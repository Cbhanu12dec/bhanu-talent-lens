import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';

// User-facing domain routes — published domains, name + summary ONLY
// (categories/skills/strongPoints are NEVER returned here, not even stripped client-side —
// a separate Prisma query ensures they're never selected)
export async function domainRoutes(app: FastifyInstance) {
  app.get('/domains', { preHandler: requireAuth }, async (_req, reply) => {
    const domains = await prisma.domain.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, name: true, summary: true },
      orderBy: { name: 'asc' },
    });
    return reply.send(domains);
  });
}
