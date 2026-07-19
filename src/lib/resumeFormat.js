export function flattenResume(resume) {
  if (!resume) return '';
  const lines = [resume.name, resume.contact, ''];
  (resume.sections || []).forEach(section => {
    lines.push(section.heading);
    if (section.paragraphs) {
      section.paragraphs.forEach(p => lines.push(p));
    }
    if (section.entries) {
      section.entries.forEach(entry => {
        const head = [entry.title, entry.subtitle].filter(Boolean).join(' — ');
        lines.push(entry.dateRight ? `${head}  (${entry.dateRight})` : head);
        (entry.bullets || []).forEach(b => lines.push(`- ${b}`));
        if (entry.footer) lines.push(entry.footer);
      });
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}
