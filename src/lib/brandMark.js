// Single source of truth for the ResumeCraft Pro mark. Geometry is taken
// verbatim from the approved logo SVG: an outlined resume page with a folded
// corner, three content rules, an upward-right swoosh arrow, and a purple mass
// in the lower right. Both the React <Logo> and scripts/gen-brand-assets.mjs
// read from here so the app and the exported /assets/brand files cannot drift.

export const ICON_VIEWBOX = '22 12 228 228';

export const BRAND = {
  navy: '#071B4A',
  blue: '#087CF0',
  cyan: '#08C4F4',
  indigo: '#3152F4',
  purple: '#7924F5',
  accent: '#6B25F4',
  head: '#10A9F3',
  rule: '#91A9D4',
  muted: '#65718B',
  paper: '#FFFFFF',
  darkBg: '#07152F'
};

// gradientUnits="userSpaceOnUse", so coords live in the icon's own space.
export const GRADIENTS = {
  brand: {
    coords: [55, 25, 255, 235],
    stops: [['0', '#08C4F4'], ['.38', '#078AF5'], ['.7', '#3152F4'], ['1', '#7924F5']]
  },
  swoosh: {
    coords: [60, 200, 245, 110],
    stops: [['0', '#2449F2'], ['.62', '#087EF5'], ['1', '#11B9F3']]
  },
  // Mapped to the "Pro" glyphs' own box so the fill survives the text landing
  // at a different x under whichever font actually resolves.
  pro: {
    units: 'objectBoundingBox',
    coords: [0, 0, 1, 0.6],
    stops: [['0', '#7A20F5'], ['.48', '#3557F6'], ['1', '#078BF3']]
  }
};

export const PATHS = {
  doc: 'M84 27H193L228 62V185C228 207 210 225 188 225H84C62 225 44 207 44 185V67C44 45 62 27 84 27Z',
  fold: 'M193 28V61H226',
  rules: 'M106 92H170M106 121H181M106 150H158',
  arrow: 'M70 217C123 210 169 178 211 135',
  head: 'M193 119L241 103L234 151',
  accent: 'M139 226H207C219 226 228 217 228 205V170C207 194 179 214 139 226Z'
};

export const STROKE = { doc: 25, fold: 25, rules: 12, arrow: 25 };

export const WORDMARK = {
  font: "Inter, Manrope, 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  weight: 750,
  tracking: '-0.048em'
};

export const TAGLINE = 'BUILD · OPTIMIZE · GET HIRED';
export const TAGLINE_SECONDARY = 'Smarter Resumes. Brighter Careers.';

const gradDef = (id, g) =>
  `<linearGradient id="${id}" x1="${g.coords[0]}" y1="${g.coords[1]}" x2="${g.coords[2]}" y2="${g.coords[3]}" gradientUnits="${g.units || 'userSpaceOnUse'}">`
  + g.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
  + `</linearGradient>`;

/** The mark's drawing ops, shared by the SVG serialiser and the React component. */
export function markParts({ idPrefix = 'rcp', detail = 'full' } = {}) {
  const brand = `url(#${idPrefix}-brand)`;
  const swoosh = `url(#${idPrefix}-swoosh)`;
  const out = [
    { key: 'doc', d: PATHS.doc, stroke: brand, w: STROKE.doc, join: 'round' },
    { key: 'fold', d: PATHS.fold, stroke: brand, w: STROKE.fold, cap: 'round', join: 'round' }
  ];
  // The 12-unit rules fall below a pixel under roughly 24px and turn to haze.
  if (detail === 'full') {
    out.push({ key: 'rules', d: PATHS.rules, stroke: BRAND.rule, w: STROKE.rules, cap: 'round' });
  }
  out.push(
    { key: 'arrow', d: PATHS.arrow, stroke: swoosh, w: STROKE.arrow, cap: 'round' },
    { key: 'head', d: PATHS.head, fill: BRAND.head },
    { key: 'accent', d: PATHS.accent, fill: BRAND.accent }
  );
  return out;
}

const partToSvg = p => {
  const a = [`d="${p.d}"`, p.fill ? `fill="${p.fill}"` : 'fill="none"'];
  if (p.stroke) a.push(`stroke="${p.stroke}"`, `stroke-width="${p.w}"`);
  if (p.cap) a.push(`stroke-linecap="${p.cap}"`);
  if (p.join) a.push(`stroke-linejoin="${p.join}"`);
  return `<path ${a.join(' ')}/>`;
};

/**
 * Standalone icon SVG for the exported brand files.
 * `background` paints an opaque rounded tile behind the mark, which iOS and
 * social avatars require since they will not honour transparency.
 */
export function iconSvg({ px = 256, detail = 'full', idPrefix = 'rcp', background = null, pad = 0 } = {}) {
  const [vx, vy, vw] = ICON_VIEWBOX.split(' ').map(Number);
  const size = vw + pad * 2;
  const box = `${vx - pad} ${vy - pad} ${size} ${size}`;
  const bg = background
    ? `<rect x="${vx - pad}" y="${vy - pad}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${background}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${box}" fill="none" role="img" aria-label="ResumeCraft Pro">`
    + `<defs>${gradDef(`${idPrefix}-brand`, GRADIENTS.brand)}${gradDef(`${idPrefix}-swoosh`, GRADIENTS.swoosh)}</defs>`
    + bg
    + markParts({ idPrefix, detail }).map(partToSvg).join('')
    + `</svg>`;
}

/**
 * Horizontal lockup for the exported brand files, on the approved 950x264
 * layout. Text stays live rather than outlined so the files remain editable;
 * the app renders its wordmark as real HTML text instead of using this.
 */
export function lockupSvg({ theme = 'light', idPrefix = 'rcp', tagline = true, secondary = false } = {}) {
  const wordColor = theme === 'dark' ? '#FFFFFF' : BRAND.navy;
  const subColor = theme === 'dark' ? '#8FA6C9' : BRAND.muted;
  const height = secondary ? 264 : tagline ? 212 : 245;
  const f = WORDMARK.font;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="950" height="${height}" viewBox="0 0 950 ${height}" fill="none" role="img" aria-label="ResumeCraft Pro">`
    + `<defs>${gradDef(`${idPrefix}-brand`, GRADIENTS.brand)}${gradDef(`${idPrefix}-swoosh`, GRADIENTS.swoosh)}${gradDef(`${idPrefix}-pro`, GRADIENTS.pro)}</defs>`
    + markParts({ idPrefix, detail: 'full' }).map(partToSvg).join('')
    // One <text> with tspans, so "Pro" always follows the wordmark rather than
    // sitting at a fixed x that only lines up for one specific font's metrics.
    + `<text x="286" y="153" font-family="${f}" font-size="83" font-weight="750" letter-spacing="-4">`
    + `<tspan fill="${wordColor}">ResumeCraft</tspan>`
    + `<tspan fill="url(#${idPrefix}-pro)" dx="20">Pro</tspan></text>`
    + (tagline ? `<text x="290" y="199" fill="${subColor}" font-family="${f}" font-size="21" font-weight="500" letter-spacing="8">${TAGLINE}</text>` : '')
    + (secondary ? `<text x="570" y="254" text-anchor="middle" fill="${subColor}" font-family="${f}" font-size="20" font-weight="400" letter-spacing="3">${TAGLINE_SECONDARY}</text>` : '')
    + `</svg>`;
}
