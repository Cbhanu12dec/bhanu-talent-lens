import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/requireAuth';

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/plans', async (_req, reply) => {
    return reply.send([
      { id: 'starter', name: 'Starter', credits: 100, priceMonthly: 0, priceAnnual: 0, features: ['100 monthly credits', 'Basic domain access', 'PDF export'] },
      { id: 'pro', name: 'Pro', credits: 500, priceMonthly: 2900, priceAnnual: 24900, features: ['500 monthly credits', 'All domains', 'PDF + DOCX export', 'AI inline editing', 'Version history'] },
      { id: 'team', name: 'Team', credits: 2000, priceMonthly: 9900, priceAnnual: 89900, features: ['2000 monthly credits', 'All Pro features', 'Team sharing', 'Admin dashboard', 'Priority support'] },
    ]);
  });

  app.get('/billing/credits', { preHandler: requireAuth }, async (req, reply) => {
    const { prisma } = await import('../../db/client');
    const user = await prisma.user.findUnique({
      where: { id: (req as any).user.id },
      select: { credits: true, creditsMax: true, planId: true },
    });
    return reply.send(user);
  });
}
