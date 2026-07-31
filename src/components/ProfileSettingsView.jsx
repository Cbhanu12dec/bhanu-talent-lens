import React, { useState } from 'react';
import { saveProfileInfo } from '../lib/firestore.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ProfileSettingsView({ uid, state }) {
  const { profileInfo, setProfileInfo } = state;
  const { hasPasswordProvider, changePassword } = useAuth();
  const [saved, setSaved] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function handleSaveInfo() {
    await saveProfileInfo(uid, profileInfo);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleUpdatePassword() {
    setPwError(null); setPwSuccess(null);
    if (!currentPw || !newPw) { setPwError('Fill in both fields.'); return; }
    if (newPw.length < 6) { setPwError('New password should be at least 6 characters.'); return; }
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess('Password updated.');
      setCurrentPw(''); setNewPw('');
    } catch (err) {
      setPwError(err.message);
    }
    setPwBusy(false);
  }

  return (
    <section>
      <h1 className="page-title">Profile and settings</h1>
      <p className="page-sub">Your info and how TalentLens sends on your behalf.</p>

      <div className="panel">
        <div className="panel-head"><h2>Basic info</h2></div>
        <div className="row-2">
          <div className="field"><span className="field-label">Full name</span>
            <input type="text" value={profileInfo.name || ''} onChange={e => setProfileInfo({ ...profileInfo, name: e.target.value })} placeholder="Alex Rivera" />
          </div>
          <div className="field"><span className="field-label">Sending email</span>
            <input type="email" value={profileInfo.sendingEmail || ''} onChange={e => setProfileInfo({ ...profileInfo, sendingEmail: e.target.value })} placeholder="alex@rivera.dev" />
          </div>
          <div className="field"><span className="field-label">Phone</span>
            <input type="text" value={profileInfo.phone || ''} onChange={e => setProfileInfo({ ...profileInfo, phone: e.target.value })} placeholder="+1 555 010 1234" />
          </div>
          <div className="field"><span className="field-label">LinkedIn / site</span>
            <input type="text" value={profileInfo.link || ''} onChange={e => setProfileInfo({ ...profileInfo, link: e.target.value })} placeholder="linkedin.com/in/alexrivera" />
          </div>
        </div>
        <div className="anno">Emails sent from the Dashboard use this address as the Gmail draft's From/Reply-to — it must match the Google account you signed in with.</div>
        <div className="toolbar">
          {saved && <span style={{ color: 'var(--success)', fontSize: 12, alignSelf: 'center', marginRight: 'auto' }}>Saved ✓</span>}
          <button className="btn btn-primary" onClick={handleSaveInfo}>Save changes</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Password and security</h2></div>
        {hasPasswordProvider ? (
          <>
            {pwError && <div className="error-box">{pwError}</div>}
            {pwSuccess && <div className="success-box">{pwSuccess}</div>}
            <div className="row-2">
              <div className="field"><span className="field-label">Current password</span>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="field"><span className="field-label">New password</span>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <div className="toolbar">
              <button className="btn" disabled={pwBusy} onClick={handleUpdatePassword}>{pwBusy ? 'Updating…' : 'Update password'}</button>
            </div>
          </>
        ) : (
          <div className="anno">You're signed in with Google — there's no separate TalentLens password to manage here.</div>
        )}
      </div>
    </section>
  );
}
