import React from 'react';

// Explains what a screen is for and where it sits in the tailoring flow.
// Kept generic so Resume Library, Career Profile and anything later stay consistent.
export default function PageHero({ glyph = '✦', title, lead, steps = [], footnote }) {
  return (
    <section className="page-hero">
      <div className="page-hero-main">
        <div className="page-hero-glyph" aria-hidden="true">{glyph}</div>
        <div className="page-hero-copy">
          <h2 className="page-hero-title">{title}</h2>
          <p className="page-hero-lead">{lead}</p>
        </div>
      </div>

      {steps.length > 0 && (
        <ol className="page-hero-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="page-hero-step-n">{i + 1}</span>
              <span><b>{s.title}</b> — {s.text}</span>
            </li>
          ))}
        </ol>
      )}

      {footnote && <p className="page-hero-foot">{footnote}</p>}
    </section>
  );
}
