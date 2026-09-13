import React, { useId } from 'react';
import {
  ICON_VIEWBOX, GRADIENTS, markParts, TAGLINE, TAGLINE_SECONDARY
} from '../lib/brandMark.js';

// Icon px / wordmark px per step. `md` is the header size and satisfies the
// 38-44px icon, 24-28px wordmark spec.
const SIZES = {
  xs: { icon: 22, word: 14 },
  sm: { icon: 30, word: 18 },
  md: { icon: 42, word: 25 },
  lg: { icon: 56, word: 33 },
  xl: { icon: 76, word: 44 }
};

function Grad({ id, g }) {
  return (
    <linearGradient id={id} x1={g.coords[0]} y1={g.coords[1]} x2={g.coords[2]} y2={g.coords[3]} gradientUnits="userSpaceOnUse">
      {g.stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
    </linearGradient>
  );
}

/**
 * The mark on its own. `detail="simple"` drops the content rules, which fall
 * below a pixel and turn to haze under roughly 24px.
 */
export function LogoMark({ size = 42, detail, decorative = true }) {
  // Gradient ids must be unique per instance or the first mark on the page
  // wins for every later one. useId's colons are stripped for url(#...) safety.
  const uid = useId().replace(/:/g, '');
  const level = detail || (size < 24 ? 'simple' : 'full');

  const a11y = decorative
    ? { 'aria-hidden': true, focusable: false }
    : { role: 'img', 'aria-label': 'ResumeCraft Pro' };

  return (
    <svg width={size} height={size} viewBox={ICON_VIEWBOX} fill="none" style={{ flex: 'none', display: 'block' }} {...a11y}>
      <defs>
        <Grad id={`${uid}-brand`} g={GRADIENTS.brand} />
        <Grad id={`${uid}-swoosh`} g={GRADIENTS.swoosh} />
      </defs>
      {markParts({ idPrefix: uid, detail: level }).map(p => (
        <path
          key={p.key}
          d={p.d}
          fill={p.fill || 'none'}
          stroke={p.stroke}
          strokeWidth={p.w}
          strokeLinecap={p.cap}
          strokeLinejoin={p.join}
        />
      ))}
    </svg>
  );
}

/**
 * The one place logo markup lives. Every surface composes this rather than
 * hand-rolling its own copy.
 *
 * variant: "full" | "icon" | "wordmark"
 * theme:   "light" | "dark"
 * size:    "xs" | "sm" | "md" | "lg" | "xl"
 * responsive: collapse to "ResumeCraft", then to the icon alone, as width drops
 */
export default function Logo({
  variant = 'full',
  theme = 'light',
  size = 'md',
  responsive = false,
  tagline = false,
  secondary = false,
  className = ''
}) {
  const s = SIZES[size] || SIZES.md;
  const cls = ['rcp-logo', `rcp-logo--${theme}`, responsive ? 'rcp-logo--responsive' : '', className]
    .filter(Boolean).join(' ');

  if (variant === 'icon') {
    return (
      <span className={cls}>
        <LogoMark size={s.icon} decorative={false} />
      </span>
    );
  }

  const word = (
    <span className="rcp-logo__text" style={{ fontSize: s.word }}>
      <span className="rcp-logo__word">
        ResumeCraft<span className="rcp-logo__pro">Pro</span>
      </span>
      {tagline && <span className="rcp-logo__tagline">{TAGLINE}</span>}
      {secondary && <span className="rcp-logo__sub">{TAGLINE_SECONDARY}</span>}
    </span>
  );

  if (variant === 'wordmark') return <span className={cls}>{word}</span>;

  return (
    <span className={cls}>
      <LogoMark size={s.icon} />
      {word}
    </span>
  );
}
