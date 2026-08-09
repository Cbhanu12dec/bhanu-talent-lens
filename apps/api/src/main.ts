import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import 'dotenv/config';
import { authRoutes } from './modules/auth/auth.routes';
import { careerProfileRoutes } from './modules/career-profile/career-profile.routes';
import { domainRoutes } from './modules/domain/domain.routes';
import { jobDescriptionRoutes } from './modules/job-description/job-description.routes';
import { agentRunRoutes } from './modules/agent-run/agent-run.routes';
import { resumeRoutes } from './modules/resume/resume.routes';
import { billingRoutes } from './modules/billing/billing.routes';
import { adminRoutes } from './modules/domain/admin-domain.routes';

const app = Fastify({ logger: true });

// Plugins
app.register(fastifyCors, {
  origin: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
  credentials: true,
});

app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'change_me_in_production_min_32_chars',
  sign: { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
});

// Health check
app.get('/health', async () => ({ ok: true, timestamp: new Date().toISOString() }));

// Routes (v1 prefix)
app.register(authRoutes,           { prefix: '/api/v1' });
app.register(careerProfileRoutes,  { prefix: '/api/v1' });
app.register(domainRoutes,         { prefix: '/api/v1' });
app.register(jobDescriptionRoutes, { prefix: '/api/v1' });
app.register(agentRunRoutes,       { prefix: '/api/v1' });
app.register(resumeRoutes,         { prefix: '/api/v1' });
app.register(billingRoutes,        { prefix: '/api/v1' });
app.register(adminRoutes,          { prefix: '/api/v1' });

// Global error handler
app.setErrorHandler((error, _req, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: error.message || 'Internal server error',
    code: (error as any).code,
  });
});

async function start() {
  try {
    await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' });
    console.log(`TalentLens API running on port ${process.env.PORT || 3001}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
