import React from 'react';

// Prototype-matching dashboard: stat cards → Quick Start tiles → feature banner → Recent Resumes table
export default function DashboardOverview({ state, setView, notify }) {
  const { resumes = [], profileInfo = {} } = state;

  const activeResume = resumes.find(r => r.id === state.activeResumeId) || resumes[0];
  const avgScore = resumes.length
    ? Math.round(resumes.reduce((s, r) => s + (r.atsScore || 0), 0) / resumes.length)
    : null;

  // Completeness: rough heuristic from profileInfo
  const completeness = profileInfo?.name && profileInfo?.sendingEmail ? 92 : 60;

  const recentResumes = resumes.slice(0, 6);

  function scoreBadgeClass(s) {
    return s >= 90 ? 'badge-success' : s >= 75 ? 'badge-primary' : 'badge-warning';
  }

  return (
    <section>
      <h1 className="page-title">Welcome back{profileInfo?.name ? `, ${profileInfo.name.split(' ')[0]}` : ''} 👋</h1>
      <p className="page-sub">Let's build your perfect resume today.</p>

      {/* Stat cards */}
      <div className="grid grid-3" style={{ marginBottom: 26 }}>
        <div className="card stat-card">
          <div className="label">📄 Resumes</div>
          <div className="value">{resumes.length}</div>
          <div className="sub">Total resumes</div>
        </div>
        <div className="card stat-card">
          <div className="label">✓ ATS Score (Avg)</div>
          <div className="value">{avgScore ?? '—'}</div>
          <div className={`sub${avgScore && avgScore >= 80 ? ' good' : ''}`}>
            {avgScore >= 90 ? 'Excellent' : avgScore >= 75 ? 'Good' : avgScore ? 'Fair' : 'No data yet'}
          </div>
        </div>
        <div className="card stat-card">
          <div className="label">◈ Profile Completeness</div>
          <div className="value">{completeness}%</div>
          <div className="sub">Primary profile</div>
        </div>
      </div>

      {/* Single entry point — shows the setup in use before asking the user to act */}
      <div className="status-card">
        <div className="status-card-body">
          <div className="status-card-label">Your current setup</div>
          <div className="status-card-rows">
            <div className="status-card-row">
              <span className="k">Default resume</span>
              <span className="v">
                {activeResume ? activeResume.label : <span className="none">None selected</span>}
                {!activeResume && <a onClick={() => setView('library')}>Add one →</a>}
              </span>
            </div>
            <div className="status-card-row">
              <span className="k">Career profile</span>
              <span className="v">
                {profileInfo?.name || <span className="none">Not set up</span>}
                {!profileInfo?.name && <a onClick={() => setView('careerprofile')}>Set up →</a>}
              </span>
            </div>
          </div>
        </div>
        <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => setView('agent')}>
          Open workspace →
        </button>
      </div>

      {/* Recent resumes table */}
      {recentResumes.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px 0' }} className="section-title-row">
            <h2>Recent Resumes</h2>
            <a onClick={() => setView('resumes')}>View all →</a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Last updated</th>
                <th>ATS Score</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentResumes.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setView('library')}>
                  <td className="cell-strong">{r.label}</td>
                  <td className="cell-muted">
                    {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td>
                    {r.atsScore ? <span className={`badge ${scoreBadgeClass(r.atsScore)}`}>{r.atsScore}</span> : <span className="cell-muted">—</span>}
                  </td>
                  <td>
                    {r.id === state.activeResumeId
                      ? <span className="badge badge-success">Default</span>
                      : <span className="cell-muted">—</span>}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setView('library'); }}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentResumes.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 6 }}>No resumes yet</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Upload your base resume in Resume Library, then tailor it for any JD.
          </p>
          <button className="btn btn-primary" onClick={() => setView('library')}>Go to Resume Library →</button>
        </div>
      )}
    </section>
  );
}
