import React, { useEffect, useState } from 'react';
import { listCareerProfiles } from '../lib/firestore.js';

function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

function completenessOf(p) {
  if (!p) return 0;
  return Math.min(
    ((p.experience?.length > 0 ? 40 : 0) +
     (p.education?.length > 0 ? 25 : 0) +
     ((p.skills?.length || 0) >= 3 ? 20 : 0) +
     (p.experience?.length > 1 ? 15 : 0)), 100);
}

// Every recommendation carries a reason and exactly one CTA (§6).
function buildRecommendations({ profile, resumes, activeResume, setView }) {
  const recs = [];
  if (!profile || !(profile.experience?.length)) {
    recs.push({
      id: 'exp', level: 'HIGH PRIORITY', tone: 'danger',
      title: 'Add your work experience',
      reason: 'The Agent only builds from facts in your Career Profile — with no roles there, it has nothing to work from.',
      cta: 'Add experience', run: () => setView('careerprofile'),
    });
  }
  if (!resumes.length) {
    recs.push({
      id: 'upload', level: 'HIGH PRIORITY', tone: 'danger',
      title: 'Upload your current resume',
      reason: 'Tailoring a resume you already have is the fastest path to a JD-matched draft.',
      cta: 'Add resume', run: () => setView('resumes'),
    });
  }
  if ((profile?.skills?.length || 0) < 3) {
    recs.push({
      id: 'skills', level: 'MEDIUM', tone: 'warning',
      title: 'List at least 3 skills',
      reason: 'Skills are what the Agent matches against a job description to score your fit.',
      cta: 'Add skills', run: () => setView('careerprofile'),
    });
  }
  if (!profile?.education?.length) {
    recs.push({
      id: 'edu', level: 'MEDIUM', tone: 'warning',
      title: 'Add your education',
      reason: 'Many ATS filters screen on degree and institution before a human reads the resume.',
      cta: 'Add education', run: () => setView('careerprofile'),
    });
  }
  if (activeResume?.atsScore && activeResume.atsScore < 85) {
    recs.push({
      id: 'ats', level: 'OPPORTUNITY', tone: 'brand',
      title: `Raise "${activeResume.label}" above 85% ATS`,
      reason: `It scores ${activeResume.atsScore}% today. Re-tailoring against the job description usually closes most of that gap.`,
      cta: 'Tailor it', run: () => setView('agent'),
    });
  }
  if (resumes.length && profile?.experience?.length) {
    recs.push({
      id: 'tailor', level: 'OPPORTUNITY', tone: 'brand',
      title: 'Tailor a resume to a new job description',
      reason: 'Your profile and library are ready — paste a JD to get a matched draft.',
      cta: 'Open workspace', run: () => setView('agent'),
    });
  }
  return recs.slice(0, 4);
}

export default function DashboardOverview({ uid, state, setView }) {
  const { resumes = [], profileInfo = {}, activeResumeId } = state;
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');

  useEffect(() => {
    if (!uid) return;
    listCareerProfiles(uid).then(list => {
      setProfiles(list);
      setActiveProfileId(list.find(p => p.isDefault)?.id || list[0]?.id || '');
    }).catch(() => {});
  }, [uid]);

  const profile = profiles.find(p => p.id === activeProfileId) || null;
  const activeResume = resumes.find(r => r.id === activeResumeId) || resumes[0] || null;
  const completeness = completenessOf(profile);
  const firstName = profileInfo?.name ? profileInfo.name.split(' ')[0] : null;

  const recs = buildRecommendations({ profile, resumes, activeResume, setView });
  const isNewUser = !resumes.length && !(profile?.experience?.length);

  const activity = resumes.slice(0, 5).map(r => ({
    id: r.id,
    day: fmtDate(r.createdAt),
    text: `${r.label} added to your library`,
  }));

  if (isNewUser) {
    return (
      <section>
        <div className="dash-greeting" style={{ marginBottom: 20 }}>
          Welcome{firstName ? `, ${firstName}` : ''}
        </div>
        <div className="es-card">
          <div className="es-icon">◈</div>
          <div className="es-title">Start with your Career Profile</div>
          <p className="es-text">
            Your Career Profile is the single source of truth the Agent builds from. Add your roles once,
            and every resume after that is generated from real facts.
          </p>
          <button className="btn btn-primary" onClick={() => setView('careerprofile')}>+ Create Career Profile</button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="dash-greeting">Good to see you{firstName ? `, ${firstName}` : ''}</div>
      <p className="page-sub">Here's where your search stands today.</p>

      <div className="hero-card" style={{ marginBottom: 18 }}>
        <div className="hero-card-body">
          <div className="hero-card-title">{recs[0] ? recs[0].title : 'You’re all set up'}</div>
          <p className="hero-card-sub">
            {recs[0] ? recs[0].reason : 'Paste a job description and the Agent will tailor a resume against it.'}
          </p>
          <button className="btn btn-primary" onClick={() => (recs[0] ? recs[0].run() : setView('agent'))}>
            {recs[0] ? recs[0].cta : 'Tailor a resume'}
          </button>
        </div>
        <div className="hero-glyph">✦</div>
      </div>

      <div className="dash-two-col">
        <div>
          <div className="card" style={{ padding: 22, marginBottom: 18 }}>
            <div className="panel-head">
              <h2>Career Profile</h2>
              <a style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} onClick={() => setView('careerprofile')}>Open →</a>
            </div>

            {profiles.length > 1 && (
              <div className="chip-row" style={{ marginBottom: 14 }}>
                {profiles.map(p => (
                  <button key={p.id}
                    className={`profile-chip-sel${p.id === activeProfileId ? ' selected' : ''}`}
                    onClick={() => setActiveProfileId(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--display)' }}>
                {profile?.name || 'Primary Profile'}
              </span>
              {profile?.isDefault && <span className="badge badge-primary">PRIMARY</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 14 }}>
              {profile?.experience?.[0]?.title || 'Add a role to set your tagline'}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--ink-2)' }}>Profile completeness</span>
              <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{completeness}%</span>
            </div>
            <div className="progress-bar" style={{ height: 8 }}>
              <div className="progress-fill" style={{ width: `${completeness}%`, height: '100%' }} />
            </div>

            <div className="dash-stat-row">
              <div className="dash-stat"><b>{profile?.experience?.length || 0}</b>Experience</div>
              <div className="dash-stat"><b>{profile?.education?.length || 0}</b>Education</div>
              <div className="dash-stat"><b>{profile?.skills?.length || 0}</b>Skills</div>
              <div className="dash-stat"><b>{profile?.projects?.length || 0}</b>Projects</div>
              <div className="dash-stat"><b>{profile?.certifications?.length || 0}</b>Certifications</div>
            </div>
          </div>

          {/* Same data as Resume Library, not a separate metrics concept (§3). */}
          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head">
              <h2>Your resumes</h2>
              <a style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} onClick={() => setView('resumes')}>View all →</a>
            </div>
            {resumes.length === 0 ? (
              <div className="empty">No resumes yet.</div>
            ) : resumes.slice(0, 5).map(r => (
              <div className="lib-row" key={r.id} style={{ padding: '12px 0' }}>
                <div className="lib-body">
                  <div className="lib-name">
                    {r.label}
                    {r.id === activeResumeId && <span className="badge badge-primary">Default</span>}
                  </div>
                  <div className="lib-meta">
                    {r.atsScore ? `ATS ${r.atsScore}% · ` : ''}Updated {fmtDate(r.createdAt)}
                  </div>
                </div>
                <div className="lib-actions">
                  <button className="btn btn-sm" onClick={() => setView('resumes')}>Open</button>
                  <button className="btn btn-sm btn-primary" onClick={() => setView('agent')}>Tailor →</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 22, marginBottom: 18 }}>
            <div className="panel-head"><h2>Recommended for you</h2></div>
            {recs.length === 0 ? (
              <div className="empty">Nothing needs your attention right now.</div>
            ) : recs.map(rec => (
              <div className="rec-card" key={rec.id}>
                <span className={`badge badge-${rec.tone === 'danger' ? 'danger' : rec.tone === 'warning' ? 'warning' : 'primary'}`}>
                  {rec.level}
                </span>
                <div className="rec-title">{rec.title}</div>
                <div className="rec-reason">{rec.reason}</div>
                <button className="btn btn-sm btn-primary" onClick={rec.run}>{rec.cta}</button>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 22 }}>
            <div className="panel-head">
              <h2>Recent activity</h2>
              <a style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} onClick={() => setView('resumes')}>View all →</a>
            </div>
            {activity.length === 0 ? (
              <div className="empty">No activity yet.</div>
            ) : (
              <div className="activity-list">
                {activity.map(a => (
                  <div className="activity-item" key={a.id}>
                    <span className="activity-dot" />
                    <span className="activity-day">{a.day}</span>
                    <span className="activity-text">{a.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
