import React, { useEffect, useState } from 'react';
import { listCareerProfiles } from '../lib/firestore.js';

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
  const firstName = profileInfo?.name ? profileInfo.name.split(' ')[0] : null;

  const recs = buildRecommendations({ profile, resumes, activeResume, setView });
  const isNewUser = !resumes.length && !(profile?.experience?.length);

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

      <FlowGuide setView={setView} />
    </section>
  );
}

// The dashboard's job is to make the two ways of producing a resume obvious.
function FlowGuide({ setView }) {
  const flows = [
    {
      glyph: '✦',
      name: 'Build from scratch',
      when: 'You have no resume to start from, or you want one written specifically for this role.',
      lead: 'Writes a brand-new resume from your Career Profile. Nothing is carried over from an old document, so the structure and wording are shaped around the job you are applying for.',
      steps: [
        'Pick the Career Profile to build from — every fact in the resume comes from it, and nothing outside it can be claimed.',
        'Choose the target domain and speciality, for example Banking → Software Engineering. That loads the industry vocabulary and the writing rules for that role.',
        'Paste the job description.',
        'The agent writes the resume, scores it against the posting, and rewrites anything it left uncovered.',
      ],
      cta: 'Build from scratch',
    },
    {
      glyph: '▤',
      name: 'Tailor an existing resume',
      when: 'Your resume is already solid and just needs pointing at a particular job.',
      lead: 'Starts from a resume in your library and rewrites it against one specific job description, keeping the structure you already trust while re-pointing the language.',
      steps: [
        'Pick a resume from your library as the base.',
        'Choose how far the rewrite should go, from light touch-ups to a full rework.',
        'Paste the job description.',
        'Review a before and after comparison of what changed, then export.',
      ],
      cta: 'Tailor existing',
    },
  ];

  return (
    <section className="flow-guide">
      <h2 className="flow-guide-title">Two ways to get a resume</h2>
      <p className="flow-guide-sub">Both start from a job description and end with an ATS-scored resume you can download. The difference is what they build from.</p>

      <div className="flow-cards">
        {flows.map(f => (
          <article className="flow-card" key={f.name}>
            <div className="flow-card-head">
              <span className="flow-card-glyph" aria-hidden="true">{f.glyph}</span>
              <div>
                <h3 className="flow-card-name">{f.name}</h3>
                <p className="flow-card-when">{f.when}</p>
              </div>
            </div>
            <p className="flow-card-lead">{f.lead}</p>
            <ol className="flow-card-steps">
              {f.steps.map((s, i) => (
                <li key={i}><span className="flow-step-n">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
            <button className="btn btn-primary flow-card-cta" onClick={() => setView('agent')}>{f.cta} →</button>
          </article>
        ))}
      </div>

      <p className="flow-guide-foot">
        Either way the agent only uses facts it can find in your Career Profile or your existing resume. It will not invent an employer, a date, or a metric to fit the posting.
      </p>
    </section>
  );
}
