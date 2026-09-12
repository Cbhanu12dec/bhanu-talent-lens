// Contact lines arrive as plain text ("name@x.com | linkedin.com/in/y | github.com/z"),
// so exporters have to recover the URL themselves to emit a real hyperlink.
export function contactHref(part) {
  const s = String(part || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  if (/^\+?[\d\s().-]{7,}$/.test(s)) return `tel:${s.replace(/[^\d+]/g, '')}`;
  if (/^(www\.|[\w-]+\.(com|io|dev|net|org|co|me|ai)\b)/i.test(s) || /\b(linkedin|github|gitlab|behance|dribbble|medium)\.com/i.test(s)) {
    return `https://${s.replace(/^\/+/, '')}`;
  }
  return null;
}

export function splitContact(contact) {
  return String(contact || '')
    .split(/[|•]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(text => ({ text, href: contactHref(text) }));
}
