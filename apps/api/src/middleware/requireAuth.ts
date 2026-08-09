import type { FastifyRequest, FastifyReply } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; email: string };
    user: { id: string; role: string; email: string };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    (req as any).user = {
      id: req.user.sub,
      role: req.user.role,
      email: req.user.email,
    };
  } catch {
    reply.status(401).send({ error: 'unauthenticated' });
  }
}
