import { readFileSync } from 'node:fs';

// Acceptance tests for the Flow A (tailor) ATS audit.
// Run with: node functions/test/flowA.test.mjs
//
// The helpers are sliced out of index.js and evaluated standalone so the suite
// runs without firebase-admin credentials or a deployed function.
const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const between = (a, b) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`could not slice ${a}`);
  return src.slice(i, j);
};
const code = between('const ATS_MIN_KEYWORD_COVERAGE', 'exports.claudeProxy');
const M = new Function(`${code}; return { auditAts, atsRepairInstruction, extractJdTerms, detectShallowInserts, presenceChecker, ATS_TARGET_QUANT_RATIO };`)();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
};
const resumeOf = bullets => ({
  name: 'Test', sections: [{ heading: 'PROFESSIONAL EXPERIENCE', entries: [{ title: 'Engineer', bullets }] }]
});

/* ---------------------------------------------------------------- Fix 1 */
console.log('\nFix 1 — SHALLOW_INSERT detection');
{
  const original = 'Built an automated reporting pipeline that consolidated schedule and financial information across eight workstreams, reducing weekly preparation effort by 40 percent.';
  // Same sentence, one word swapped to insert "Kubernetes".
  const shallow  = 'Built an automated Kubernetes pipeline that consolidated schedule and financial information across eight workstreams, reducing weekly preparation effort by 40 percent.';
  // Genuinely rebuilt from the same underlying fact.
  const rebuilt  = 'Cut weekly reporting effort 40% by replacing a manual consolidation process with a Kubernetes-orchestrated job spanning 8 workstreams.';

  const a = M.auditAts(resumeOf([shallow]), [{ term: 'kubernetes', tier: 'critical' }], [original]);
  check('flags a keyword-inserted bullet', a.shallowInsertBullets.length === 1,
    JSON.stringify(a.shallowInsertBullets));
  check('records keyword and overlap', a.shallowInsertBullets[0]?.keyword === 'kubernetes' && a.shallowInsertBullets[0]?.overlap > 80,
    JSON.stringify(a.shallowInsertBullets[0]));

  const b = M.auditAts(resumeOf([rebuilt]), [{ term: 'kubernetes', tier: 'critical' }], [original]);
  check('does NOT flag a genuine rewrite', b.shallowInsertBullets.length === 0,
    JSON.stringify(b.shallowInsertBullets));

  // Coverage 100%, quantification 100%, no hygiene issues — only the insert is wrong.
  check('coverage is otherwise clean', a.keywordCoverage === 100 && a.quantificationRatio === 1
    && a.weakOpenerBullets.length === 0 && a.pronounBullets.length === 0);
  const instr = M.atsRepairInstruction(a);
  check('repair feedback mentions the rewrite failure', /keyword-inserted, not rewritten/.test(instr));
  check('repair feedback names the keyword', /swap in "kubernetes"/.test(instr));
}

/* ---------------------------------------------------------------- Fix 2 */
console.log('\nFix 2 — tiered keyword importance');
{
  const jd = `
Senior Platform Engineer. We need Kubernetes expertise.
Kubernetes clusters run our production workloads. You will operate Kubernetes daily.
Deep Kubernetes knowledge is essential. Kubernetes certification is a plus.
Experience with Postgres is expected, and Postgres tuning matters.
Familiarity with Grafana is useful.
`;
  const terms = M.extractJdTerms(jd);
  const byTerm = Object.fromEntries(terms.map(t => [t.term, t]));
  check('high-frequency term is critical', byTerm.kubernetes?.tier === 'critical', JSON.stringify(byTerm.kubernetes));
  check('mid-frequency term is important', byTerm.postgres?.tier === 'important', JSON.stringify(byTerm.postgres));
  check('single-mention name is supporting', byTerm.grafana?.tier === 'supporting', JSON.stringify(byTerm.grafana));

  // None of them present in the draft -> all missing, ordering must be tiered.
  const audit = M.auditAts(resumeOf(['Wrote documentation for the release process across 3 teams.']), terms, null);
  const order = audit.missingByTier.map(m => m.term);
  check('critical sorts ahead of supporting',
    order.indexOf('kubernetes') < order.indexOf('grafana'), order.join(' < '));
  check('critical sorts ahead of important',
    order.indexOf('kubernetes') < order.indexOf('postgres'), order.join(' < '));
  const instr = M.atsRepairInstruction(audit);
  check('feedback labels tiers', /kubernetes \(critical\)/.test(instr) && /grafana \(supporting\)/.test(instr));
  check('feedback lists critical first', instr.indexOf('kubernetes') < instr.indexOf('grafana'));

  // Union: model term absent from server list defaults to important, and a
  // term in both keeps the higher tier.
  const merged = M.auditAts(resumeOf(['nothing relevant here at all, really']),
    [{ term: 'kubernetes', tier: 'critical' }, { term: 'kubernetes', tier: 'important' }], null);
  check('duplicate term keeps higher tier',
    merged.missingByTier.length === 1 && merged.missingByTier[0].tier === 'critical',
    JSON.stringify(merged.missingByTier));
}

/* ---------------------------------------------------------------- Fix 3 */
console.log('\nFix 3 — real keyword matching (no substring bug)');
{
  const r = resumeOf(['Administered the production database and tuned slow queries for the leaderboard service.']);
  const a = M.auditAts(r, [{ term: 'data', tier: 'critical' }], null);
  check('"database" does NOT satisfy "data"', a.missingKeywords.includes('data'), JSON.stringify(a.missingKeywords));

  const b = M.auditAts(resumeOf(['Built data pipelines processing 40M rows daily.']), [{ term: 'data', tier: 'critical' }], null);
  check('standalone "data" IS matched', b.missingKeywords.length === 0, JSON.stringify(b.missingKeywords));

  const c = M.auditAts(resumeOf(['Leading a team of 6 engineers across two regions.']), [{ term: 'lead', tier: 'important' }], null);
  check('"leading" satisfies "lead" via stemming', c.missingKeywords.length === 0, JSON.stringify(c.missingKeywords));

  const d = M.auditAts(r, [{ term: 'lead', tier: 'important' }], null);
  check('"leaderboard" does NOT satisfy "lead"', d.missingKeywords.includes('lead'), JSON.stringify(d.missingKeywords));

  const e = M.auditAts(resumeOf(['Shipped CI/CD for .NET services written in C#.']),
    [{ term: 'ci/cd', tier: 'critical' }, { term: '.net', tier: 'important' }, { term: 'c#', tier: 'important' }], null);
  check('punctuated tech tokens still match', e.missingKeywords.length === 0, JSON.stringify(e.missingKeywords));
}

/* ---------------------------------------------------------------- Fix 4 */
console.log('\nFix 4 — repair gate split');
{
  // Mirrors the predicates in the tailor flow.
  const hasCorrectnessIssue = (r) =>
    r.audit.shallowInsertBullets.length > 0 ||
    r.audit.missingKeywords.length > 0 ||
    r.audit.weakOpenerBullets.length > 0 ||
    r.audit.pronounBullets.length > 0 ||
    r.audit.buzzwordBullets.length > 0 ||
    (r.audit.totalBullets > 0 && r.audit.quantificationRatio < M.ATS_TARGET_QUANT_RATIO);
  const repairIsWorthIt = (r) => hasCorrectnessIssue(r) || r.roleSimilarity >= 60;

  const missingAudit = M.auditAts(resumeOf(['Ran 12 releases without a rollback.']), [{ term: 'terraform', tier: 'critical' }], null);
  check('roleSimilarity 40 + missing keywords still repairs',
    repairIsWorthIt({ audit: missingAudit, roleSimilarity: 40 }) === true);

  const shallowAudit = M.auditAts(
    resumeOf(['Built an automated Terraform reporting pipeline that consolidated schedule and financial data across eight workstreams, reducing effort by 40 percent.']),
    [{ term: 'terraform', tier: 'critical' }],
    ['Built an automated reporting pipeline that consolidated schedule and financial data across eight workstreams, reducing effort by 40 percent.']);
  check('roleSimilarity 30 + shallow insert still repairs',
    repairIsWorthIt({ audit: shallowAudit, roleSimilarity: 30 }) === true,
    `shallow=${shallowAudit.shallowInsertBullets.length}`);

  const cleanAudit = M.auditAts(
    resumeOf(['Cut deployment time 60% by rebuilding the release pipeline on Terraform across 12 services.']),
    [{ term: 'terraform', tier: 'critical' }], null);
  check('roleSimilarity 40 + clean draft does NOT repair',
    repairIsWorthIt({ audit: cleanAudit, roleSimilarity: 40 }) === false,
    JSON.stringify({ missing: cleanAudit.missingKeywords, q: cleanAudit.quantificationRatio }));
  check('roleSimilarity 75 + clean draft still allowed (tone band)',
    repairIsWorthIt({ audit: cleanAudit, roleSimilarity: 75 }) === true);
}

/* ---------------------------------------------------------------- Fix 5 */
console.log('\nFix 5 — cache transparency');
{
  const hit = src.match(/tag: 'tailor_cache_hit'[\s\S]{0,220}/)?.[0] || '';
  check('cache-hit path returns cached: true', /cached: true/.test(hit));
  check('fresh path returns cached: false', /creditsRemaining: remainingAfterSpend, cached: false/.test(src));
  check('cache hit spends no credit (returns before spendCreditOrThrow)',
    src.indexOf("tag: 'tailor_cache_hit'") < src.indexOf('const remainingAfterSpend'));
}

/* ------------------------------------------------------ Flow B untouched */
console.log('\nRegression — Flow B calling convention');
{
  const a = M.auditAts(resumeOf(['Delivered 4 releases across 2 regions.']), [], null);
  check('auditAts(content, []) still yields null coverage', a.keywordCoverage === null);
  check('no shallow inserts without originals', a.shallowInsertBullets.length === 0);
  const flowB = { ...a, missingKeywords: ['Kafka experience', 'Snowflake modelling (only partially covered)'] };
  const instr = M.atsRepairInstruction(flowB);
  check('plain string missing lists still render', /Kafka experience, Snowflake modelling/.test(instr), instr);
  check('no tier labels leak into Flow B feedback', !/\(critical\)|\(supporting\)/.test(instr));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
