import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';

const ExperienceSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const EducationSchema = z.object({
  school: z.string().min(1),
  degree: z.string().min(1),
  fieldOfStudy: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function careerProfileRoutes(app: FastifyInstance) {
  // List profiles
  app.get('/career-profiles', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const profiles = await prisma.careerProfile.findMany({
      where: { userId: uid },
      include: {
        experience: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        skills: true,
        _count: { select: { experience: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(profiles.map(p => ({
      id: p.id, name: p.name, isDefault: p.isDefault,
      completenessPct: computeCompleteness(p),
      experienceCount: p._count.experience,
      education: p.education.map(e => ({ id: e.id, school: e.school, degree: e.degree })),
      experience: p.experience,
      skills: p.skills,
    })));
  });

  // Create profile
  app.post('/career-profiles', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const profile = await prisma.careerProfile.create({
      data: { userId: uid, name: body.name, isDefault: false },
    });
    return reply.status(201).send({ id: profile.id, name: profile.name, isDefault: false, completenessPct: 0 });
  });

  // Add experience
  app.post('/career-profiles/:id/experience', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const profile = await assertOwns(uid, (req.params as any).id);
    const body = ExperienceSchema.parse(req.body);
    const exp = await prisma.experience.create({ data: { careerProfileId: profile.id, ...body } });
    return reply.status(201).send(exp);
  });

  // Update experience
  app.patch('/experience/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const exp = await prisma.experience.findUnique({
      where: { id: (req.params as any).id },
      include: { careerProfile: true },
    });
    if (!exp || exp.careerProfile.userId !== uid) return reply.status(404).send({ error: 'Not found' });
    const body = ExperienceSchema.partial().parse(req.body);
    const updated = await prisma.experience.update({ where: { id: exp.id }, data: body });
    return reply.send(updated);
  });

  // Delete experience
  app.delete('/experience/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const exp = await prisma.experience.findUnique({
      where: { id: (req.params as any).id },
      include: { careerProfile: true },
    });
    if (!exp || exp.careerProfile.userId !== uid) return reply.status(404).send({ error: 'Not found' });
    await prisma.experience.delete({ where: { id: exp.id } });
    return reply.status(204).send();
  });

  // Add education
  app.post('/career-profiles/:id/education', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const profile = await assertOwns(uid, (req.params as any).id);
    const body = EducationSchema.parse(req.body);
    const edu = await prisma.education.create({ data: { careerProfileId: profile.id, ...body } });
    return reply.status(201).send(edu);
  });

  // Add skill
  app.post('/career-profiles/:id/skills', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const profile = await assertOwns(uid, (req.params as any).id);
    const body = z.object({ label: z.string().min(1) }).parse(req.body);
    const skill = await prisma.profileSkill.create({ data: { careerProfileId: profile.id, label: body.label } });
    return reply.status(201).send(skill);
  });

  // Delete skill
  app.delete('/skills/:id', { preHandler: requireAuth }, async (req, reply) => {
    const uid = (req as any).user.id;
    const skill = await prisma.profileSkill.findUnique({
      where: { id: (req.params as any).id },
      include: { careerProfile: true },
    });
    if (!skill || skill.careerProfile.userId !== uid) return reply.status(404).send({ error: 'Not found' });
    await prisma.profileSkill.delete({ where: { id: skill.id } });
    return reply.status(204).send();
  });
}

async function assertOwns(userId: string, profileId: string) {
  const profile = await prisma.careerProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.userId !== userId) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return profile;
}

function computeCompleteness(p: any): number {
  let score = 0;
  if (p.experience?.length > 0) score += 40;
  if (p.education?.length > 0) score += 25;
  if (p.skills?.length >= 3) score += 20;
  if (p.experience?.length > 1) score += 15;
  return Math.min(score, 100);
}
