import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, TabStopType, TabStopPosition
} from 'docx';

const NAVY = '1E3A5F';
const MUTED = '5A5A5A';

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
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
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
    out.push(new Paragraph({
      indent: { left: 400, hanging: 400 },
      spacing: { after: 60 },
      children: [new TextRun(`•  ${b}`)]
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

export async function buildResumeDocx(resume, title = 'Resume') {
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: resume.name || '', bold: true, size: 38, color: NAVY })]
  }));

  if (resume.contact) {
    const parts = resume.contact.split('|').map(s => s.trim()).filter(Boolean);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [new TextRun({ text: parts.join('   •   '), color: MUTED, size: 19 })]
    }));
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

  const doc = new Document({ sections: [{ children }] });
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
