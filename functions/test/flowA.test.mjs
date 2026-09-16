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
const M = new Function(`${code}; return { auditAts, atsRepairInstruction, extractJdTerms, mergeRequiredTerms, detectShallowInserts, presenceChecker, ATS_TARGET_QUANT_RATIO };`)();

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

  const a = M.auditAts(resumeOf([shallow]), [{ term: 'kubernetes', level: 'must-have' }], [original]);
  check('flags a keyword-inserted bullet', a.shallowInsertBullets.length === 1,
    JSON.stringify(a.shallowInsertBullets));
  check('records keyword and overlap', a.shallowInsertBullets[0]?.keyword === 'kubernetes' && a.shallowInsertBullets[0]?.overlap > 80,
    JSON.stringify(a.shallowInsertBullets[0]));

  const b = M.auditAts(resumeOf([rebuilt]), [{ term: 'kubernetes', level: 'must-have' }], [original]);
  check('does NOT flag a genuine rewrite', b.shallowInsertBullets.length === 0,
    JSON.stringify(b.shallowInsertBullets));

  // Coverage 100%, quantification 100%, no hygiene issues — only the insert is wrong.
  check('coverage is otherwise clean', a.keywordCoverage === 100 && a.quantificationRatio === 1
    && a.weakOpenerBullets.length === 0 && a.pronounBullets.length === 0);
  const instr = M.atsRepairInstruction(a);
  check('repair feedback mentions the rewrite failure', /keyword-inserted, not rewritten/.test(instr));
  check('repair feedback names the keyword', /swap in "kubernetes"/.test(instr));
}

/* ------------------------------------------------------------- Fix 2 + 7 */
console.log('\nFix 2 + 7 — frequency sub-signal merged into semantic ranking');
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
  check('frequency sub-signal: high', byTerm.kubernetes?.freqTier === 'high', JSON.stringify(byTerm.kubernetes));
  check('frequency sub-signal: mid', byTerm.postgres?.freqTier === 'mid', JSON.stringify(byTerm.postgres));
  check('frequency sub-signal: named', byTerm.grafana?.freqTier === 'named', JSON.stringify(byTerm.grafana));
  check('mention counts retained', byTerm.kubernetes?.count >= 4, JSON.stringify(byTerm.kubernetes));

  // Fix 7 acceptance: a once-mentioned gating credential must outrank a
  // four-times-repeated optional term.
  const jd2 = `
Program Manager. Requires active PMP certification.
Familiarity with Grafana is a bonus. We use Grafana dashboards.
Grafana experience is a plus. Grafana exposure helps.
We are collaborative and value collaborative delivery in a collaborative team.
`;
  const freq = M.extractJdTerms(jd2);
  const fByTerm = Object.fromEntries(freq.map(t => [t.term, t]));
  check('"grafana" really is higher frequency than "pmp"',
    (fByTerm.grafana?.count || 0) > (fByTerm.pmp?.count || 0),
    JSON.stringify({ grafana: fByTerm.grafana, pmp: fByTerm.pmp }));
  // Generic workplace language never reaches the ranker at all, which is a
  // stronger outcome than ranking it low.
  check('generic filler is filtered at extraction', !fByTerm.collaborative,
    JSON.stringify(freq.map(t => t.term)));

  const ranked = M.mergeRequiredTerms(freq, [], [
    { term: 'pmp', level: 'must-have' },
    { term: 'grafana', level: 'nice-to-have' },
  ]);
  const audit = M.auditAts(resumeOf(['Shipped 9 releases across 3 teams in one year.']), ranked, null);
  const order = audit.missingRanked.map(m => m.term);
  check('single-mention must-have outranks 4x nice-to-have',
    order.indexOf('pmp') >= 0 && order.indexOf('pmp') < order.indexOf('grafana'), order.join(' < '));
  const instr = M.atsRepairInstruction(audit);
  check('feedback labels must-have', /pmp \(must-have\)/.test(instr));
  check('feedback labels nice-to-have', /grafana \(nice-to-have\)/.test(instr));
  check('feedback lists must-have first', instr.indexOf('pmp') < instr.indexOf('grafana'));

  // Frequency still breaks ties inside one level.
  const sameLevel = M.mergeRequiredTerms(
    [{ term: 'alpha', count: 2 }, { term: 'beta', count: 9 }], [], []);
  const tie = M.auditAts(resumeOf(['nothing relevant at all here']), sameLevel, null);
  check('frequency breaks ties within a level',
    tie.missingRanked[0].term === 'beta', tie.missingRanked.map(m => m.term).join(' < '));

  const dup = M.mergeRequiredTerms([{ term: 'kafka', count: 5 }], ['kafka'], [{ term: 'kafka', level: 'must-have' }]);
  check('duplicate term resolves to one entry at the higher level',
    dup.length === 1 && dup[0].level === 'must-have' && dup[0].count === 5, JSON.stringify(dup));
  check('model-only term defaults to differentiator',
    M.mergeRequiredTerms([], ['snowflake'], [])[0].level === 'differentiator');
}

/* ---------------------------------------------------------------- Fix 6 */
console.log('\nFix 6 — domain-adjacent skills, split by risk');
{
  const source = [
    'Managed the product roadmap for a payments platform across four squads, shipping 18 releases in a year.',
    'Ran quarterly planning with finance and operations leadership covering a $4M budget.',
  ];
  const domainSpecific = ['PCI DSS', 'SOC 2', 'HIPAA'];

  // 6b guardrail: the candidate has payments experience but never mentions
  // PCI DSS. The rewrite claiming it must be caught.
  const fabricated = resumeOf([
    'Led the payments platform roadmap across 4 squads under PCI DSS compliance, shipping 18 releases.',
    'Drove quarterly planning with finance and operations over a $4M budget.',
  ]);
  const a = M.auditAts(fabricated, [{ term: 'payments', level: 'must-have' }], source, domainSpecific);
  check('fabricated domain claim is caught', a.fabricatedClaims.includes('PCI DSS'), JSON.stringify(a.fabricatedClaims));
  check('unclaimed domain terms are not flagged',
    !a.fabricatedClaims.includes('HIPAA') && !a.fabricatedClaims.includes('SOC 2'), JSON.stringify(a.fabricatedClaims));

  const instr = M.atsRepairInstruction(a);
  check('repair demands removal', /Remove every one of them/.test(instr));
  check('fabrication leads the repair list', instr.trim().startsWith('1. Your draft claims'));

  // Same term, but the source resume does evidence it -> allowed.
  const evidenced = M.auditAts(fabricated, [{ term: 'payments', level: 'must-have' }],
    [...source, 'Owned PCI DSS audit remediation for the cardholder data environment.'], domainSpecific);
  check('evidenced domain term is NOT flagged', evidenced.fabricatedClaims.length === 0, JSON.stringify(evidenced.fabricatedClaims));

  // 6a generic language is never treated as a claim.
  const generic = M.auditAts(
    resumeOf(['Led cross-functional stakeholder management across 4 squads, shipping 18 releases.']),
    [], source, domainSpecific);
  check('generic ways-of-working are not fabrication', generic.fabricatedClaims.length === 0);

  // Domain claims never inflate or deflate coverage.
  const noClaims = M.auditAts(resumeOf(['Led the payments roadmap across 4 squads.']),
    [{ term: 'payments', level: 'must-have' }], source, domainSpecific);
  check('domain claims are excluded from coverage', noClaims.keywordCoverage === 100 && noClaims.totalRequired === 1,
    JSON.stringify({ c: noClaims.keywordCoverage, n: noClaims.totalRequired }));
}

/* ---------------------------------------------------------------- Fix 3 */
console.log('\nFix 3 — real keyword matching (no substring bug)');
{
  const r = resumeOf(['Administered the production database and tuned slow queries for the leaderboard service.']);
  const a = M.auditAts(r, [{ term: 'data', level: 'must-have' }], null);
  check('"database" does NOT satisfy "data"', a.missingKeywords.includes('data'), JSON.stringify(a.missingKeywords));

  const b = M.auditAts(resumeOf(['Built data pipelines processing 40M rows daily.']), [{ term: 'data', level: 'must-have' }], null);
  check('standalone "data" IS matched', b.missingKeywords.length === 0, JSON.stringify(b.missingKeywords));

  const c = M.auditAts(resumeOf(['Leading a team of 6 engineers across two regions.']), [{ term: 'lead', level: 'differentiator' }], null);
  check('"leading" satisfies "lead" via stemming', c.missingKeywords.length === 0, JSON.stringify(c.missingKeywords));

  const d = M.auditAts(r, [{ term: 'lead', level: 'differentiator' }], null);
  check('"leaderboard" does NOT satisfy "lead"', d.missingKeywords.includes('lead'), JSON.stringify(d.missingKeywords));

  const e = M.auditAts(resumeOf(['Shipped CI/CD for .NET services written in C#.']),
    [{ term: 'ci/cd', level: 'must-have' }, { term: '.net', level: 'differentiator' }, { term: 'c#', level: 'differentiator' }], null);
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
    [{ term: 'terraform', level: 'must-have' }], null);
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
  check('no fabrication flags without domain claims', a.fabricatedClaims.length === 0);
  const flowB = { ...a, missingKeywords: ['Kafka experience', 'Snowflake modelling (only partially covered)'] };
  const instr = M.atsRepairInstruction(flowB);
  check('plain string missing lists still render', /Kafka experience, Snowflake modelling/.test(instr), instr);
  check('no level labels leak into Flow B feedback', !/\(must-have\)|\(nice-to-have\)/.test(instr));
  check('no fabrication flags without domain claims', a.fabricatedClaims.length === 0);
}

/* ---------------------------------------------------------------- Fix 0 */
console.log('\nFix 0 — evidence-first pipeline wired into the prompt');
{
  const stages = [
    'STAGE 1 — CLASSIFY THE REQUIREMENTS',
    'STAGE 2 — MAP EVIDENCE, BEFORE WRITING ANYTHING',
    'STAGE 3 — RECONSTRUCT EACH BULLET FROM THE EVIDENCE',
    'STAGE 4 — PLACE KEYWORDS LAST',
    'STAGE 5 — DISTRIBUTE ACROSS EMPLOYERS',
    'STAGE 6 — QUANTIFY, THEN CHECK CREDIBILITY',
  ];
  for (const s of stages) check(`prompt declares ${s.split('—')[0].trim()}`, src.includes(s));
  check('stages appear in order',
    stages.every((s, i) => i === 0 || src.indexOf(s) > src.indexOf(stages[i - 1])));

  const patterns = ['Delivery:', 'Stakeholder:', 'Problem solving:', 'Technical:', 'Process improvement:', 'Analytics:', 'Risk:'];
  for (const p of patterns) check(`architecture includes ${p.replace(':', '')}`, src.includes(`- ${p}`));

  check('keywords are placed after reconstruction', src.indexOf('STAGE 3') < src.indexOf('STAGE 4'));
  check('pre-classified requirement block is sent', src.includes('JD REQUIREMENTS, PRE-CLASSIFIED'));
  check('6a block is separate', src.includes('DOMAIN WAYS OF WORKING'));
  check('6b block is separate', src.includes('DOMAIN-SPECIFIC CLAIMS'));
  check('6b is evidence-gated in the prompt', /Domain typicality is not evidence/.test(src));
  check('intensity cannot skip the rebuild', /never permits skipping Stages 2, 4 or 5/.test(src));
  check('domainSpecific never enters the required-terms list',
    /mergeRequiredTerms\(jdTerms, requiredKeywords, intel\.keywordImportance\)/.test(src)
    && !/mergeRequiredTerms\([^)]*domainSpecific/.test(src));
  check('jdIntel is plumbed into the tailor payload', /experimentalFastModel, jdIntel \} = payload/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
