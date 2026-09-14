import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, TabStopType, ExternalHyperlink, Tab
} from 'docx';
import { splitContact } from './contactLinks.js';

const NAVY = '000000';
const MUTED = '000000';

// Letter width (12240 twips) minus our 0.5in (720 twips) margins on each side —
// TabStopPosition.MAX (9026) assumes 1in margins, so it stops short of our edge.
const PAGE_MARGIN_TWIPS = 720;
const CONTENT_WIDTH_TWIPS = 12240 - PAGE_MARGIN_TWIPS * 2;

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'resume';
}

function splitLabelLine(line) {
  const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
  return m ? { label: m[1] + ':', rest: m[2] } : null;
}

function paragraphForText(p) {
  const split = splitLabelLine(p);
  if (split) {
    return new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: split.label + ' ', bold: true }),
        new TextRun({ text: split.rest })
      ]
    });
  }
  return new Paragraph({ spacing: { after: 100 }, children: [new TextRun(p)] });
}

function paragraphsForEntry(entry) {
  const out = [];
  out.push(new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_TWIPS }],
    spacing: { before: 120, after: 20 },
    children: [
      new TextRun({ text: entry.title || '', bold: true, size: 21 }),
      ...(entry.dateRight ? [new TextRun({ text: `\t${entry.dateRight}`, italics: true, color: MUTED, size: 19 })] : [])
    ]
  }));
  if (entry.subtitle) {
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: entry.subtitle, italics: true, color: MUTED, size: 20 })]
    }));
  }
  (entry.bullets || []).forEach(b => {
    // left 648 / hanging 360 twips: glyph at 0.25in, text at 0.45in. The Tab
    // element is required — docx strips a raw \t from run text, which would
    // leave the glyph jammed against the first word.
    out.push(new Paragraph({
      indent: { left: 648, hanging: 360 },
      spacing: { after: 60 },
      children: [new TextRun({ children: ['\u2022', new Tab(), b] })]
    }));
  });
  if (entry.footer) {
    out.push(new Paragraph({
      spacing: { before: 40, after: 100 },
      children: [new TextRun({ text: entry.footer, italics: true, color: MUTED, size: 18 })]
    }));
  }
  return out;
}

export async function buildResumeDocx(resume, title = 'Resume', opts = {}) {
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: resume.name || '', bold: true, size: 38, color: NAVY })]
  }));

  if (resume.contact) {
    const parts = splitContact(resume.contact);
    const runs = [];
    parts.forEach((p, i) => {
      if (i) runs.push(new TextRun({ text: '   \u2022   ', color: MUTED, size: 19 }));
      if (p.href) {
        // Colour and underline are set explicitly rather than relying on the
        // built-in 'Hyperlink' style, which Word only applies if it's defined.
        runs.push(new ExternalHyperlink({
          link: p.href,
          children: [new TextRun({ text: p.text, size: 19, color: '1155CC', underline: {} })],
        }));
      } else {
        runs.push(new TextRun({ text: p.text, color: MUTED, size: 19 }));
      }
    });
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: runs }));
  }

  (resume.sections || []).forEach(section => {
    children.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      border: { bottom: { color: NAVY, space: 2, style: BorderStyle.SINGLE, size: 6 } },
      children: [new TextRun({ text: section.heading || '', bold: true, color: NAVY, size: 23 })]
    }));
    (section.paragraphs || []).forEach(p => children.push(paragraphForText(p)));
    (section.entries || []).forEach(entry => children.push(...paragraphsForEntry(entry)));
  });

  // Always set explicitly: the docx library defaults to A4 when size is
  // omitted, so leaving it out silently ignores a US Letter preference.
  const size = opts.pageSize === 'a4'
    ? { width: 11906, height: 16838 }
    : { width: 12240, height: 15840 };
  const page = {
    margin: { top: PAGE_MARGIN_TWIPS, right: PAGE_MARGIN_TWIPS, bottom: PAGE_MARGIN_TWIPS, left: PAGE_MARGIN_TWIPS },
    size
  };
  const doc = new Document({ sections: [{ properties: { page }, children }] });
  const blob = await Packer.toBlob(doc);
  const base64 = await blobToBase64(blob);
  return {
    blob, base64,
    filename: `${sanitizeFilename(title)}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
