import type { FastifyRequest, FastifyReply } from 'fastify';

export function requireRole(role: 'USER' | 'ADMIN') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user;
    if (!user || user.role !== role) {
      reply.status(403).send({ error: 'forbidden' });
    }
  };
}
