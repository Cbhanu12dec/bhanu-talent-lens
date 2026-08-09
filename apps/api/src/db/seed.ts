import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding TalentLens database…');

  // ===== ADMIN USER =====
  const adminHash = await bcrypt.hash('Admin1234!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@talentlens.io' },
    update: {},
    create: { fullName: 'TalentLens Admin', email: 'admin@talentlens.io', passwordHash: adminHash, role: 'ADMIN', credits: 9999, creditsMax: 9999 },
  });
  console.log('✓ Admin user:', admin.email);

  // ===== DEMO USER =====
  const userHash = await bcrypt.hash('Demo1234!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'bhanu@example.com' },
    update: {},
    create: { fullName: 'Bhanu Cheryala', email: 'bhanu@example.com', passwordHash: userHash, role: 'USER', credits: 100, creditsMax: 500 },
  });
  console.log('✓ Demo user:', user.email);

  // ===== CAREER PROFILE =====
  let profile = await prisma.careerProfile.findFirst({ where: { userId: user.id } });
  if (!profile) {
    profile = await prisma.careerProfile.create({
      data: {
        userId: user.id,
        name: 'Primary Profile',
        isDefault: true,
        experience: {
          create: [
            { title: 'Software Engineer II', company: 'Microsoft', location: 'Redmond, WA', startDate: '2025-04', sortOrder: 0 },
            { title: 'Senior Software Engineer', company: 'T-Mobile', location: 'Frisco, TX', startDate: '2024-08', endDate: '2025-03', sortOrder: 1 },
            { title: 'Software Engineer', company: 'New York State Education Dept.', location: 'Albany, NY', startDate: '2023-08', endDate: '2024-07', sortOrder: 2 },
            { title: 'Software Engineer', company: 'Experian', location: 'Hyderabad, India', startDate: '2020-01', endDate: '2022-07', sortOrder: 3 },
          ],
        },
        education: {
          create: [
            { school: 'University at Albany, SUNY', degree: 'M.S. Computer Science', startDate: '2022-09', endDate: '2024-05', sortOrder: 0 },
          ],
        },
        skills: {
          create: [
            'Java', 'Go', 'Rust', '.NET', 'React', 'TypeScript',
            'Kubernetes', 'Kafka', 'gRPC', 'GraphQL', 'REST APIs',
            'AWS', 'Azure', 'PostgreSQL', 'Redis',
            'Spring Boot', 'Microservices', 'OpenTelemetry', 'Splunk',
          ].map(label => ({ label })),
        },
      },
    });
    console.log('✓ Career profile seeded');
  }

  // ===== TECHNOLOGY DOMAIN =====
  const techDomain = await prisma.domain.upsert({
    where: { name: 'Technology' },
    update: {},
    create: {
      name: 'Technology',
      summary: 'Software engineering, cloud infrastructure & platform roles',
      status: 'PUBLISHED',
      createdById: admin.id,
      categories: {
        create: [
          {
            name: 'Backend & Infrastructure',
            sortOrder: 0,
            skills: {
              create: [
                { label: 'Java', weight: 4 }, { label: 'Go', weight: 4 }, { label: 'Rust', weight: 3 },
                { label: 'Kubernetes', weight: 5 }, { label: 'Kafka', weight: 4 }, { label: 'gRPC', weight: 3 },
                { label: 'AWS', weight: 5 }, { label: 'Azure', weight: 4 }, { label: 'PostgreSQL', weight: 4 },
              ],
            },
            strongPoints: {
              create: [
                { text: 'Emphasize distributed-systems scale (requests/sec, nodes, regions)', sortOrder: 0 },
                { text: 'Lead with reliability & on-call ownership metrics (MTTR, uptime %, SLA)', sortOrder: 1 },
                { text: 'Quantify throughput improvements with exact percentages and baselines', sortOrder: 2 },
              ],
            },
          },
          {
            name: 'Frontend & Platform',
            sortOrder: 1,
            skills: {
              create: [
                { label: 'React', weight: 4 }, { label: 'TypeScript', weight: 4 }, { label: 'GraphQL', weight: 3 },
                { label: 'Next.js', weight: 3 }, { label: 'Vite', weight: 2 },
              ],
            },
            strongPoints: {
              create: [
                { text: 'Lead with user-facing impact: page performance, conversion, latency reduction', sortOrder: 0 },
                { text: 'Mention component library ownership and cross-team API surface decisions', sortOrder: 1 },
              ],
            },
          },
          {
            name: 'Data & ML',
            sortOrder: 2,
            skills: {
              create: [
                { label: 'Python', weight: 4 }, { label: 'Spark', weight: 3 }, { label: 'Airflow', weight: 3 },
                { label: 'dbt', weight: 3 }, { label: 'TensorFlow', weight: 3 }, { label: 'PyTorch', weight: 3 },
              ],
            },
            strongPoints: {
              create: [
                { text: 'Quantify model accuracy improvements and data pipeline throughput', sortOrder: 0 },
                { text: 'Emphasize experimentation rigor and A/B testing methodology', sortOrder: 1 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Technology domain seeded');

  // ===== PROGRAM MANAGEMENT DOMAIN =====
  await prisma.domain.upsert({
    where: { name: 'Technical Program Management' },
    update: {},
    create: {
      name: 'Technical Program Management',
      summary: 'TPgM, engineering program delivery & cross-functional leadership',
      status: 'PUBLISHED',
      createdById: admin.id,
      categories: {
        create: [
          {
            name: 'Program Delivery',
            sortOrder: 0,
            skills: {
              create: [
                { label: 'Agile / Scrum', weight: 5 }, { label: 'SDLC Governance', weight: 4 },
                { label: 'Risk Management', weight: 4 }, { label: 'OKR Alignment', weight: 3 },
                { label: 'Dependency Management', weight: 4 }, { label: 'Jira', weight: 3 },
              ],
            },
            strongPoints: {
              create: [
                { text: 'Lead with cross-functional program scope: # of workstreams, teams, and stakeholder levels', sortOrder: 0 },
                { text: 'Quantify delivery outcomes: schedule adherence %, cost savings, risk mitigations', sortOrder: 1 },
              ],
            },
          },
          {
            name: 'Technical Credibility',
            sortOrder: 1,
            skills: {
              create: [
                { label: 'Infrastructure Programs', weight: 4 }, { label: 'Platform Engineering', weight: 4 },
                { label: 'API / Integration Programs', weight: 3 }, { label: 'Cloud Migration', weight: 4 },
              ],
            },
            strongPoints: {
              create: [
                { text: 'Highlight technical depth: directly contributed to architecture decisions or unblocked engineers', sortOrder: 0 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Technical Program Management domain seeded');

  console.log('\n✅ Seed complete!\n');
  console.log('  Admin login:  admin@talentlens.io / Admin1234!');
  console.log('  Demo login:   bhanu@example.com  / Demo1234!\n');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
