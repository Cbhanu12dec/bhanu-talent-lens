import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';

// All routes here require ADMIN role in addition to authentication
export async function adminRoutes(app: FastifyInstance) {
  const preHandler = [requireAuth, requireRole('ADMIN')];

  // List all domains with full data
  app.get('/admin/domains', { preHandler }, async (_req, reply) => {
    const domains = await prisma.domain.findMany({
      include: {
        categories: {
          include: { skills: true, strongPoints: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(domains);
  });

  // Create domain
  app.post('/admin/domains', { preHandler }, async (req, reply) => {
    const uid = (req as any).user.id;
    const body = z.object({ name: z.string().min(1), summary: z.string().min(1) }).parse(req.body);
    const domain = await prisma.domain.create({
      data: { name: body.name, summary: body.summary, createdById: uid, status: 'DRAFT' },
    });
    return reply.status(201).send({ id: domain.id, name: domain.name, summary: domain.summary, status: domain.status });
  });

  // Publish / unpublish
  app.patch('/admin/domains/:id/publish', { preHandler }, async (req, reply) => {
    const body = z.object({ status: z.enum(['PUBLISHED', 'DRAFT']) }).parse(req.body);
    const domain = await prisma.domain.update({
      where: { id: (req.params as any).id },
      data: { status: body.status },
      select: { id: true, status: true },
    });
    return reply.send(domain);
  });

  // Update domain
  app.patch('/admin/domains/:id', { preHandler }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1).optional(), summary: z.string().optional() }).parse(req.body);
    const domain = await prisma.domain.update({ where: { id: (req.params as any).id }, data: body });
    return reply.send(domain);
  });

  // Delete domain
  app.delete('/admin/domains/:id', { preHandler }, async (req, reply) => {
    await prisma.domain.delete({ where: { id: (req.params as any).id } });
    return reply.status(204).send();
  });

  // Add category
  app.post('/admin/domains/:id/categories', { preHandler }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const count = await prisma.domainCategory.count({ where: { domainId: (req.params as any).id } });
    const category = await prisma.domainCategory.create({
      data: { domainId: (req.params as any).id, name: body.name, sortOrder: count },
    });
    return reply.status(201).send(category);
  });

  // Update category
  app.patch('/admin/domain-categories/:id', { preHandler }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1).optional() }).parse(req.body);
    const cat = await prisma.domainCategory.update({ where: { id: (req.params as any).id }, data: body });
    return reply.send(cat);
  });

  // Delete category
  app.delete('/admin/domain-categories/:id', { preHandler }, async (req, reply) => {
    await prisma.domainCategory.delete({ where: { id: (req.params as any).id } });
    return reply.status(204).send();
  });

  // Add skill to category
  app.post('/admin/domain-categories/:id/skills', { preHandler }, async (req, reply) => {
    const body = z.object({ label: z.string().min(1), weight: z.number().min(1).max(5).default(3) }).parse(req.body);
    const skill = await prisma.domainSkill.create({
      data: { domainCategoryId: (req.params as any).id, label: body.label, weight: body.weight },
    });
    return reply.status(201).send(skill);
  });

  // Update skill
  app.patch('/admin/domain-skills/:id', { preHandler }, async (req, reply) => {
    const body = z.object({ label: z.string().min(1).optional(), weight: z.number().min(1).max(5).optional() }).parse(req.body);
    const skill = await prisma.domainSkill.update({ where: { id: (req.params as any).id }, data: body });
    return reply.send(skill);
  });

  // Delete skill
  app.delete('/admin/domain-skills/:id', { preHandler }, async (req, reply) => {
    await prisma.domainSkill.delete({ where: { id: (req.params as any).id } });
    return reply.status(204).send();
  });

  // Add strong point
  app.post('/admin/domain-categories/:id/strong-points', { preHandler }, async (req, reply) => {
    const body = z.object({ text: z.string().min(1) }).parse(req.body);
    const count = await prisma.domainStrongPoint.count({ where: { domainCategoryId: (req.params as any).id } });
    const sp = await prisma.domainStrongPoint.create({
      data: { domainCategoryId: (req.params as any).id, text: body.text, sortOrder: count },
    });
    return reply.status(201).send(sp);
  });

  // Delete strong point
  app.delete('/admin/domain-strong-points/:id', { preHandler }, async (req, reply) => {
    await prisma.domainStrongPoint.delete({ where: { id: (req.params as any).id } });
    return reply.status(204).send();
  });

  // Admin stats overview
  app.get('/admin/stats', { preHandler }, async (_req, reply) => {
    const [users, domains, agentRuns, resumes] = await Promise.all([
      prisma.user.count(),
      prisma.domain.count(),
      prisma.agentRun.count(),
      prisma.resume.count(),
    ]);
    return reply.send({ users, domains, agentRuns, resumes });
  });

  // Admin user list
  app.get('/admin/users', { preHandler }, async (_req, reply) => {
    const users = await prisma.user.findMany({
      select: { id: true, fullName: true, email: true, role: true, credits: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(users);
  });
}
