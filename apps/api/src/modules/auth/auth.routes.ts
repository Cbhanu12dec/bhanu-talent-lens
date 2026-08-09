import bcrypt from 'bcryptjs';
import { prisma } from '../../db/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const RegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post('/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.status(409).send({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { fullName: body.fullName, email: body.email, passwordHash, role: 'USER' },
    });

    // Seed default career profile
    await prisma.careerProfile.create({
      data: { userId: user.id, name: 'My Profile', isDefault: true },
    });

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role, email: user.email });
    return reply.status(201).send({
      accessToken,
      user: sanitizeUser(user),
    });
  });

  // Login
  app.post('/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role, email: user.email });
    return reply.send({ accessToken, user: sanitizeUser(user) });
  });

  // Get current user
  app.get('/auth/me', {
    preHandler: async (req, reply) => {
      try { await req.jwtVerify(); } catch { reply.status(401).send({ error: 'unauthenticated' }); }
    },
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send(sanitizeUser(user));
  });
}

function sanitizeUser(user: any) {
  const { passwordHash, ...safe } = user;
  return safe;
}
