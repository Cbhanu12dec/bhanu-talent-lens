// Block-level editing: identity, pinning through regeneration, diffing.
// Run with: node functions/test/blocks.test.mjs
import { readFileSync } from 'node:fs';
import {
  listBlocks, findBlock, setBlockText, applyPinnedBlocks,
  diffWords, hasPlaceholder, paragraphId, bulletId,
} from '../../src/lib/resumeBlocks.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
};

const resumeV1 = () => ({
  name: 'X',
  sections: [
    { heading: 'PROFESSIONAL SUMMARY', paragraphs: ['Original summary sentence.'] },
    { heading: 'PROFESSIONAL EXPERIENCE', entries: [
      { title: 'Technical Project Manager', subtitle: 'TD Bank', bullets: ['Bullet A original.', 'Bullet B original.'] },
      { title: 'Program Analyst', subtitle: 'Acme', bullets: ['Bullet C original.'] },
    ] },
  ],
});

/* ------------------------------------------------------------- identity */
console.log('\nBlock identity');
{
  const blocks = listBlocks(resumeV1());
  check('every block is listed', blocks.length === 4, String(blocks.length));
  check('ids are unique', new Set(blocks.map(b => b.id)).size === 4);
  check('paragraph id is derived from heading + index',
    blocks[0].id === paragraphId('PROFESSIONAL SUMMARY', 0), blocks[0].id);
  check('bullet id carries the entry title',
    blocks[1].id === bulletId('PROFESSIONAL EXPERIENCE', 'Technical Project Manager', 0, 0), blocks[1].id);
  check('ids are stable across identical documents',
    listBlocks(resumeV1()).map(b => b.id).join() === blocks.map(b => b.id).join());
  check('sibling context is available for bullets',
    blocks[1].entryTitle === 'Technical Project Manager' && blocks[1].kind === 'bullet');
}

/* --------------------------------------------------------------- update */
console.log('\nSingle-block update');
{
  const v1 = resumeV1();
  const id = listBlocks(v1)[2].id; // Bullet B
  const v2 = setBlockText(v1, id, 'Bullet B edited.');

  check('target block is updated', findBlock(v2, id).text === 'Bullet B edited.');
  check('original object is not mutated', findBlock(v1, id).text === 'Bullet B original.');
  check('no other block changes',
    listBlocks(v2).filter(b => b.id !== id).every((b, i) => b.text === listBlocks(v1).filter(x => x.id !== id)[i].text));
  check('unknown id is a no-op', setBlockText(v1, 'nope#b9', 'x') === v1);
}

/* --------------------------------------------------------------- pinning */
console.log('\nPinning through regeneration');
{
  const v1 = resumeV1();
  const bulletB = listBlocks(v1)[2];
  const summary = listBlocks(v1)[0];
  const pins = [
    { ...bulletB, text: 'PINNED bullet B, hand written.' },
    { ...summary, text: 'PINNED summary, hand written.' },
  ];

  // A regeneration returns different wording everywhere.
  const regenerated = {
    name: 'X',
    sections: [
      { heading: 'PROFESSIONAL SUMMARY', paragraphs: ['Totally regenerated summary.'] },
      { heading: 'PROFESSIONAL EXPERIENCE', entries: [
        { title: 'Technical Project Manager', subtitle: 'TD Bank', bullets: ['Regenerated A.', 'Regenerated B.'] },
        { title: 'Program Analyst', subtitle: 'Acme', bullets: ['Regenerated C.'] },
      ] },
    ],
  };

  const { resume: merged, applied, missed } = applyPinnedBlocks(regenerated, pins);
  const texts = listBlocks(merged).map(b => b.text);
  check('pinned bullet survives byte-for-byte', texts.includes('PINNED bullet B, hand written.'), texts.join(' | '));
  check('pinned paragraph survives byte-for-byte', texts.includes('PINNED summary, hand written.'));
  check('unpinned blocks are regenerated', texts.includes('Regenerated A.') && texts.includes('Regenerated C.'));
  check('every pin is reported as applied', applied.length === 2 && missed.length === 0);
  check('regenerated input is not mutated', regenerated.sections[0].paragraphs[0] === 'Totally regenerated summary.');

  // Entry reordered: the pin must follow the role, not the index.
  const reordered = {
    name: 'X',
    sections: [
      { heading: 'PROFESSIONAL SUMMARY', paragraphs: ['New summary.'] },
      { heading: 'PROFESSIONAL EXPERIENCE', entries: [
        { title: 'Program Analyst', subtitle: 'Acme', bullets: ['Regen C.'] },
        { title: 'Technical Project Manager', subtitle: 'TD Bank', bullets: ['Regen A.', 'Regen B.'] },
      ] },
    ],
  };
  const r2 = applyPinnedBlocks(reordered, [{ ...bulletB, text: 'PINNED B.' }]);
  const tpmBullets = r2.resume.sections[1].entries.find(e => e.title === 'Technical Project Manager').bullets;
  check('pin follows the role when entries are reordered', tpmBullets.includes('PINNED B.'), JSON.stringify(tpmBullets));
  check('pin does not land on the wrong employer',
    !r2.resume.sections[1].entries.find(e => e.title === 'Program Analyst').bullets.includes('PINNED B.'));

  // Role removed entirely: report rather than silently drop.
  const shrunk = {
    name: 'X',
    sections: [{ heading: 'PROFESSIONAL SUMMARY', paragraphs: ['Only a summary now.'] }],
  };
  const r3 = applyPinnedBlocks(shrunk, [{ ...bulletB, text: 'PINNED B.' }]);
  check('a pin with nowhere to go is reported as missed', r3.missed.length === 1 && r3.applied.length === 0);

  check('no pins is a no-op', applyPinnedBlocks(regenerated, []).resume === regenerated);
}

/* ----------------------------------------------------------- placeholders */
console.log('\nPlaceholder detection');
{
  check('[ADD %] is detected', hasPlaceholder('Cut slippage by [ADD %] across six squads.'));
  check('[ADD TEAM SIZE] is detected', hasPlaceholder('Led [ADD TEAM SIZE] engineers.'));
  check('clean text is not flagged', !hasPlaceholder('Cut slippage 35% across six squads.'));
  check('square brackets alone are not flagged', !hasPlaceholder('Shipped v2 [beta] to 300 users.'));
}

/* ------------------------------------------------------------------ diff */
console.log('\nWord diff');
{
  const ops = diffWords('Directed integrated project plans.', 'Directed integrated project plans, cutting slippage 18%.');
  check('unchanged prefix is marked same', ops[0].type === 'same' && ops[0].value.startsWith('Directed'));
  check('added words are marked added', ops.some(o => o.type === 'added' && o.value.includes('18%')));
  const round = ops.filter(o => o.type !== 'added').map(o => o.value).join('');
  check('removals plus sames reconstruct the original', round === 'Directed integrated project plans.', round);
  const forward = ops.filter(o => o.type !== 'removed').map(o => o.value).join('');
  check('additions plus sames reconstruct the rewrite',
    forward === 'Directed integrated project plans, cutting slippage 18%.', forward);

  const replaced = diffWords('Managed the roadmap.', 'Owned the roadmap.');
  check('a replaced word shows as removed + added',
    replaced.some(o => o.type === 'removed' && o.value.includes('Managed'))
    && replaced.some(o => o.type === 'added' && o.value.includes('Owned')));
  check('identical text yields no changes', diffWords('Same text.', 'Same text.').every(o => o.type === 'same'));

  // A placeholder must read as one unit; word-matching inside it looks broken.
  const ph = diffWords('cutting slippage 18% over four quarters.', 'cutting slippage [ADD %] while holding scope.');
  check('a placeholder is never split across diff ops',
    ph.some(o => o.type === 'added' && o.value.includes('[ADD %]'))
    && !ph.some(o => o.type !== 'added' && /\[ADD|%\]/.test(o.value)),
    JSON.stringify(ph));
  check('placeholder diff still reconstructs the rewrite',
    ph.filter(o => o.type !== 'removed').map(o => o.value).join('') === 'cutting slippage [ADD %] while holding scope.');
}

/* ----------------------------------------------------- server guardrails */
console.log('\nRewrite agent guardrails');
{
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const i = src.indexOf("task === 'blockFix'");
  const block = src.slice(i, src.indexOf("task === 'thankYouEmail'", i));

  check('blockFix task exists', i > 0);
  check('never-invent rule is present', /Never invent an employer, job title, date range, degree, certification, or number/.test(block));
  check('placeholder instruction is present', /\[ADD %\] or \[ADD TEAM SIZE\]/.test(block));
  check('core claim must be preserved', /Preserve the block's core claim/.test(block));
  check('all three tailoring levels are defined',
    /conservative: minimal wording changes/.test(block) && /balanced: reasonable rewording/.test(block) && /aggressive: may restructure/.test(block));
  check('keyword honesty rule is present', /do not insert a keyword from the job description if it misrepresents/.test(block));
  check('returns the documented JSON shape', /"rewrittenText": string, "keywordsAdded": string\[\], "warnings": string\[\]/.test(block));
  check('a placeholder always produces a warning',
    /if \(\/\\\[ADD\[\^\\\]\]\*\\\]\/i\.test\(rewrittenText\) && !warnings\.length\)/.test(block)
    || /test\(rewrittenText\) && !warnings\.length/.test(block));
  check('only sibling bullets are sent, never the whole resume',
    /siblingBullets/.test(block) && !/resumeText/.test(block));
  check('sibling context is capped', /slice\(0, 8\)/.test(block));

  const client = readFileSync(new URL('../../src/lib/claude.js', import.meta.url), 'utf8');
  const fn = client.slice(client.indexOf('export async function fixBlock'));
  check('client never sends the full resume',
    !/resumeText/.test(fn.slice(0, fn.indexOf('}\n'))), fn.slice(0, 200));

  const view = readFileSync(new URL('../../src/components/AgentView.jsx', import.meta.url), 'utf8');
  check('AI ask uses the latest committed text, not the original',
    /const current = findBlock\(version\.content, meta\.id\)\?\.text \|\| meta\.text/.test(view));
  check('regeneration is blocked while a block is being edited', /isEditingBlock \|\| !canAdvance/.test(view));
  check('accepted edits append to a log', /const log = \[\.\.\.\(v\.editLog \|\| \[\]\), \{/.test(view));
  check('pins are re-applied on regeneration', /applyPinnedBlocks\(resume, carried\)/.test(view));

  const editor = readFileSync(new URL('../../src/components/BlockEditor.jsx', import.meta.url), 'utf8');
  check('accept is disabled while a placeholder remains', /disabled=\{placeholderPending\}/.test(editor));
  check('reject clears the suggestion without committing', /onClick=\{\(\) => setSuggestion\(null\)\}/.test(editor));
  check('warnings render in an alert region', /className="be-warn" role="alert"/.test(editor));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
