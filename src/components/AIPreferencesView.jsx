import React, { useState } from 'react';
import { saveProfileInfo } from '../lib/firestore.js';

const DEFAULTS = {
  preferredLanguage: '',
  backendFocus: false,
  atsTarget: 92,
  leadershipEmphasis: false,
  technicalDepth: false
};

export default function AIPreferencesView({ uid, state }) {
  const { profileInfo, setProfileInfo } = state;
  const prefs = { ...DEFAULTS, ...(profileInfo.aiPreferences || {}) };
  const [saved, setSaved] = useState(false);

  function update(patch) {
    setProfileInfo({ ...profileInfo, aiPreferences: { ...prefs, ...patch } });
  }

  async function handleSave() {
    await saveProfileInfo(uid, { aiPreferences: prefs });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section>
      <h1 className="page-title">AI preferences</h1>
      <p className="page-sub">Standing defaults applied to every resume you tailor, on top of any per-resume prompts in Resume library. STAR-format bullets, quantified metrics, and buzzword-free writing are always applied automatically — no toggle needed.</p>

      <div className="panel">
        <div className="panel-head"><h2>Writing style</h2></div>
        <label className="pref-row">
          <input type="checkbox" checked={prefs.leadershipEmphasis} onChange={e => update({ leadershipEmphasis: e.target.checked })} />
          <div><div className="pref-row-title">Emphasize leadership</div><div className="pref-row-sub">Favor scope, ownership, and people/stakeholder impact over pure IC work</div></div>
        </label>
        <label className="pref-row">
          <input type="checkbox" checked={prefs.technicalDepth} onChange={e => update({ technicalDepth: e.target.checked })} />
          <div><div className="pref-row-title">Emphasize technical depth</div><div className="pref-row-sub">Favor architecture, implementation detail, and technical decision-making</div></div>
        </label>
        <label className="pref-row">
          <input type="checkbox" checked={prefs.backendFocus} onChange={e => update({ backendFocus: e.target.checked })} />
          <div><div className="pref-row-title">Backend-leaning framing</div><div className="pref-row-sub">When work spans frontend/backend, lean into the backend side by default</div></div>
        </label>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Defaults</h2></div>
        <div className="field">
          <span className="field-label">Preferred language / stack (optional)</span>
          <input type="text" value={prefs.preferredLanguage} onChange={e => update({ preferredLanguage: e.target.value })} placeholder="e.g. Java, Go" />
        </div>
        <span className="field-label">Default ATS target — {prefs.atsTarget}%</span>
        <input type="range" min="60" max="100" value={prefs.atsTarget} onChange={e => update({ atsTarget: Number(e.target.value) })} style={{ width: '100%' }} />
        <div className="anno">Individual resumes in Resume library can still override this per-resume.</div>
        <div className="toolbar">
          {saved && <span style={{ color: 'var(--success)', fontSize: 12, alignSelf: 'center', marginRight: 'auto' }}>Saved ✓</span>}
          <button className="btn btn-primary" onClick={handleSave}>Save preferences</button>
        </div>
      </div>
    </section>
  );
}
