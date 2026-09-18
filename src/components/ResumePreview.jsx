import React from 'react';
import { splitContact } from '../lib/contactLinks.js';
import { LAYOUT, formatDateRange, formatHeading } from '../lib/resumeLayout.js';
import { paragraphId, bulletId } from '../lib/resumeBlocks.js';

const SEPARATOR = LAYOUT.separator;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wraps any occurrence of a highlight term (case-insensitive, whole
// phrases) in <mark>, splitting the text into plain/mark segments.
function highlightText(text, terms) {
  if (!terms || terms.length === 0) return text;
  // Longest first: regex alternation is leftmost-first, so "Java" listed before
  // "JavaScript" would otherwise chop "JavaScript" into "Java" + "Script".
  const ordered = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  const escaped = ordered.map(escapeRegExp);
  if (escaped.length === 0) return text;
  // Word-boundary guards stop a term matching inside a larger word.
  const re = new RegExp(`(?<![\\w])(${escaped.join('|')})(?![\\w])`, 'gi');
  const parts = String(text).split(re);
  const lower = new Set(ordered.map(t => t.toLowerCase()));
  return parts.map((part, i) =>
    part && lower.has(part.toLowerCase())
      ? <mark className="hl-term" key={i}>{part}</mark>
      : part
  );
}

/**
 * Wraps one editable block. When `edit` is absent the markup is identical to
 * the read-only preview, so the export and the static view are unaffected.
 */
function Block({ id, edit, pinned, className, children, blockMeta }) {
  if (!edit) return <div className={className}>{children}</div>;
  const active = edit.selectedId === id;
  return (
    <div className={`${className || ''} rb${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}`.trim()}>
      <div
        className="rb-text" role="button" tabIndex={0}
        aria-label="Edit this block"
        onClick={e => { e.stopPropagation(); edit.onSelect(active ? null : id, blockMeta); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit.onSelect(active ? null : id, blockMeta); }
        }}
      >
        {children}
        {pinned && <span className="rb-pin" title="Pinned — kept as-is when you regenerate">Pinned</span>}
      </div>
      {active && edit.renderEditor(id, blockMeta)}
    </div>
  );
}

function ParagraphLine({ text, terms }) {
  const m = text.match(/^([^:]{1,45}):\s*(.*)$/);
  if (m) return <p><strong>{m[1]}:</strong> {highlightText(m[2], terms)}</p>;
  return <p>{highlightText(text, terms)}</p>;
}

export default function ResumePreview({ resume, showHighlights = true, edit = null, pinnedIds = null }) {
  if (!resume) return null;
  const contactParts = splitContact(resume.contact);
  const terms = showHighlights ? (resume.highlights || []) : [];
  const isPinned = id => !!pinnedIds?.has?.(id);

  return (
    <div onClick={() => edit?.onSelect(null)}>
      <h4>{resume.name}</h4>
      {contactParts.length > 0 && (
        <div className="contact-line">
          {contactParts.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && SEPARATOR}
              {p.href
                ? <a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
                : p.text}
            </React.Fragment>
          ))}
        </div>
      )}
      {(resume.sections || []).map((section, i) => (
        <div key={i}>
          <div className="sect">{formatHeading(section.heading)}</div>

          {(section.paragraphs || []).map((p, j) => {
            const id = paragraphId(section.heading, j);
            return (
              <Block
                key={id} id={id} edit={edit} pinned={isPinned(id)}
                blockMeta={{ id, kind: 'paragraph', section: section.heading, text: p, path: { si: i, pi: j } }}
              >
                <ParagraphLine text={p} terms={terms} />
              </Block>
            );
          })}

          {(section.entries || []).map((entry, k) => (
            <div className="doc-entry" key={k}>
              <div className="doc-entry-head">
                <span className="doc-entry-title">{entry.title}</span>
                {entry.dateRight && <span className="doc-entry-date">{formatDateRange(entry.dateRight)}</span>}
              </div>
              {entry.subtitle && <div className="doc-entry-subtitle">{entry.subtitle}</div>}
              {entry.bullets && entry.bullets.length > 0 && (
                <ul>
                  {entry.bullets.map((b, m) => {
                    const id = bulletId(section.heading, entry.title, k, m);
                    return (
                      <li key={id}>
                        <Block
                          id={id} edit={edit} pinned={isPinned(id)} className="rb-li"
                          blockMeta={{
                            id, kind: 'bullet', section: section.heading, text: b,
                            entryTitle: entry.title || '', entrySubtitle: entry.subtitle || '',
                            siblingBullets: (entry.bullets || []).filter((_, n) => n !== m),
                            path: { si: i, ei: k, bi: m },
                          }}
                        >
                          {highlightText(b, terms)}
                        </Block>
                      </li>
                    );
                  })}
                </ul>
              )}
              {entry.footer && <div className="doc-entry-footer">{entry.footer}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
