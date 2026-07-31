import React, { useEffect, useState } from 'react';

const STEPS = [
  'Reading job description',
  'Finding key skills',
  'Tailoring resume',
  'Calculating ATS score',
  'Formatting document'
];

// Advances one step at a time on a fixed cadence while the real request is
// in flight, and holds at the last step if the request takes longer than
// the fake timeline — never claims false precision, just gives a sense of
// progress during what is a genuinely multi-part operation server-side.
export default function LoaderOverlay({ open, title, subtitle }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) { setActiveIndex(0); return; }
    const id = setInterval(() => {
      setActiveIndex(i => Math.min(i + 1, STEPS.length - 1));
    }, 1300);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;
  const pct = Math.round(((activeIndex + 1) / STEPS.length) * 100);

  return (
    <div className="loader-overlay">
      <div className="loader-card">
        <div className="loader-top">
          <div className="loader-spin"></div>
          <div>
            <div className="loader-title">{title}</div>
            {subtitle && <div className="loader-sub">{subtitle}</div>}
          </div>
        </div>
        <div className="lsteps">
          {STEPS.map((label, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : '';
            return (
              <div className={`lstep ${state}`} key={i}>
                <div className="lstep-icon">{state === 'done' ? '✓' : ''}</div>
                {label}
              </div>
            );
          })}
        </div>
        <div className="loader-bar-track"><div className="loader-bar-fill" style={{ width: pct + '%' }}></div></div>
      </div>
    </div>
  );
}
