// Single source of truth for resume document layout. pdf.js, docx.js and the
// on-screen preview all read from here so a resume looks identical wherever it
// is rendered, and so changing the design system is one edit rather than three.
//
// Values are the default production configuration: US Letter, single column,
// Arial, black on white, sized for ATS parsing and recruiter scanning.

const PT_PER_IN = 72;
const TWIPS_PER_IN = 1440;

export const PAGE = {
  letter: { wIn: 8.5, hIn: 11 },
  a4: { wIn: 8.27, hIn: 11.69 },
};

export const LAYOUT = {
  margin: { top: 0.55, bottom: 0.55, left: 0.60, right: 0.60 }, // inches
  font: {
    // jsPDF ships Helvetica, not Arial. They are metrically compatible and
    // Helvetica is the approved fallback, so the two renderers stay aligned.
    pdf: 'helvetica',
    docx: 'Arial',
    css: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  },
  size: {           // points
    name: 18,
    contact: 9.5,
    heading: 11.5,
    jobTitle: 10.5,
    company: 10,
    date: 9.5,
    body: 10,
    skills: 10,
    footer: 9.5,
  },
  lineHeight: 1.05,
  space: {          // points
    afterName: 3.5,
    afterContact: 9,
    // Top of the approved 9-11pt range: section breaks are the strongest
    // separation on the page and carry the scanning hierarchy.
    beforeHeading: 11,
    afterHeading: 5,
    afterParagraph: 4,
    afterBullet: 2.5,
    afterJob: 7,
    afterTitleLine: 1.5,
  },
  bullet: {
    char: '\u2022',
    glyphIndent: 0.20,  // inches from the left margin
    textIndent: 0.38,   // inches from the left margin
  },
  color: {
    text: '#000000',
    // Links stay black: colour must never be load-bearing on an ATS document.
    link: '#000000',
  },
  separator: ' | ',
  maxNamePt: 20,
  minBodyPt: 9.5,
};

export const inToPt = i => Math.round(i * PT_PER_IN * 100) / 100;
export const inToTwips = i => Math.round(i * TWIPS_PER_IN);
/** docx sizes are half-points. */
export const ptToHalfPt = p => Math.round(p * 2);
/** docx spacing is twentieths of a point. */
export const ptToDxa = p => Math.round(p * 20);

export const leading = pt => Math.round(pt * LAYOUT.lineHeight * 100) / 100;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_LOOKUP = new Map();
MONTHS.forEach((m, i) => {
  MONTH_LOOKUP.set(m.toLowerCase(), m);
  MONTH_LOOKUP.set(m.slice(0, 3).toLowerCase(), m);
});
const PRESENT_RE = /^(present|current|now|to date|ongoing)$/i;

/**
 * Normalises one end of a range to "Month YYYY", or "YYYY" when the month is
 * genuinely unknown. Never guesses a month — an invented date is a factual
 * error, not a formatting one.
 */
function normalizeDatePart(part) {
  const s = String(part || '').trim().replace(/[.,]+$/, '');
  if (!s) return '';
  if (PRESENT_RE.test(s)) return 'Present';

  // 01/2023, 1-2023
  let m = s.match(/^(\d{1,2})\s*[/\-.]\s*(\d{4})$/);
  if (m) {
    const idx = Number(m[1]) - 1;
    return MONTHS[idx] ? `${MONTHS[idx]} ${m[2]}` : m[2];
  }
  // 2023-01
  m = s.match(/^(\d{4})\s*[/\-.]\s*(\d{1,2})$/);
  if (m) {
    const idx = Number(m[2]) - 1;
    return MONTHS[idx] ? `${MONTHS[idx]} ${m[1]}` : m[1];
  }
  // Jan 2023 / January 2023 / Jan. 2023
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const full = MONTH_LOOKUP.get(m[1].toLowerCase());
    return full ? `${full} ${m[2]}` : s;
  }
  // Jan '23
  m = s.match(/^([A-Za-z]{3,9})\.?\s*'(\d{2})$/);
  if (m) {
    const full = MONTH_LOOKUP.get(m[1].toLowerCase());
    if (full) return `${full} 20${m[2]}`;
  }
  if (/^\d{4}$/.test(s)) return s;
  return s;
}

/**
 * "Jan 2020 - Mar 2023" becomes "January 2020 – March 2023". One date style
 * per document is a hard consistency rule, so every date passes through here
 * rather than being rendered as the model happened to write it.
 */
export function formatDateRange(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // A bare hyphen is also the separator inside 2023-01 and 01-2023, so only
  // split on a dash that is actually acting as a range: a real en/em dash, a
  // spaced hyphen, or a hyphen running into an end-of-range word.
  const parts = s.split(/\s*[\u2013\u2014]\s*|\s+-\s+|\s*-\s*(?=present|current|now\b)|\s+to\s+/i);
  if (parts.length < 2) return normalizeDatePart(s);
  const from = normalizeDatePart(parts[0]);
  const to = normalizeDatePart(parts.slice(1).join(' '));
  if (!from) return to;
  if (!to) return from;
  return `${from} \u2013 ${to}`;
}

/** Section headings are uppercase for scanability and parser familiarity. */
export function formatHeading(h) {
  return String(h || '').trim().toUpperCase();
}

/**
 * Bullet allowance by recency. Used as guidance for overflow trimming, never
 * to pad a role that genuinely has less to say.
 */
export const BULLET_BUDGET = [7, 6, 5, 4];
