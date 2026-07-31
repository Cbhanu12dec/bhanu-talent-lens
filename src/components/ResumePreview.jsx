import React from 'react';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wraps any occurrence of a highlight term (case-insensitive, whole
// phrases) in <mark>, splitting the text into plain/mark segments.
function highlightText(text, terms) {
  if (!terms || terms.length === 0) return text;
  const escaped = terms.map(escapeRegExp).filter(Boolean);
  if (escaped.length === 0) return text;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    terms.some(t => t.toLowerCase() === part.toLowerCase())
      ? <mark className="hl-term" key={i}>{part}</mark>
      : part
  );
}

function ParagraphLine({ text, terms }) {
  const m = text.match(/^([^:]{1,45}):\s*(.*)$/);
  if (m) return <p><strong>{m[1]}:</strong> {highlightText(m[2], terms)}</p>;
  return <p>{highlightText(text, terms)}</p>;
}

export default function ResumePreview({ resume, showHighlights = true }) {
  if (!resume) return null;
  const contactParts = (resume.contact || '').split('|').map(s => s.trim()).filter(Boolean);
  const terms = showHighlights ? (resume.highlights || []) : [];

  return (
    <div>
      <h4>{resume.name}</h4>
      {contactParts.length > 0 && <div className="contact-line">{contactParts.join('   •   ')}</div>}
      {(resume.sections || []).map((section, i) => (
        <div key={i}>
          <div className="sect">{section.heading}</div>
          {(section.paragraphs || []).map((p, j) => <ParagraphLine key={j} text={p} terms={terms} />)}
          {(section.entries || []).map((entry, k) => (
            <div className="doc-entry" key={k}>
              <div className="doc-entry-head">
                <span className="doc-entry-title">{entry.title}</span>
                {entry.dateRight && <span className="doc-entry-date">{entry.dateRight}</span>}
              </div>
              {entry.subtitle && <div className="doc-entry-subtitle">{entry.subtitle}</div>}
              {entry.bullets && entry.bullets.length > 0 && (
                <ul>{entry.bullets.map((b, m) => <li key={m}>{highlightText(b, terms)}</li>)}</ul>
              )}
              {entry.footer && <div className="doc-entry-footer">{entry.footer}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
