// Block-level identity for a resume document.
//
// The resume JSON has no ids of its own, so ids are derived from position
// plus the surrounding headings. That matters for pinning: after a
// regeneration the document is a different object, and a pinned bullet has to
// be found again by what it belongs to, not by array index alone.

const slug = s => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const BLOCK_KIND = { PARAGRAPH: 'paragraph', BULLET: 'bullet' };

export function paragraphId(heading, index) {
  return `${slug(heading)}#p${index}`;
}
export function bulletId(heading, entryTitle, entryIndex, bulletIndex) {
  return `${slug(heading)}#e${entryIndex}-${slug(entryTitle)}#b${bulletIndex}`;
}

/** Flat, ordered list of every editable block in the document. */
export function listBlocks(resume) {
  const out = [];
  (resume?.sections || []).forEach((section, si) => {
    const heading = section.heading || '';
    (section.paragraphs || []).forEach((text, pi) => {
      out.push({
        id: paragraphId(heading, pi),
        kind: BLOCK_KIND.PARAGRAPH,
        section: heading,
        text,
        path: { si, pi },
      });
    });
    (section.entries || []).forEach((entry, ei) => {
      (entry.bullets || []).forEach((text, bi) => {
        out.push({
          id: bulletId(heading, entry.title, ei, bi),
          kind: BLOCK_KIND.BULLET,
          section: heading,
          entryTitle: entry.title || '',
          entrySubtitle: entry.subtitle || '',
          text,
          path: { si, ei, bi },
        });
      });
    });
  });
  return out;
}

export function findBlock(resume, id) {
  return listBlocks(resume).find(b => b.id === id) || null;
}

/** Immutable single-block update. Returns a new resume object. */
export function setBlockText(resume, id, text) {
  const block = findBlock(resume, id);
  if (!block) return resume;
  const next = {
    ...resume,
    sections: resume.sections.map((section, si) => {
      if (si !== block.path.si) return section;
      if (block.kind === BLOCK_KIND.PARAGRAPH) {
        return { ...section, paragraphs: section.paragraphs.map((p, pi) => (pi === block.path.pi ? text : p)) };
      }
      return {
        ...section,
        entries: section.entries.map((entry, ei) => (
          ei !== block.path.ei
            ? entry
            : { ...entry, bullets: entry.bullets.map((b, bi) => (bi === block.path.bi ? text : b)) }
        )),
      };
    }),
  };
  return next;
}

/**
 * Re-applies pinned text to a freshly generated resume.
 *
 * Matching is deliberately layered: exact id first, then the same slot under
 * an entry with the same title, then the same slot under the entry at the
 * same index. A regeneration can reorder or rename entries, and an index-only
 * match would silently drop a pinned bullet onto unrelated work.
 */
export function applyPinnedBlocks(resume, pinnedBlocks = []) {
  let out = resume;
  const applied = [];
  const missed = [];
  if (!pinnedBlocks.length) return { resume: out, applied, missed };

  for (const pin of pinnedBlocks) {
    const blocks = listBlocks(out);
    let target = blocks.find(b => b.id === pin.id);

    if (!target && pin.kind === BLOCK_KIND.BULLET) {
      const sameEntry = blocks.filter(b =>
        b.kind === BLOCK_KIND.BULLET &&
        slug(b.section) === slug(pin.section) &&
        slug(b.entryTitle) === slug(pin.entryTitle));
      target = sameEntry.find(b => b.path.bi === pin.path?.bi) || sameEntry[0];
    }
    if (!target && pin.kind === BLOCK_KIND.BULLET && pin.path) {
      target = blocks.find(b =>
        b.kind === BLOCK_KIND.BULLET &&
        slug(b.section) === slug(pin.section) &&
        b.path.ei === pin.path.ei && b.path.bi === pin.path.bi);
    }
    if (!target && pin.kind === BLOCK_KIND.PARAGRAPH) {
      target = blocks.find(b =>
        b.kind === BLOCK_KIND.PARAGRAPH &&
        slug(b.section) === slug(pin.section) &&
        b.path.pi === pin.path?.pi);
    }

    if (!target) { missed.push(pin); continue; }
    out = setBlockText(out, target.id, pin.text);
    applied.push({ ...pin, appliedTo: target.id });
  }
  return { resume: out, applied, missed };
}

/** Bracketed placeholders the rewrite agent inserts when a fact is missing. */
export const PLACEHOLDER_RE = /\[ADD[^\]]*\]/i;
export const hasPlaceholder = text => PLACEHOLDER_RE.test(String(text || ''));

/**
 * Splits into diffable tokens. A bracketed placeholder is one token so that
 * `[ADD %]` is never torn in half by a coincidental word match inside it.
 */
const TOKEN_RE = /\[ADD[^\]]*\]|[^\s[]+|\[|\s+/gi;
const tokenize = s => String(s || '').match(TOKEN_RE) || [];

/** Word-level diff for the accept/reject panel. */
export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  // Longest common subsequence over tokens — short enough at block scale that
  // the quadratic table is not worth optimising.
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  const push = (type, value) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.value += value;
    else ops.push({ type, value });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('removed', a[i]); i++; }
    else { push('added', b[j]); j++; }
  }
  while (i < n) { push('removed', a[i]); i++; }
  while (j < m) { push('added', b[j]); j++; }
  return ops.filter(o => o.value !== '');
}
