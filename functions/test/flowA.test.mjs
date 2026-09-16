import { readFileSync } from 'node:fs';

// Acceptance tests for the Flow A (tailor) ATS audit.
// Run with: node functions/test/flowA.test.mjs
//
// The helpers are sliced out of index.js and evaluated standalone so the suite
// runs without firebase-admin credentials or a deployed function.
const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const clientSrc = readFileSync(new URL('../../src/lib/claude.js', import.meta.url), 'utf8');
const agentSrc = readFileSync(new URL('../../src/components/AgentView.jsx', import.meta.url), 'utf8');
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

/* ---------------------------------------------------------------- Fix 8 */
console.log('\nFix 8 — no silent failure on structured-output calls');
{
  check('jdBreakdown uses the safe JSON helper',
    /callAnthropicJson\(apiKey, prompt, \{[\s\S]{0,160}logTag: 'jdBreakdown'/.test(src));
  check('jdBreakdown no longer parses raw inline',
    !/JSON\.parse\(stripJsonFence\(raw\)\) \};\s*\n\s*\}\s*\n\s*if \(task === 'resumeHealth'/.test(src));
  check('jdBreakdown runs on Sonnet, not Haiku',
    /model: MODEL_QUALITY, maxTokens: 5000, logTag: 'jdBreakdown'/.test(src));
  check('token budget raised well above the 1600 that truncated',
    /maxTokens: 5000, logTag: 'jdBreakdown'/.test(src));
  check('failure throws instead of returning a silent null',
    /if \(!data\) throw new HttpsError\('internal', `JD breakdown failed/.test(src));
  check('degraded flag is returned to the client', /return \{ json: data, degraded, degradedReason: reason \}/.test(src));

  // Truncation must be detected before parsing and retried once.
  check('completeness check runs before JSON.parse', src.indexOf("const closed = /[}\\]]$/") < src.indexOf('JSON.parse(best.cleaned)'));
  check('truncation is retried with a raised ceiling', /retryingWith: bigger/.test(src));
  check('truncation is logged distinctly from malformed',
    /tag: 'structured_json_truncated'/.test(src) && /reason === 'truncated'/.test(src));
  check('raw body is logged on failure', /rawSample: String\(raw \|\| ''\)\.slice\(0, 1200\)/.test(src));
  check('client logs a degraded breakdown', /\[jdBreakdown\] degraded result:/.test(clientSrc));
  check('client no longer swallows the failure silently',
    !/console\.warn\('JD breakdown failed \(non-fatal\)/.test(agentSrc)
    && /keyword panel will be empty/.test(agentSrc));
}

/* -------------------------------------------------------------- Fix 0.3 */
console.log('\nFix 0.3 — reference menu, not mandate');
{
  check('patterns are framed as illustrative reference',
    /illustrative examples of sentence structures that work well, offered as reference/.test(src));
  check('prompt forbids forcing every bullet into a shape',
    /Do NOT force every bullet into one of these exact shapes/.test(src));
  check('prompt forbids cycling the list as a checklist', /do not cycle through them as a checklist/.test(src));
  check('mandate wording is gone',
    !/Select the architecture that fits what the evidence actually shows/.test(src));
  check('the real invariant is still stated',
    /the original sentence must not simply be tweaked/.test(src));

  // Soft variety check.
  const same = resumeOf([
    'Partnered with finance to define the quarterly forecast, cutting cycle time 20%.',
    'Partnered with engineering to decide the migration sequence across 6 services.',
    'Partnered with operations to agree the rollout plan for 12 regions.',
  ]);
  const a = M.auditAts(same, [], null);
  check('3 consecutive identical openers are detected', !!a.repeatedOpeners, JSON.stringify(a.repeatedOpeners));
  check('detected opener is reported', a.repeatedOpeners?.opener === 'partner', JSON.stringify(a.repeatedOpeners));
  check('variety alone produces NO repair instruction', M.atsRepairInstruction(a) === '',
    JSON.stringify(M.atsRepairInstruction(a)));

  // Paired with a real violation, it rides along as a style note.
  const withViolation = { ...a, missingKeywords: ['kafka'], missingRanked: [{ term: 'kafka', level: 'must-have', count: 3 }] };
  const instr = M.atsRepairInstruction(withViolation);
  check('variety note appears when a real violation exists', /Style note, not a defect/.test(instr));
  check('variety note is never the first instruction', !instr.trim().startsWith('1. Style note'));

  const varied = M.auditAts(resumeOf([
    'Partnered with finance to define the quarterly forecast, cutting cycle time 20%.',
    'Rebuilt the ingestion pipeline across 6 services, halving failure rate.',
    'Identified a vendor dependency six weeks out and resequenced the rollout.',
  ]), [], null);
  check('varied openers are not flagged', varied.repeatedOpeners === null, JSON.stringify(varied.repeatedOpeners));

  // The variety signal must not reach the repair gates.
  check('variety is absent from needsRepair inputs',
    !/repeatedOpeners/.test(src.slice(src.indexOf('const needsRepair'), src.indexOf('const repairIsWorthIt'))));
}

/* ------------------------------------------------- Fix 8 (behavioural) */
console.log('\nFix 8 — truncation handling, exercised');
{
  // Build callAnthropicJson against a stubbed transport so the retry and
  // degrade paths run for real rather than being asserted from source text.
  const helperSrc = between('async function callAnthropicJson', '// Models reach for em/en dashes');

  const make = (responder) => {
    const logs = [];
    const fn = new Function('callAnthropic', 'stripJsonFence', 'console', `
      ${helperSrc}
      return callAnthropicJson;`)(
      responder,
      t => t.replace(/```json/gi, '').replace(/```/g, '').trim(),
      { log: (...a) => logs.push(['log', ...a]), warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]) }
    );
    return { fn, logs };
  };

  const COMPLETE = '{"matchMatrix":[{"term":"kafka","status":"strong"}],"domain":"fintech"}';
  const TRUNCATED = '{"matchMatrix":[{"term":"kafka","status":"stro';

  // 1. Truncated first, complete on retry with a bigger ceiling.
  {
    const seen = [];
    const { fn, logs } = make(async (_k, _p, o) => { seen.push(o.maxTokens); return seen.length === 1 ? TRUNCATED : COMPLETE; });
    const r = await fn('k', 'p', { maxTokens: 100, logTag: 'jdBreakdown' });
    check('truncated response triggers a retry', seen.length === 2, JSON.stringify(seen));
    check('retry uses a raised ceiling', seen[1] > seen[0], JSON.stringify(seen));
    check('retry success returns parsed data', r.data?.domain === 'fintech' && r.degraded === false, JSON.stringify(r));
    check('truncation is logged', logs.some(l => JSON.stringify(l).includes('structured_json_truncated')));
  }

  // 2. Truncated on both attempts -> degraded, with the raw body logged.
  {
    const { fn, logs } = make(async () => TRUNCATED);
    const r = await fn('k', 'p', { maxTokens: 100, logTag: 'jdBreakdown' });
    check('persistent truncation degrades rather than throwing', r.data === null && r.degraded === true);
    check('reason distinguishes truncation from malformed', r.reason === 'truncated', r.reason);
    const err = logs.find(l => JSON.stringify(l).includes('structured_json_failure'));
    check('raw body is logged on failure', !!err && JSON.stringify(err).includes('kafka'));
    // err[1] is the already-stringified payload; parse it rather than
    // substring-matching the double-encoded outer form.
    const payload = err ? JSON.parse(err[1]) : {};
    check('failure log marks it as truncation', payload.looksTruncated === true, JSON.stringify(payload));
    check('failure log records the token ceiling used', payload.maxTokens > 0, JSON.stringify(payload));
  }

  // 3. Well-formed envelope but invalid JSON -> malformed, no retry.
  {
    const seen = [];
    const { fn } = make(async (_k, _p, o) => { seen.push(o.maxTokens); return '{"a":,}'; });
    const r = await fn('k', 'p', { maxTokens: 100, logTag: 'jdBreakdown' });
    check('malformed JSON is not retried as truncation', seen.length === 1, JSON.stringify(seen));
    check('malformed is reported distinctly', r.degraded === true && r.reason === 'malformed', JSON.stringify(r));
  }

  // 4. Transport failure never throws out of the helper.
  {
    const { fn } = make(async () => { throw new Error('network down'); });
    const r = await fn('k', 'p', { maxTokens: 100, logTag: 'jdBreakdown' });
    check('transport errors degrade instead of throwing', r.data === null && r.reason === 'call_failed', JSON.stringify(r));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
