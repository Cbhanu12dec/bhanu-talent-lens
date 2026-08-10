import React, { useState } from 'react';
const TEMPLATES = ['Minimal','Modern','Executive','Technical','Compact','Classic'];
export default function TemplatesView() {
  const [selected, setSelected] = useState('Minimal');
  return (
    <section>
      <h1 className="page-title">Templates</h1>
      <p className="page-sub">Pick a layout — applied when you export a PDF or DOCX.</p>
      <div className="grid grid-3">
        {TEMPLATES.map((t, i) => (
          <div key={t} className="card" style={{ padding: 16, cursor: 'pointer', border: selected === t ? '2px solid var(--primary)' : undefined, transition: 'border-color .12s' }} onClick={() => setSelected(t)}>
            <div style={{ height: 150, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>Preview</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t}</span>
              {i === 0 && <span className="badge badge-primary">Default</span>}
              {selected === t && i !== 0 && <span className="badge badge-success">Selected</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
