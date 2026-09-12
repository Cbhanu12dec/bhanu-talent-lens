/**
 * Domain Library data access.
 *
 * Everything below is in-memory mock data shaped exactly like the schema the
 * backend track is converging toward (§3). Components must only ever talk to
 * the exported `domainLibraryApi` — when the Firestore migration lands, this
 * one file swaps to real calls and no component internals change.
 */

const nowISO = () => new Date().toISOString();
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
const uid = p => `${p}_${Math.random().toString(36).slice(2, 9)}`;

/* ============================ SEED ============================ */

let domains = [
  {
    id: 'dom_ecom', name: 'E-commerce', slug: 'e-commerce', icon: '🛒',
    description: 'Online retail, marketplaces and direct-to-consumer platforms. Covers storefront, checkout, fulfilment and merchandising work.',
    status: 'published', createdAt: daysAgo(120), updatedAt: daysAgo(3), createdBy: 'cbhanu12dec@gmail.com',
  },
  {
    id: 'dom_bank', name: 'Banking & Financial Services', slug: 'banking', icon: '🏦',
    description: 'Retail and commercial banking, payments, lending and regulatory-heavy financial platforms.',
    status: 'published', createdAt: daysAgo(96), updatedAt: daysAgo(11), createdBy: 'cbhanu12dec@gmail.com',
  },
  {
    id: 'dom_saas', name: 'B2B SaaS', slug: 'b2b-saas', icon: '☁️',
    description: 'Multi-tenant subscription software sold to businesses, with usage-based billing and enterprise onboarding.',
    status: 'draft', createdAt: daysAgo(40), updatedAt: daysAgo(1), createdBy: 'cbhanu12dec@gmail.com',
  },
  {
    id: 'dom_health', name: 'Healthcare', slug: 'healthcare', icon: '🩺',
    description: 'Clinical systems, patient data platforms and HIPAA-regulated health technology.',
    status: 'archived', createdAt: daysAgo(210), updatedAt: daysAgo(64), createdBy: 'cbhanu12dec@gmail.com',
  },
];

let subDomains = [
  { id: 'sub_storefront', domainId: 'dom_ecom', name: 'Storefront Engineering', description: 'Customer-facing catalogue, search and product detail experiences.', status: 'published', sortOrder: 1, createdAt: daysAgo(118), updatedAt: daysAgo(3) },
  { id: 'sub_checkout', domainId: 'dom_ecom', name: 'Checkout & Payments', description: 'Cart, checkout funnel, payment gateways and fraud handling.', status: 'published', sortOrder: 2, createdAt: daysAgo(110), updatedAt: daysAgo(9) },
  { id: 'sub_fulfil', domainId: 'dom_ecom', name: 'Fulfilment & Logistics', description: 'Order management, warehouse integration and delivery tracking.', status: 'draft', sortOrder: 3, createdAt: daysAgo(64), updatedAt: daysAgo(21) },
  { id: 'sub_merch', domainId: 'dom_ecom', name: 'Merchandising & Personalization', description: 'Recommendations, promotions and conversion optimisation.', status: 'draft', sortOrder: 4, createdAt: daysAgo(30), updatedAt: daysAgo(30) },

  { id: 'sub_core', domainId: 'dom_bank', name: 'Core Banking', description: 'Ledgers, account servicing and transaction processing.', status: 'published', sortOrder: 1, createdAt: daysAgo(94), updatedAt: daysAgo(11) },
  { id: 'sub_pay', domainId: 'dom_bank', name: 'Payments & Transfers', description: 'ACH, wires, real-time payments and settlement.', status: 'published', sortOrder: 2, createdAt: daysAgo(90), updatedAt: daysAgo(18) },
  { id: 'sub_risk', domainId: 'dom_bank', name: 'Risk & Compliance', description: 'KYC/AML, audit trails and regulatory reporting.', status: 'draft', sortOrder: 3, createdAt: daysAgo(70), updatedAt: daysAgo(25) },

  { id: 'sub_tenancy', domainId: 'dom_saas', name: 'Multi-tenancy & Platform', description: 'Tenant isolation, provisioning and platform scalability.', status: 'draft', sortOrder: 1, createdAt: daysAgo(38), updatedAt: daysAgo(1) },
  { id: 'sub_billing', domainId: 'dom_saas', name: 'Billing & Subscriptions', description: 'Metering, usage-based pricing and revenue recognition.', status: 'draft', sortOrder: 2, createdAt: daysAgo(22), updatedAt: daysAgo(4) },
];

const mkSkill = (domainId, subDomainId, name, category, priority, evidenceWeight, status, usageScore) =>
  ({ id: uid('sk'), domainId, subDomainId, name, category, priority, evidenceWeight, status, usageScore });

let skills = [
  // E-commerce / Storefront
  ...['React', 'Next.js', 'TypeScript', 'GraphQL', 'Server-side rendering', 'Core Web Vitals', 'Algolia', 'Elasticsearch', 'CDN caching', 'A/B testing']
    .map((n, i) => mkSkill('dom_ecom', 'sub_storefront', n, 'Primary Skills', i < 3 ? 'critical' : i < 6 ? 'high' : 'medium', i < 4 ? 'strong' : 'moderate', 'published', 90 - i * 6)),
  ...['Shopify', 'Magento', 'BigCommerce', 'commercetools', 'Salesforce Commerce Cloud']
    .map((n, i) => mkSkill('dom_ecom', 'sub_storefront', n, 'Platforms', i < 2 ? 'high' : 'medium', 'moderate', 'published', 62 - i * 7)),
  // E-commerce / Checkout
  ...['Stripe', 'Braintree', 'PCI DSS', 'Payment orchestration', '3-D Secure', 'Fraud detection', 'Idempotency', 'Webhooks']
    .map((n, i) => mkSkill('dom_ecom', 'sub_checkout', n, 'Payments', i < 3 ? 'critical' : 'high', i < 4 ? 'strong' : 'moderate', 'published', 88 - i * 5)),
  ...['Conversion rate', 'Cart abandonment', 'Funnel analytics', 'GA4', 'Mixpanel', 'Cohort analysis']
    .map((n, i) => mkSkill('dom_ecom', 'sub_checkout', n, 'Analytics', i < 2 ? 'high' : 'medium', 'moderate', 'published', 58 - i * 6)),
  // E-commerce / Fulfilment
  ...['Order management systems', 'WMS integration', 'Inventory sync', 'Carrier APIs', 'Returns processing']
    .map((n, i) => mkSkill('dom_ecom', 'sub_fulfil', n, 'Operations', i < 2 ? 'high' : 'medium', 'moderate', 'draft', 44 - i * 5)),

  // Banking
  ...['Java', 'Spring Boot', 'Kafka', 'Oracle', 'COBOL migration', 'Double-entry ledgers', 'Idempotent transactions']
    .map((n, i) => mkSkill('dom_bank', 'sub_core', n, 'Primary Skills', i < 3 ? 'critical' : 'high', i < 4 ? 'strong' : 'moderate', 'published', 92 - i * 6)),
  ...['ACH', 'SWIFT', 'ISO 20022', 'FedNow', 'Real-time settlement']
    .map((n, i) => mkSkill('dom_bank', 'sub_pay', n, 'Payments', i < 2 ? 'critical' : 'high', 'strong', 'published', 80 - i * 6)),
  ...['KYC', 'AML', 'SOX', 'PCI DSS', 'Audit logging', 'Regulatory reporting']
    .map((n, i) => mkSkill('dom_bank', 'sub_risk', n, 'Compliance', i < 3 ? 'high' : 'medium', 'moderate', 'draft', 55 - i * 5)),

  // SaaS
  ...['Multi-tenant architecture', 'Row-level security', 'Kubernetes', 'Terraform', 'Feature flags', 'Rate limiting']
    .map((n, i) => mkSkill('dom_saas', 'sub_tenancy', n, 'Primary Skills', i < 2 ? 'critical' : 'high', 'strong', 'draft', 70 - i * 6)),
  ...['Stripe Billing', 'Usage metering', 'Revenue recognition', 'Dunning', 'Proration']
    .map((n, i) => mkSkill('dom_saas', 'sub_billing', n, 'Billing', i < 2 ? 'high' : 'medium', 'moderate', 'draft', 50 - i * 5)),
];

let bulletPoints = [
  { id: uid('bp'), domainId: 'dom_ecom', subDomainId: 'sub_checkout', text: 'Rebuilt the checkout funnel on [platform], lifting conversion from [before]% to [after]% across [N]M monthly sessions.', category: 'Achievement', priority: 'high', evidenceRequirement: 'Use only when the candidate has real before/after conversion figures — never estimate them.', status: 'published', createdAt: daysAgo(80), updatedAt: daysAgo(9) },
  { id: uid('bp'), domainId: 'dom_ecom', subDomainId: 'sub_checkout', text: 'Integrated [payment provider] with idempotent retries, cutting failed-payment rate by [N]%.', category: 'Delivery', priority: 'high', evidenceRequirement: 'Requires evidence of payment gateway work; do not infer from generic API experience.', status: 'published', createdAt: daysAgo(75), updatedAt: daysAgo(20) },
  { id: uid('bp'), domainId: 'dom_ecom', subDomainId: 'sub_storefront', text: 'Reduced Largest Contentful Paint from [before]s to [after]s on [N] key templates, improving organic traffic [N]%.', category: 'Achievement', priority: 'medium', evidenceRequirement: 'Only when performance metrics are explicitly present in the source profile.', status: 'published', createdAt: daysAgo(60), updatedAt: daysAgo(14) },
  { id: uid('bp'), domainId: 'dom_ecom', subDomainId: 'sub_storefront', text: 'Led a team of [N] engineers delivering [feature] across [N] quarters.', category: 'Leadership', priority: 'medium', evidenceRequirement: 'Use only when the candidate genuinely held a lead or manager role.', status: 'draft', createdAt: daysAgo(30), updatedAt: daysAgo(30) },
  { id: uid('bp'), domainId: 'dom_bank', subDomainId: 'sub_core', text: 'Migrated [N]M accounts from [legacy system] to a distributed ledger with zero reconciliation breaks.', category: 'Achievement', priority: 'high', evidenceRequirement: 'Requires explicit migration experience with account volumes stated.', status: 'published', createdAt: daysAgo(88), updatedAt: daysAgo(11) },
  { id: uid('bp'), domainId: 'dom_bank', subDomainId: 'sub_risk', text: 'Implemented [regulation] controls across [N] services, clearing audit with zero findings.', category: 'Delivery', priority: 'high', evidenceRequirement: 'Only when a named regulation and audit outcome are both supported.', status: 'draft', createdAt: daysAgo(50), updatedAt: daysAgo(25) },
  { id: uid('bp'), domainId: 'dom_saas', subDomainId: 'sub_billing', text: 'Shipped usage-based billing for [N] tenants, growing expansion revenue [N]%.', category: 'Achievement', priority: 'medium', evidenceRequirement: 'Requires real revenue or tenant figures from the candidate profile.', status: 'draft', createdAt: daysAgo(20), updatedAt: daysAgo(4) },
];

let instructions = [
  { id: uid('in'), domainId: 'dom_ecom', subDomainId: null, instruction: 'Lead every experience bullet with a conversion, revenue or scale metric when the candidate evidence supports one.', category: 'Content Priority', priority: 'high', appliesTo: 'E-commerce', status: 'active', sortOrder: 1 },
  { id: uid('in'), domainId: 'dom_ecom', subDomainId: null, instruction: 'Prefer commerce vocabulary (GMV, AOV, conversion, cart abandonment) over generic software phrasing.', category: 'Content Priority', priority: 'high', appliesTo: 'E-commerce', status: 'active', sortOrder: 2 },
  { id: uid('in'), domainId: 'dom_ecom', subDomainId: 'sub_checkout', instruction: 'Surface PCI DSS and fraud-handling experience prominently for any payments-adjacent role.', category: 'Risk & Quality', priority: 'high', appliesTo: 'Checkout & Payments', status: 'active', sortOrder: 3 },
  { id: uid('in'), domainId: 'dom_ecom', subDomainId: null, instruction: 'Do not claim platform experience (Shopify, Magento) unless it is explicitly in the source profile.', category: 'Risk & Quality', priority: 'high', appliesTo: 'E-commerce', status: 'active', sortOrder: 4 },
  { id: uid('in'), domainId: 'dom_ecom', subDomainId: null, instruction: 'For lead or staff titles, foreground cross-team delivery over individual implementation detail.', category: 'Leadership', priority: 'medium', appliesTo: 'E-commerce', status: 'disabled', sortOrder: 5 },
  { id: uid('in'), domainId: 'dom_bank', subDomainId: null, instruction: 'Always name the specific regulation (SOX, PCI DSS, KYC/AML) rather than saying "compliance work".', category: 'Risk & Quality', priority: 'high', appliesTo: 'Banking & Financial Services', status: 'active', sortOrder: 1 },
  { id: uid('in'), domainId: 'dom_bank', subDomainId: 'sub_core', instruction: 'Emphasise transaction volume and correctness guarantees over framework names.', category: 'Technical', priority: 'high', appliesTo: 'Core Banking', status: 'active', sortOrder: 2 },
  { id: uid('in'), domainId: 'dom_saas', subDomainId: null, instruction: 'Frame work around tenant scale, retention and expansion revenue rather than raw feature counts.', category: 'Product Impact', priority: 'medium', appliesTo: 'B2B SaaS', status: 'active', sortOrder: 1 },
];

/* ======================= DERIVED COUNTS ======================= */

function countsForDomain(domainId) {
  return {
    subDomains: subDomains.filter(s => s.domainId === domainId).length,
    skills: skills.filter(s => s.domainId === domainId).length,
    bulletPoints: bulletPoints.filter(b => b.domainId === domainId).length,
    instructions: instructions.filter(i => i.domainId === domainId).length,
  };
}
function countsForSubDomain(subDomainId) {
  return {
    skills: skills.filter(s => s.subDomainId === subDomainId).length,
    bulletPoints: bulletPoints.filter(b => b.subDomainId === subDomainId).length,
    instructions: instructions.filter(i => i.subDomainId === subDomainId).length,
  };
}

// Mock latency, so skeleton states are exercised during development.
const delay = (ms = 140) => new Promise(r => setTimeout(r, ms));

export const domainLibraryApi = {
  async getStats() {
    await delay();
    return {
      totalDomains: domains.length,
      totalSubDomains: subDomains.length,
      totalSkills: skills.length,
      totalBulletPoints: bulletPoints.length,
      publishedCount: domains.filter(d => d.status === 'published').length,
      draftCount: domains.filter(d => d.status === 'draft').length,
    };
  },

  async getDomains() {
    await delay();
    return domains.map(d => ({ ...d, counts: countsForDomain(d.id) }));
  },

  async createDomain({ name, description = '', icon = '📁', status = 'draft' }) {
    await delay();
    const d = {
      id: uid('dom'), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description, icon, status, createdAt: nowISO(), updatedAt: nowISO(), createdBy: 'you',
    };
    domains = [d, ...domains];
    return { ...d, counts: countsForDomain(d.id) };
  },

  async updateDomain(id, patch) {
    await delay();
    domains = domains.map(d => d.id === id ? { ...d, ...patch, updatedAt: nowISO() } : d);
    const d = domains.find(x => x.id === id);
    return { ...d, counts: countsForDomain(id) };
  },

  async deleteDomain(id) {
    await delay();
    domains = domains.filter(d => d.id !== id);
    subDomains = subDomains.filter(s => s.domainId !== id);
    skills = skills.filter(s => s.domainId !== id);
    bulletPoints = bulletPoints.filter(b => b.domainId !== id);
    instructions = instructions.filter(i => i.domainId !== id);
    return { ok: true };
  },

  async getSubDomains(domainId) {
    await delay();
    return subDomains
      .filter(s => s.domainId === domainId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(s => ({ ...s, counts: countsForSubDomain(s.id) }));
  },

  async createSubDomain({ domainId, name, description, status = 'draft' }) {
    await delay();
    const s = {
      id: uid('sub'), domainId, name, description, status,
      sortOrder: subDomains.filter(x => x.domainId === domainId).length + 1,
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    subDomains = [...subDomains, s];
    return { ...s, counts: countsForSubDomain(s.id) };
  },

  async updateSubDomain(id, patch) {
    await delay();
    subDomains = subDomains.map(s => s.id === id ? { ...s, ...patch, updatedAt: nowISO() } : s);
    const s = subDomains.find(x => x.id === id);
    return { ...s, counts: countsForSubDomain(id) };
  },

  async deleteSubDomains(ids) {
    await delay();
    const set = new Set(ids);
    subDomains = subDomains.filter(s => !set.has(s.id));
    skills = skills.filter(s => !set.has(s.subDomainId));
    bulletPoints = bulletPoints.filter(b => !set.has(b.subDomainId));
    instructions = instructions.filter(i => !set.has(i.subDomainId));
    return { ok: true };
  },

  async bulkUpdateSubDomains(ids, patch) {
    await delay();
    const set = new Set(ids);
    subDomains = subDomains.map(s => set.has(s.id) ? { ...s, ...patch, updatedAt: nowISO() } : s);
    return { ok: true };
  },

  async getSkills(domainId) {
    await delay();
    return skills.filter(s => s.domainId === domainId);
  },

  async addSkills(domainId, names, meta) {
    await delay();
    const created = names.map(name => mkSkill(
      domainId, meta.subDomainId || null, name,
      meta.category || 'Primary Skills', meta.priority || 'medium',
      meta.evidenceWeight || 'moderate', meta.status || 'draft', 0,
    ));
    skills = [...skills, ...created];
    return created;
  },

  async updateSkill(id, patch) {
    await delay();
    skills = skills.map(s => s.id === id ? { ...s, ...patch } : s);
    return skills.find(s => s.id === id);
  },

  async bulkUpdateSkills(ids, patch) {
    await delay();
    const set = new Set(ids);
    skills = skills.map(s => set.has(s.id) ? { ...s, ...patch } : s);
    return { ok: true };
  },

  async deleteSkills(ids) {
    await delay();
    const set = new Set(ids);
    skills = skills.filter(s => !set.has(s.id));
    return { ok: true };
  },

  async getBulletPoints(domainId) {
    await delay();
    return bulletPoints.filter(b => b.domainId === domainId);
  },

  async saveBulletPoint(bp) {
    await delay();
    if (bp.id) {
      bulletPoints = bulletPoints.map(b => b.id === bp.id ? { ...b, ...bp, updatedAt: nowISO() } : b);
      return bulletPoints.find(b => b.id === bp.id);
    }
    const created = { ...bp, id: uid('bp'), createdAt: nowISO(), updatedAt: nowISO() };
    bulletPoints = [...bulletPoints, created];
    return created;
  },

  async deleteBulletPoint(id) {
    await delay();
    bulletPoints = bulletPoints.filter(b => b.id !== id);
    return { ok: true };
  },

  async getInstructions(domainId) {
    await delay();
    return instructions.filter(i => i.domainId === domainId).sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async saveInstruction(ins) {
    await delay();
    if (ins.id) {
      instructions = instructions.map(i => i.id === ins.id ? { ...i, ...ins } : i);
      return instructions.find(i => i.id === ins.id);
    }
    const created = {
      ...ins, id: uid('in'),
      sortOrder: instructions.filter(i => i.domainId === ins.domainId).length + 1,
    };
    instructions = [...instructions, created];
    return created;
  },

  async reorderInstructions(domainId, orderedIds) {
    await delay(60);
    const rank = new Map(orderedIds.map((id, i) => [id, i + 1]));
    instructions = instructions.map(i => rank.has(i.id) ? { ...i, sortOrder: rank.get(i.id) } : i);
    return { ok: true };
  },

  async deleteInstruction(id) {
    await delay();
    instructions = instructions.filter(i => i.id !== id);
    return { ok: true };
  },

  // Analytics pipeline doesn't exist yet — §4 Phase G ships on mocked numbers.
  async getUsage(domainId) {
    await delay();
    const c = countsForDomain(domainId);
    return {
      runs: 120 + c.skills * 3,
      matchedJobs: 40 + c.subDomains * 7,
      avgMatch: 78 + (c.instructions % 12),
      lastUsed: daysAgo(2),
    };
  },
};

/* ============ Publish validation — shared by dialog + toggle ============ */
export function validateDomainForPublish(domain, { subDomains: subs = [], skills: sk = [], instructions: ins = [] }) {
  const checks = [
    { id: 'description', label: 'Has a description', pass: Boolean(domain?.description?.trim()), tab: 'overview' },
    { id: 'subdomain', label: 'At least 1 sub-domain', pass: subs.length >= 1, tab: 'sub-domains' },
    { id: 'skills', label: 'At least 3 skills', pass: sk.length >= 3, tab: 'skills' },
    { id: 'instruction', label: 'At least 1 agent instruction', pass: ins.length >= 1, tab: 'instructions' },
  ];
  return { checks, ok: checks.every(c => c.pass) };
}
