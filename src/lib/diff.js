// Classic LCS-based line diff — same approach git/diff tools use at their
// core, just without the extra move/rename detection. Good enough for
// resume-sized documents (tens to low hundreds of lines).
export function diffLines(oldLines, newLines) {
  const n = oldLines.length, m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', left: oldLines[i], right: newLines[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', left: oldLines[i], right: null });
      i++;
    } else {
      ops.push({ type: 'added', left: null, right: newLines[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'removed', left: oldLines[i], right: null }); i++; }
  while (j < m) { ops.push({ type: 'added', left: null, right: newLines[j] }); j++; }
  return ops;
}

// Flattens a structured resume into one comparable line per bullet/
// paragraph/heading, so the diff operates at "bullet" granularity rather
// than one giant text blob.
export function resumeToLines(resume) {
  if (!resume) return [];
  const lines = [resume.name || '', resume.contact || ''];
  (resume.sections || []).forEach(section => {
    lines.push(`## ${section.heading}`);
    (section.paragraphs || []).forEach(p => lines.push(p));
    (section.entries || []).forEach(entry => {
      lines.push([entry.title, entry.subtitle, entry.dateRight].filter(Boolean).join(' — '));
      (entry.bullets || []).forEach(b => lines.push(b));
      if (entry.footer) lines.push(entry.footer);
    });
  });
  return lines.filter(l => l !== '');
}
