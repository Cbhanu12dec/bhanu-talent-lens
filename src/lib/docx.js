import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  TabStopType, ExternalHyperlink, Tab, BorderStyle, UnderlineType
} from 'docx';
import { splitContact } from './contactLinks.js';
import {
  LAYOUT, inToTwips, ptToHalfPt, ptToDxa, formatDateRange, formatHeading
} from './resumeLayout.js';

const BLACK = '000000';
const S = LAYOUT.size;
const SP = LAYOUT.space;
// Word expresses line spacing in 240ths of a line; 240 is single.
const LINE = Math.round(240 * LAYOUT.lineHeight);
const SPACING = { line: LINE, lineRule: 'auto' };

const MARGIN = {
  top: inToTwips(LAYOUT.margin.top),
  bottom: inToTwips(LAYOUT.margin.bottom),
  left: inToTwips(LAYOUT.margin.left),
  right: inToTwips(LAYOUT.margin.right),
};
const pageWidthTwips = pageSize => (pageSize === 'a4' ? 11906 : 12240);

// Word border widths are eighths of a point.
const RULE_EIGHTHS = Math.round(LAYOUT.rule.widthPt * 8);
const HEADING_STYLE = 'SectionHeading';
const LINK_STYLE = 'Hyperlink';

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_]+/gi, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'resume';
}

function splitLabelLine(line) {
  const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
  return m ? { label: m[1] + ':', rest: m[2] } : null;
}

function paragraphForText(p) {
  const split = splitLabelLine(p);
  if (split) {
    return new Paragraph({
      spacing: { ...SPACING, after: ptToDxa(SP.afterParagraph) },
      children: [
        new TextRun({ text: split.label + ' ', bold: true, size: ptToHalfPt(S.skills) }),
        new TextRun({ text: split.rest, size: ptToHalfPt(S.skills) })
      ]
    });
  }
  return new Paragraph({
    spacing: { ...SPACING, after: ptToDxa(SP.afterParagraph) },
    children: [new TextRun({ text: p, size: ptToHalfPt(S.body) })]
  });
}

function paragraphsForEntry(entry, contentWidthTwips) {
  const out = [];
  out.push(new Paragraph({
    // Right tab at the content edge is what puts dates on a stable right
    // boundary without a table or a run of manual spaces.
    tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwips }],
    spacing: { ...SPACING, before: ptToDxa(SP.afterJob), after: ptToDxa(SP.afterTitleLine) },
    keepNext: true,
    children: [
      new TextRun({ text: entry.title || '', bold: true, size: ptToHalfPt(S.jobTitle) }),
      ...(entry.dateRight
        ? [new TextRun({ text: `\t${formatDateRange(entry.dateRight)}`, size: ptToHalfPt(S.date) })]
        : [])
    ]
  }));
  if (entry.subtitle) {
    out.push(new Paragraph({
      spacing: { ...SPACING, after: ptToDxa(SP.afterTitleLine) },
      keepNext: true,
      children: [new TextRun({ text: entry.subtitle, bold: true, size: ptToHalfPt(S.company) })]
    }));
  }
  (entry.bullets || []).forEach(b => {
    // The Tab element is required — docx strips a raw \t from run text, which
    // would leave the glyph jammed against the first word.
    out.push(new Paragraph({
      indent: {
        left: inToTwips(LAYOUT.bullet.textIndent),
        hanging: inToTwips(LAYOUT.bullet.textIndent - LAYOUT.bullet.glyphIndent),
      },
      spacing: { ...SPACING, after: ptToDxa(SP.afterBullet) },
      children: [new TextRun({ children: [LAYOUT.bullet.char, new Tab(), b], size: ptToHalfPt(S.body) })]
    }));
  });
  if (entry.footer) {
    out.push(new Paragraph({
      spacing: { ...SPACING, after: ptToDxa(SP.afterParagraph) },
      children: [new TextRun({ text: entry.footer, size: ptToHalfPt(S.footer) })]
    }));
  }
  return out;
}

export async function buildResumeDocx(resume, title = 'Resume', opts = {}) {
  const children = [];
  const contentWidthTwips = pageWidthTwips(opts.pageSize) - MARGIN.left - MARGIN.right;

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { ...SPACING, after: ptToDxa(SP.afterName) },
    children: [new TextRun({ text: resume.name || '', bold: true, size: ptToHalfPt(S.name) })]
  }));

  if (resume.contact) {
    const parts = splitContact(resume.contact);
    const runs = [];
    parts.forEach((p, i) => {
      if (i) runs.push(new TextRun({ text: LAYOUT.separator, size: ptToHalfPt(S.contact) }));
      if (p.href) {
        // Black but underlined via the built-in Hyperlink character style, so
        // the link survives edits and colour is not carrying the meaning.
        runs.push(new ExternalHyperlink({
          link: p.href,
          children: [new TextRun({ text: p.text, size: ptToHalfPt(S.contact), style: LINK_STYLE })],
        }));
      } else {
        runs.push(new TextRun({ text: p.text, size: ptToHalfPt(S.contact) }));
      }
    });
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { ...SPACING, after: ptToDxa(SP.afterContact) },
      children: runs,
    }));
  }

  (resume.sections || []).forEach(section => {
    // The divider and spacing live in the style, not here, so every section
    // keeps them through later edits in Word.
    children.push(new Paragraph({
      style: HEADING_STYLE,
      children: [new TextRun({ text: formatHeading(section.heading) })]
    }));
    (section.paragraphs || []).forEach(p => children.push(paragraphForText(p)));
    (section.entries || []).forEach(entry => children.push(...paragraphsForEntry(entry, contentWidthTwips)));
  });

  // Always set explicitly: the docx library defaults to A4 when size is
  // omitted, so leaving it out silently ignores a US Letter preference.
  const size = opts.pageSize === 'a4'
    ? { width: 11906, height: 16838 }
    : { width: 12240, height: 15840 };

  const doc = new Document({
    // Without a document default Word falls back to Calibri 11pt, which is
    // why the exported file never matched the PDF.
    styles: {
      default: {
        document: {
          run: { font: LAYOUT.font.docx, size: ptToHalfPt(S.body), color: BLACK },
          paragraph: { spacing: SPACING },
        },
      },
      paragraphStyles: [{
        id: HEADING_STYLE,
        name: 'Section Heading',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { bold: true, size: ptToHalfPt(S.heading), color: BLACK },
        paragraph: {
          spacing: { ...SPACING, before: ptToDxa(SP.beforeHeading), after: ptToDxa(SP.afterHeading) },
          keepNext: true,
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: RULE_EIGHTHS,
              color: LAYOUT.color.rule.replace('#', ''),
              space: LAYOUT.rule.gapAbovePt,
            },
          },
        },
      }],
      characterStyles: [{
        id: LINK_STYLE,
        name: 'Hyperlink',
        basedOn: 'DefaultParagraphFont',
        run: { underline: { type: UnderlineType.SINGLE }, color: LAYOUT.color.link.replace('#', '') },
      }],
    },
    sections: [{ properties: { page: { margin: MARGIN, size } }, children }],
  });
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
