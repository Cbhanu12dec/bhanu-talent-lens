import { jsPDF } from 'jspdf';
import { splitContact } from './contactLinks.js';
import { LAYOUT, inToPt, leading, formatDateRange, formatHeading } from './resumeLayout.js';

const BLACK = [0, 0, 0];
const RULE_RGB = [
  parseInt(LAYOUT.color.rule.slice(1, 3), 16),
  parseInt(LAYOUT.color.rule.slice(3, 5), 16),
  parseInt(LAYOUT.color.rule.slice(5, 7), 16),
];
const F = LAYOUT.font.pdf;
const S = LAYOUT.size;
const SP = LAYOUT.space;

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'resume';
}

// "Label: rest of line" → bold label + normal rest, common in
// Core Competencies / Skills style sections.
function splitLabelLine(line) {
  const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
  return m ? { label: m[1] + ':', rest: m[2] } : null;
}

export function buildResumePdf(resume, title = 'Resume', opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: opts.pageSize === 'a4' ? 'a4' : 'letter' });

  const mTop = inToPt(LAYOUT.margin.top);
  const mBottom = inToPt(LAYOUT.margin.bottom);
  const marginX = inToPt(LAYOUT.margin.left);
  const marginR = inToPt(LAYOUT.margin.right);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const rightEdge = pageWidth - marginR;
  const contentWidth = rightEdge - marginX;

  const bodyLead = leading(S.body);
  // y tracks the TOP of the next line box, not a baseline. Advancing by a gap
  // alone is what let the contact line collide with the first heading: the
  // next line's ascent has to be accounted for too.
  let y = mTop;

  const ASCENT = 0.8;
  /** Reserves a line of `size`, returns the baseline to draw on. */
  function lineBox(size, gapBefore = 0) {
    y += gapBefore;
    const baseline = y + size * ASCENT;
    y += size * LAYOUT.lineHeight;
    return baseline;
  }

  function ensureSpace(needed) {
    if (y + needed > pageHeight - mBottom) { doc.addPage(); y = mTop; return true; }
    return false;
  }
  const set = (style, size) => { doc.setFont(F, style); doc.setFontSize(size); doc.setTextColor(...BLACK); };

  // Every section heading goes through here, so a renamed or newly added
  // section cannot end up without its divider.
  function sectionHeading(text, gapBefore) {
    set('bold', S.heading);
    const baseline = lineBox(S.heading, gapBefore);
    doc.text(formatHeading(text), marginX, baseline);
    const ruleY = baseline + LAYOUT.rule.gapAbovePt;
    doc.setDrawColor(...RULE_RGB);
    doc.setLineWidth(LAYOUT.rule.widthPt);
    doc.line(marginX, ruleY, rightEdge, ruleY);
    y = Math.max(y, ruleY);
  }

  /** Underline marks a link without relying on colour. */
  function underline(x, baseline, width, size) {
    const thickness = Math.max(size * 0.05, 0.4);
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(thickness);
    doc.line(x, baseline + size * 0.12, x + width, baseline + size * 0.12);
  }

  /* --------------------------------------------------------------- name */
  set('bold', S.name);
  doc.text(resume.name || '', pageWidth / 2, lineBox(S.name), { align: 'center' });

  /* ------------------------------------------------------------ contact */
  if (resume.contact) {
    const parts = splitContact(resume.contact);
    set('normal', S.contact);
    const baseline = lineBox(S.contact, SP.afterName);
    const sep = LAYOUT.separator;
    const sepW = doc.getTextWidth(sep);
    const totalW = parts.reduce((w, p, i) => w + doc.getTextWidth(p.text) + (i ? sepW : 0), 0);
    let x = (pageWidth - totalW) / 2;
    parts.forEach((p, i) => {
      if (i) { doc.text(sep, x, baseline); x += sepW; }
      const w = doc.getTextWidth(p.text);
      doc.text(p.text, x, baseline);
      // Black but underlined: colour must never be the only thing marking a
      // link, and the underline is what carries that meaning here.
      if (p.href) {
        underline(x, baseline, w, S.contact);
        doc.link(x, baseline - S.contact, w, S.contact + 3, { url: p.href });
      }
      x += w;
    });
    y += SP.afterContact;
  }

  /* ----------------------------------------------------------- sections */
  (resume.sections || []).forEach((section, sIdx) => {
    // Keep a heading with at least its first line of content.
    ensureSpace(S.heading * LAYOUT.lineHeight + SP.afterHeading + bodyLead * 2);

    sectionHeading(section.heading, sIdx > 0 ? SP.beforeHeading : 0);
    y += SP.afterHeading;

    /* paragraphs */
    (section.paragraphs || []).forEach(p => {
      const split = splitLabelLine(p);
      if (split) {
        set('bold', S.skills);
        const labelWidth = doc.getTextWidth(split.label + ' ');
        const wrapped = doc.splitTextToSize(split.rest, contentWidth - labelWidth);
        ensureSpace(wrapped.length * bodyLead);
        const first = lineBox(S.skills);
        doc.text(split.label, marginX, first);
        set('normal', S.skills);
        doc.text(wrapped[0] || '', marginX + labelWidth, first);
        for (let i = 1; i < wrapped.length; i++) doc.text(wrapped[i], marginX, lineBox(S.skills));
      } else {
        set('normal', S.body);
        const wrapped = doc.splitTextToSize(p, contentWidth);
        ensureSpace(wrapped.length * bodyLead);
        wrapped.forEach(line => doc.text(line, marginX, lineBox(S.body)));
      }
      y += SP.afterParagraph;
    });

    /* entries */
    (section.entries || []).forEach((entry, eIdx) => {
      // A job header stranded at the foot of a page with no bullets under it
      // is the most common break defect, so the header reserves two bullets.
      ensureSpace(S.jobTitle * LAYOUT.lineHeight + S.company * LAYOUT.lineHeight + bodyLead * 2);

      set('bold', S.jobTitle);
      const titleBaseline = lineBox(S.jobTitle, eIdx > 0 ? SP.afterJob : 0);
      doc.text(entry.title || '', marginX, titleBaseline);
      if (entry.dateRight) {
        set('normal', S.date);
        doc.text(formatDateRange(entry.dateRight), rightEdge, titleBaseline, { align: 'right' });
      }
      y += SP.afterTitleLine;

      if (entry.subtitle) {
        set('bold', S.company);
        doc.text(entry.subtitle, marginX, lineBox(S.company));
        y += SP.afterTitleLine;
      }

      const bulletX = marginX + inToPt(LAYOUT.bullet.glyphIndent);
      const textX = marginX + inToPt(LAYOUT.bullet.textIndent);
      const bulletWidth = rightEdge - textX;
      (entry.bullets || []).forEach(b => {
        set('normal', S.body);
        const wrapped = doc.splitTextToSize(b, bulletWidth);
        if (ensureSpace(wrapped.length * bodyLead)) set('normal', S.body);
        // Wrapped lines start at textX, giving a true hanging indent.
        wrapped.forEach((line, i) => {
          const baseline = lineBox(S.body);
          if (i === 0) doc.text(LAYOUT.bullet.char, bulletX, baseline);
          doc.text(line, textX, baseline);
        });
        y += SP.afterBullet;
      });

      if (entry.footer) {
        set('normal', S.footer);
        const wrapped = doc.splitTextToSize(entry.footer, contentWidth);
        ensureSpace(wrapped.length * leading(S.footer));
        wrapped.forEach(line => doc.text(line, marginX, lineBox(S.footer)));
      }
    });
  });

  const blob = doc.output('blob');
  const base64 = doc.output('datauristring').split(',')[1];
  return { blob, base64, filename: `${sanitizeFilename(title)}.pdf`, mimeType: 'application/pdf' };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
