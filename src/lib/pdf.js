import { jsPDF } from 'jspdf';
import { splitContact } from './contactLinks.js';

const NAVY = [0, 0, 0];          // headings / name — solid black per user preference, no color accents
const TEXT = [0, 0, 0];          // body text
const MUTED = [0, 0, 0];         // contact line, subtitles, dates
const LINK = [17, 85, 204];      // only clickable parts get colour, so a link reads as one

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'resume';
}

// "Label: rest of line" → bold label + normal rest, common in
// Core Competencies / Skills style sections.
function splitLabelLine(line) {
  const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
  return m ? { label: m[1] + ':', rest: m[2] } : null;
}

export function buildResumePdf(resume, title = 'Resume', opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: opts.pageSize === 'a4' ? 'a4' : 'letter' });
  const marginX = 36; // 0.5in on all sides
  const marginY = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let y = marginY + 18; // leaves room for the name's ascender above the margin line

  function ensureSpace(needed) {
    if (y + needed > pageHeight - marginY) { doc.addPage(); y = marginY + 18; }
  }

  // Name
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...NAVY);
  doc.text(resume.name || '', pageWidth / 2, y, { align: 'center' });
  y += 22;

  // Contact line — each part is drawn individually so recognised emails,
  // phone numbers and profile URLs can carry a real clickable link annotation.
  if (resume.contact) {
    const parts = splitContact(resume.contact);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    const sep = '   •   ';
    const sepW = doc.getTextWidth(sep);
    const totalW = parts.reduce((w, p, i) => w + doc.getTextWidth(p.text) + (i ? sepW : 0), 0);
    let x = (pageWidth - totalW) / 2;
    parts.forEach((p, i) => {
      if (i) { doc.setTextColor(...MUTED); doc.text(sep, x, y); x += sepW; }
      const w = doc.getTextWidth(p.text);
      if (p.href) {
        doc.setTextColor(...LINK);
        doc.text(p.text, x, y);
        doc.setDrawColor(...LINK); doc.setLineWidth(0.6);
        doc.line(x, y + 1.5, x + w, y + 1.5);
        doc.link(x, y - 8, w, 11, { url: p.href });
      } else {
        doc.setTextColor(...MUTED);
        doc.text(p.text, x, y);
      }
      x += w;
    });
    doc.setTextColor(...TEXT);
    y += 20;
  } else {
    y += 6;
  }

  (resume.sections || []).forEach(section => {
    ensureSpace(30);
    // Heading + rule
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...NAVY);
    doc.text(section.heading || '', marginX, y);
    y += 5;
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.75);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 14;

    // Paragraphs
    (section.paragraphs || []).forEach(p => {
      const split = splitLabelLine(p);
      doc.setFontSize(10);
      if (split) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...TEXT);
        const labelWidth = doc.getTextWidth(split.label + ' ');
        const wrapped = doc.splitTextToSize(split.rest, contentWidth - labelWidth);
        ensureSpace(wrapped.length * 13 + 4);
        doc.text(split.label, marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.text(wrapped[0] || '', marginX + labelWidth, y);
        y += 13;
        for (let i = 1; i < wrapped.length; i++) { doc.text(wrapped[i], marginX, y); y += 13; }
      } else {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...TEXT);
        const wrapped = doc.splitTextToSize(p, contentWidth);
        ensureSpace(wrapped.length * 13 + 4);
        wrapped.forEach(line => { doc.text(line, marginX, y); y += 13; });
      }
      y += 4;
    });

    // Entries
    (section.entries || []).forEach(entry => {
      ensureSpace(30);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...TEXT);
      doc.text(entry.title || '', marginX, y);
      if (entry.dateRight) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
        doc.text(entry.dateRight, pageWidth - marginX, y, { align: 'right' });
      }
      y += 13;
      if (entry.subtitle) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(...MUTED);
        doc.text(entry.subtitle, marginX, y);
        y += 13;
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...TEXT);
      // Bullets sit inset from the role heading, with wrapped lines aligned
      // under the first line rather than back at the margin.
      const bulletX = marginX + 12;
      const bulletTextX = marginX + 24;
      (entry.bullets || []).forEach(b => {
        const wrapped = doc.splitTextToSize(b, contentWidth - 24);
        ensureSpace(wrapped.length * 13 + 2);
        doc.text('\u2022', bulletX, y);
        wrapped.forEach(line => { doc.text(line, bulletTextX, y); y += 13; });
      });
      if (entry.footer) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED);
        const wrapped = doc.splitTextToSize(entry.footer, contentWidth);
        ensureSpace(wrapped.length * 12 + 2);
        wrapped.forEach(line => { doc.text(line, marginX, y); y += 12; });
      }
      y += 8;
    });

    y += 6;
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
