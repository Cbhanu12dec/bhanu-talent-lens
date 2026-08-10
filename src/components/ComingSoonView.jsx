import React from 'react';

export default function ComingSoonView({ title, sub, icon, blurb }) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">{sub}</p>
      <div className="panel">
        <div className="stub-page">
          <div className="stub-page-icon">{icon}</div>
          <h3>Coming soon</h3>
          <p>{blurb}</p>
          <div className="chip" style={{ display: 'inline-flex' }}>On the roadmap</div>
        </div>
      </div>
    </section>
  );
}
