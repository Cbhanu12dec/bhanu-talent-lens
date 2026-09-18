// Layout conformance tests for the exported resume documents.
// Run with: node functions/test/layout.test.mjs
//
// Renders real PDF and DOCX files and measures them, rather than asserting on
// the source — a token can be correct and still not reach the page.
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildResumePdf } from '../../src/lib/pdf.js';
import { buildResumeDocx } from '../../src/lib/docx.js';
import { LAYOUT, inToPt, inToTwips, ptToHalfPt, formatDateRange, formatHeading } from '../../src/lib/resumeLayout.js';

globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer()
      .then(buf => { this.result = 'data:x;base64,' + Buffer.from(buf).toString('base64'); this.onload(); })
      .catch(e => this.onerror(e));
  }
};

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

const RESUME = {
  name: 'Hindhu Kommuru',
  contact: 'Dallas, TX | (555) 555-5555 | name@email.com | linkedin.com/in/hindhu',
  sections: [
    { heading: 'Professional Summary', paragraphs: ['Technical program manager with 9 years delivering payments platform modernisation across banking and fintech.'] },
    { heading: 'Technical Skills', paragraphs: ['Delivery: Agile, Scrum, SDLC, RAID Management', 'Tools: Jira, Confluence, Azure DevOps'] },
    {
      heading: 'Professional Experience',
      entries: [
        {
          title: 'Technical Project Manager',
          subtitle: 'TD Bank | New York, NY',
          dateRight: 'Jan 2023 - Present',
          bullets: [
            'Cut release slippage 35% by replacing ad-hoc intake with a scored prioritisation rhythm across six squads, after three consecutive quarters of missed commitments.',
            'Short bullet with a number, 12 releases.',
          ],
          footer: 'Tools: Jira, Confluence',
        },
        { title: 'Program Analyst', subtitle: 'Acme | Dallas, TX', dateRight: '06/2020 - 12/2022', bullets: ['Recovered a three-week schedule risk by resequencing two dependent workstreams.'] },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ dates */
console.log('\nDate standardisation');
{
  const cases = [
    ['Jan 2023 - Present', 'January 2023 – Present'],
    ['01/2023 - 12/2024', 'January 2023 – December 2024'],
    ['2023-01 – Current', 'January 2023 – Present'],
    ['June 2020 to December 2022', 'June 2020 – December 2022'],
    ["Jan '23 - now", 'January 2023 – Present'],
    ['2019 - 2021', '2019 – 2021'],
  ];
  for (const [input, want] of cases) {
    const got = formatDateRange(input);
    check(`"${input}" → "${want}"`, got === want, got);
  }
  check('unknown month is never invented', formatDateRange('2021') === '2021');
  check('en dash is used for ranges', formatDateRange('Jan 2020 - Feb 2021').includes('\u2013'));
  check('headings are uppercased', formatHeading('Professional Summary') === 'PROFESSIONAL SUMMARY');
}

/* -------------------------------------------------------------------- PDF */
console.log('\nPDF layout');
{
  const { blob } = buildResumePdf(RESUME, 'Test');
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items = content.items.filter(i => i.str.trim()).map(i => ({
    str: i.str,
    x: Math.round(i.transform[4] * 100) / 100,
    y: Math.round(i.transform[5] * 100) / 100,
    width: Math.round((i.width || 0) * 100) / 100,
    size: Math.round(Math.hypot(i.transform[0], i.transform[1]) * 10) / 10,
    font: i.fontName,
  }));

  check('page is US Letter', near(vp.width, 612, 1) && near(vp.height, 792, 1), `${vp.width}x${vp.height}`);

  const marginL = inToPt(LAYOUT.margin.left);
  const find = p => items.find(i => i.str.includes(p));

  const heading = find('PROFESSIONAL EXPERIENCE');
  check('section headings are uppercase in output', !!heading);
  check('headings start at the left margin', heading && near(heading.x, marginL), heading?.x);
  check('heading size is 11.5pt', heading && near(heading.size, LAYOUT.size.heading, 0.3), heading?.size);

  const name = find('Hindhu Kommuru');
  check('name is 18pt', name && near(name.size, LAYOUT.size.name, 0.3), name?.size);
  check('name is centred', name && near(name.x + (name.str.length * name.size * 0.27), 306, 40), name?.x);

  const jobTitle = find('Technical Project Manager');
  check('job title is 10.5pt', jobTitle && near(jobTitle.size, LAYOUT.size.jobTitle, 0.3), jobTitle?.size);

  const company = find('TD Bank');
  check('company sits at the left margin', company && near(company.x, marginL), company?.x);
  check('company is 10pt', company && near(company.size, LAYOUT.size.company, 0.3), company?.size);

  // Dates: normalised, right aligned, terminating on one boundary.
  const dates = items.filter(i => /January 2023 – Present|June 2020 – December 2022/.test(i.str));
  check('both dates are normalised to Month YYYY – Month YYYY', dates.length === 2, JSON.stringify(dates.map(d => d.str)));
  const rightEdge = 612 - inToPt(LAYOUT.margin.right);
  const ends = dates.map(d => d.x + d.width);
  check('dates end on the same right boundary',
    dates.length === 2 && near(dates[0].x + (dates[0].str.length * 4.7), dates[1].x + (dates[1].str.length * 4.7), 14),
    JSON.stringify(dates.map(d => d.x)));
  check('dates sit inside the right margin', dates.every(d => d.x < rightEdge), JSON.stringify(dates.map(d => d.x)));

  // Hanging indent.
  const glyphs = items.filter(i => i.str === LAYOUT.bullet.char && i.x < 200);
  const wantGlyph = marginL + inToPt(LAYOUT.bullet.glyphIndent);
  const wantText = marginL + inToPt(LAYOUT.bullet.textIndent);
  check('bullet glyph is at the specified indent', glyphs.length >= 2 && glyphs.every(g => near(g.x, wantGlyph)), JSON.stringify(glyphs.map(g => g.x)));
  const firstLine = find('Cut release slippage');
  const wrapped = items.find(i => i.str.includes('consecutive quarters'));
  check('bullet text is at the specified indent', firstLine && near(firstLine.x, wantText), firstLine?.x);
  check('wrapped lines align under the bullet text', wrapped && firstLine && near(wrapped.x, firstLine.x), `${wrapped?.x} vs ${firstLine?.x}`);
  check('body text is 10pt', firstLine && near(firstLine.size, LAYOUT.size.body, 0.3), firstLine?.size);

  // Nothing may cross the margins.
  const maxRight = Math.max(...items.map(i => i.x + (i.width || 0)));
  check('no text crosses the right margin', maxRight <= rightEdge + 1, `${Math.round(maxRight)} > ${rightEdge}`);
  check('no text crosses the left margin', Math.min(...items.map(i => i.x)) >= marginL - 1);
  const topY = Math.max(...items.map(i => i.y));
  check('content starts below the top margin', topY <= 792 - inToPt(LAYOUT.margin.top), topY);

  // Single column is really a claim about reading order: a two-column page
  // makes extraction jump back up to the top for the second column. Counting
  // distinct x positions is not a proxy for that — right-aligned dates put a
  // legitimate second x on the same line as the job title.
  let backJumps = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].y > items[i - 1].y + 2) backJumps++;
  }
  check('reading order never jumps back up the page (single column)', backJumps === 0, `${backJumps} jumps`);
  const sameLineAsTitle = items.filter(i => jobTitle && near(i.y, jobTitle.y, 1));
  check('only the date shares a baseline with the job title',
    sameLineAsTitle.length <= 2, sameLineAsTitle.map(i => i.str).join(' | '));

  // Extraction order must read top to bottom.
  const order = items.map(i => i.str).join(' ');
  check('extraction order is name → contact → summary → skills → experience',
    order.indexOf('Hindhu Kommuru') < order.indexOf('Dallas, TX')
    && order.indexOf('Dallas, TX') < order.indexOf('PROFESSIONAL SUMMARY')
    && order.indexOf('PROFESSIONAL SUMMARY') < order.indexOf('TECHNICAL SKILLS')
    && order.indexOf('TECHNICAL SKILLS') < order.indexOf('PROFESSIONAL EXPERIENCE'));
  check('no italic fonts are used', !items.some(i => /oblique|italic/i.test(i.font)), items.map(i => i.font).join(','));

  const a4 = buildResumePdf(RESUME, 'Test', { pageSize: 'a4' });
  const a4doc = await pdfjs.getDocument({ data: new Uint8Array(await a4.blob.arrayBuffer()) }).promise;
  const a4vp = (await a4doc.getPage(1)).getViewport({ scale: 1 });
  check('A4 honoured when requested', near(a4vp.width, 595, 2) && near(a4vp.height, 842, 2), `${a4vp.width}x${a4vp.height}`);

  // Contact details must stay clickable even though they render black.
  const annots = (await page.getAnnotations()).filter(a => a.subtype === 'Link');
  const urls = annots.map(a => a.url || a.unsafeUrl).filter(Boolean);
  check('PDF carries clickable link annotations', annots.length >= 3, `${annots.length} links`);
  check('email is a mailto link', urls.some(u => u.startsWith('mailto:')), urls.join(' '));
  check('phone is a tel link', urls.some(u => u.startsWith('tel:')), urls.join(' '));
  check('profile URL is an https link', urls.some(u => u.startsWith('https://')), urls.join(' '));
  // pdf.js merges the contact parts into one text item, so the link can only
  // be checked against the line's span and baseline, not a per-part x.
  const contactLine = find('Dallas, TX');
  const emailLink = annots.find(a => (a.url || a.unsafeUrl || '').startsWith('mailto:'));
  check('link sits horizontally within the contact line',
    contactLine && emailLink
    && emailLink.rect[0] >= contactLine.x - 1
    && emailLink.rect[2] <= contactLine.x + contactLine.width + 1,
    `${emailLink?.rect?.[0]}–${emailLink?.rect?.[2]} vs ${contactLine?.x}–${Math.round((contactLine?.x || 0) + (contactLine?.width || 0))}`);
  check('link sits on the contact baseline',
    contactLine && emailLink && Math.abs(emailLink.rect[1] - contactLine.y) < 4,
    `${emailLink?.rect?.[1]} vs ${contactLine?.y}`);
  check('every link rectangle is inside the page margins',
    annots.every(a => a.rect[0] >= marginL - 1 && a.rect[2] <= rightEdge + 1),
    annots.map(a => `${Math.round(a.rect[0])}-${Math.round(a.rect[2])}`).join(' '));

  /* ------------------------------------------------- drawn rules and underlines */
  // Read the stroked paths out of the page, not the source: a rule can be
  // specified correctly and still never reach the paper.
  const opList = await page.getOperatorList();
  const segments = [];
  for (let n = 0; n < opList.fnArray.length; n++) {
    if (opList.fnArray[n] !== pdfjs.OPS.constructPath) continue;
    const [ops, coords] = opList.argsArray[n];
    let c = 0, cur = null;
    for (const op of ops) {
      if (op === pdfjs.OPS.moveTo) { cur = { x1: coords[c], y1: coords[c + 1] }; c += 2; }
      else if (op === pdfjs.OPS.lineTo) {
        if (cur) segments.push({ ...cur, x2: coords[c], y2: coords[c + 1] });
        c += 2;
      } else { c += op === pdfjs.OPS.curveTo ? 6 : 4; }
    }
  }
  const horizontal = segments.filter(s => Math.abs(s.y1 - s.y2) < 0.6);
  // PDF y grows upward; text item y is already in that space.
  const sectionRules = horizontal.filter(s =>
    Math.abs(Math.min(s.x1, s.x2) - marginL) < 1 && Math.abs(Math.max(s.x1, s.x2) - rightEdge) < 1);

  check('a divider is drawn under every section heading',
    sectionRules.length === RESUME.sections.length,
    `${sectionRules.length} rules for ${RESUME.sections.length} sections`);
  check('dividers span the full content width',
    sectionRules.every(s => Math.abs(Math.abs(s.x2 - s.x1) - (rightEdge - marginL)) < 1),
    sectionRules.map(s => Math.round(Math.abs(s.x2 - s.x1))).join(' '));
  for (const h of ['PROFESSIONAL SUMMARY', 'TECHNICAL SKILLS', 'PROFESSIONAL EXPERIENCE']) {
    const item = find(h);
    const gap = LAYOUT.rule.gapAbovePt;
    check(`"${h}" has its rule ${gap}pt below the baseline`,
      item && sectionRules.some(s => Math.abs((item.y - s.y1) - gap) < 1.2),
      item ? `baseline ${item.y}, rules ${sectionRules.map(s => Math.round(s.y1)).join(',')}` : 'heading missing');
  }
  check('a short heading still gets a full-width rule',
    sectionRules.every(s => Math.abs(s.x2 - s.x1) > 400));

  // Underlines are shorter strokes sitting just under the contact baseline.
  const underlines = horizontal.filter(s =>
    contactLine && s.y1 < contactLine.y && contactLine.y - s.y1 < 4);
  check('every contact link is underlined', underlines.length >= annots.length,
    `${underlines.length} underlines for ${annots.length} links`);
  check('underlines stay within the contact line',
    underlines.every(s => Math.min(s.x1, s.x2) >= contactLine.x - 1
      && Math.max(s.x1, s.x2) <= contactLine.x + contactLine.width + 1),
    underlines.map(s => `${Math.round(s.x1)}-${Math.round(s.x2)}`).join(' '));
  check('nothing is underlined outside the contact line',
    !horizontal.some(s => s.y1 < contactLine.y - 10 && Math.abs(s.x2 - s.x1) < 200
      && !sectionRules.includes(s)),
    horizontal.filter(s => s.y1 < contactLine.y - 10 && Math.abs(s.x2 - s.x1) < 200).length + ' stray strokes');
}

/* ------------------------------------------------------------------- DOCX */
console.log('\nDOCX layout');
{
  const { blob } = await buildResumeDocx(RESUME, 'Test');
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const xml = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');

  check('document default font is Arial', /w:ascii="Arial"/.test(styles), styles.slice(0, 200));
  check('document default size is 10pt', new RegExp(`<w:sz w:val="${ptToHalfPt(LAYOUT.size.body)}"`).test(styles));
  check('page size is US Letter', /w:w="12240"[^/]*w:h="15840"/.test(xml));

  const m = xml.match(/<w:pgMar[^/]*\/>/)?.[0] || '';
  check('top margin matches the layout system', m.includes(`w:top="${inToTwips(LAYOUT.margin.top)}"`), m);
  check('bottom margin matches the layout system', m.includes(`w:bottom="${inToTwips(LAYOUT.margin.bottom)}"`), m);
  check('left margin matches the layout system', m.includes(`w:left="${inToTwips(LAYOUT.margin.left)}"`), m);
  check('right margin matches the layout system', m.includes(`w:right="${inToTwips(LAYOUT.margin.right)}"`), m);

  check('name is 18pt', new RegExp(`<w:sz w:val="${ptToHalfPt(LAYOUT.size.name)}"`).test(xml));
  // The heading size now lives in the shared style, not on each paragraph.
  check('heading is 11.5pt', new RegExp(`<w:sz w:val="${ptToHalfPt(LAYOUT.size.heading)}"`).test(styles));
  check('job title is 10.5pt', new RegExp(`<w:sz w:val="${ptToHalfPt(LAYOUT.size.jobTitle)}"`).test(xml));

  const wantLeft = inToTwips(LAYOUT.bullet.textIndent);
  const wantHang = inToTwips(LAYOUT.bullet.textIndent - LAYOUT.bullet.glyphIndent);
  check('bullet hanging indent matches the PDF',
    new RegExp(`w:left="${wantLeft}" w:hanging="${wantHang}"`).test(xml), (xml.match(/<w:ind[^/]*\/>/) || [''])[0]);
  check('bullet glyph is followed by a real tab', /•<\/w:t><\/w:r>|<w:tab\/>/.test(xml) && xml.includes('<w:tab/>'));
  check('dates are normalised', xml.includes('January 2023 – Present') && xml.includes('June 2020 – December 2022'));
  check('headings are uppercase', xml.includes('PROFESSIONAL EXPERIENCE'));
  check('right tab stop positions the date', /<w:tab w:val="right" w:pos="\d+"\/>/.test(xml), (xml.match(/<w:tabs>[\s\S]{0,120}/) || [''])[0]);
  check('no italics anywhere', !/<w:i\/>/.test(xml));
  check('links render black, not blue', !/1155CC/i.test(xml));

  // Rule 3: the divider and the underline must come from shared styles, so
  // they survive a section being renamed, reordered or added in Word.
  const headingStyle = styles.match(/<w:style [^>]*w:styleId="SectionHeading"[\s\S]*?<\/w:style>/)?.[0] || '';
  check('a shared section heading style exists', headingStyle.length > 0, styles.slice(0, 300));
  check('the heading style carries a bottom border', /<w:pBdr>[\s\S]*?<w:bottom /.test(headingStyle), headingStyle);
  check('the border is a real single rule', /<w:bottom w:val="single"/.test(headingStyle), headingStyle);
  check('the border width matches the layout system',
    new RegExp(`<w:bottom [^/]*w:sz="${Math.round(LAYOUT.rule.widthPt * 8)}"`).test(headingStyle), headingStyle);
  check('no heading draws its border inline instead', !/<w:pBdr>/.test(xml), 'inline pBdr found in document body');

  const headings = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m => m[0])
    .filter(p => /PROFESSIONAL SUMMARY|TECHNICAL SKILLS|PROFESSIONAL EXPERIENCE/.test(p));
  check('every section heading uses the shared style', headings.length === 3
    && headings.every(p => /w:pStyle w:val="SectionHeading"/.test(p)),
    `${headings.length} headings`);

  const linkStyle = styles.match(/<w:style [^>]*w:styleId="Hyperlink"[\s\S]*?<\/w:style>/)?.[0] || '';
  check('a Hyperlink character style exists', linkStyle.length > 0, styles.slice(0, 300));
  check('the Hyperlink style is underlined', /<w:u w:val="single"/.test(linkStyle), linkStyle);
  check('every hyperlink run uses that style',
    [...xml.matchAll(/<w:hyperlink [\s\S]*?<\/w:hyperlink>/g)]
      .every(m => /w:rStyle w:val="Hyperlink"/.test(m[0])),
    'a hyperlink run is missing the Hyperlink style');
  check('job headers keep with their bullets', /<w:keepNext\/>/.test(xml));

  const a4 = await buildResumeDocx(RESUME, 'Test', { pageSize: 'a4' });
  const a4xml = await (await JSZip.loadAsync(Buffer.from(await a4.blob.arrayBuffer()))).file('word/document.xml').async('string');
  check('A4 honoured when requested', /w:w="11906"/.test(a4xml));

  // Word hyperlinks live in the relationship file, not the document body.
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const targets = [...rels.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"/g)].map(m => m[1]);
  check('DOCX carries external hyperlinks', targets.length >= 3, targets.join(' '));
  check('email is a mailto link', targets.some(t => t.startsWith('mailto:')), targets.join(' '));
  check('phone is a tel link', targets.some(t => t.startsWith('tel:')), targets.join(' '));
  check('profile URL is an https link', targets.some(t => t.startsWith('https://')), targets.join(' '));
  check('hyperlink runs are referenced in the body', /<w:hyperlink /.test(xml));
}

/* ---------------------------------------------- on-screen preview parity */
{
  console.log('\nPreview margins');
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  // Anchor to the document-preview block; an older app-chrome rule earlier in
  // the file also matches .doc and would give a false reading.
  const docCss = css.slice(css.indexOf('RESUME DOCUMENT PREVIEW'));
  const rule = docCss.slice(docCss.indexOf('.doc,.doc-wrap > div{'));
  const y = rule.match(/--doc-margin-y:\s*([\d.]+)in/)?.[1];
  const x = rule.match(/--doc-margin-x:\s*([\d.]+)in/)?.[1];

  check('preview declares its page margins', Boolean(y && x), `y=${y} x=${x}`);
  check('preview vertical margin matches the export',
    Number(y) === LAYOUT.margin.top && LAYOUT.margin.top === LAYOUT.margin.bottom, `${y} vs ${LAYOUT.margin.top}`);
  check('preview horizontal margin matches the export',
    Number(x) === LAYOUT.margin.left && LAYOUT.margin.left === LAYOUT.margin.right, `${x} vs ${LAYOUT.margin.left}`);
  check('preview padding is driven by those variables',
    /padding:var\(--doc-margin-y\) var\(--doc-margin-x\)/.test(rule.replace(/\s+/g, '')) ||
    /padding:\s*var\(--doc-margin-y\)\s+var\(--doc-margin-x\)/.test(rule));
  check('margins stay above the ATS clipping floor',
    Math.min(...Object.values(LAYOUT.margin)) >= 0.5, JSON.stringify(LAYOUT.margin));

  const sect = docCss.slice(docCss.indexOf('.doc .sect{'), docCss.indexOf('}', docCss.indexOf('.doc .sect{')));
  check('preview draws a divider under section headings', /border-bottom:\s*1px solid/.test(sect), sect);
  check('divider colour matches the export', /#999/.test(sect), sect);
  const padBottom = Number(sect.match(/padding:\s*0 0 ([\d.]+)px/)?.[1]);
  check('the gap between heading and rule is 2-4px', padBottom >= 2 && padBottom <= 4, sect);
  check('the divider comes from one shared heading rule',
    (docCss.match(/\.doc .sect\{/g) || []).length === 1
    && !/\.sect[^{]*\{[^}]*border-bottom:\s*none/.test(docCss),
    'a later rule overrides the shared heading border');

  const preview = readFileSync(new URL('../../src/components/ResumePreview.jsx', import.meta.url), 'utf8');
  check('every section heading renders through that one class',
    (preview.match(/className="sect"/g) || []).length === 1, preview.match(/className="sect"/g)?.length);

  const link = docCss.slice(docCss.indexOf('.doc .contact-line a{'), docCss.indexOf('}', docCss.indexOf('.doc .contact-line a{')));
  check('preview links are underlined at rest', /text-decoration:\s*underline/.test(link), link);
  check('preview links are not colour-only', /color:#000/.test(link), link);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
