import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// pdf.js returns positioned text fragments, not lines — group them back into
// lines by their y coordinate so bullets and headings survive extraction.
export async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map();

    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const bucket = [...lines.keys()].find(k => Math.abs(k - y) <= 2);
      const key = bucket ?? y;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ x: item.transform[4], str: item.str });
    }

    const ordered = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, frags]) => frags.sort((a, b) => a.x - b.x).map(f => f.str).join('').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    pages.push(ordered.join('\n'));
  }

  // URLs live in link annotations, not the text layer, so a LinkedIn or GitHub
  // profile would otherwise be lost when the text shows only a display label.
  const seen = new Set();
  const urls = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const annots = await page.getAnnotations();
    for (const a of annots) {
      const url = a?.url || a?.unsafeUrl;
      if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }

  let text = pages.join('\n\n').trim();
  const missing = urls.filter(u => !text.includes(u.replace(/^https?:\/\//, '').replace(/\/$/, '')));
  if (missing.length) text += `\n\nLinks: ${missing.join(' | ')}`;
  return text;
}
