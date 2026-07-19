import React from 'react';

function ParagraphLine({ text }) {
  const m = text.match(/^([^:]{1,45}):\s*(.*)$/);
  if (m) return <p><strong>{m[1]}:</strong> {m[2]}</p>;
  return <p>{text}</p>;
}

export default function ResumePreview({ resume }) {
  if (!resume) return null;
  const contactParts = (resume.contact || '').split('|').map(s => s.trim()).filter(Boolean);

  return (
    <div>
      <h4>{resume.name}</h4>
      {contactParts.length > 0 && <div className="contact-line">{contactParts.join('   •   ')}</div>}
      {(resume.sections || []).map((section, i) => (
        <div key={i}>
          <div className="sect">{section.heading}</div>
          {(section.paragraphs || []).map((p, j) => <ParagraphLine key={j} text={p} />)}
          {(section.entries || []).map((entry, k) => (
            <div className="doc-entry" key={k}>
              <div className="doc-entry-head">
                <span className="doc-entry-title">{entry.title}</span>
                {entry.dateRight && <span className="doc-entry-date">{entry.dateRight}</span>}
              </div>
              {entry.subtitle && <div className="doc-entry-subtitle">{entry.subtitle}</div>}
              {entry.bullets && entry.bullets.length > 0 && (
                <ul>{entry.bullets.map((b, m) => <li key={m}>{b}</li>)}</ul>
              )}
              {entry.footer && <div className="doc-entry-footer">{entry.footer}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
