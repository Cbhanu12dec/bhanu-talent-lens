import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Section, Row, DetailRow, StatusBadge, ConfirmModal, Field } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

const GOOGLE_MARK = (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12c-.2 2-1.5 4.9-4.4 6.9l-.1.3 6.4 4.9.4.1c4-3.7 6.7-9.2 6.7-15.5" />
    <path fill="#34A853" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-6.8-5.3c-1.8 1.3-4.3 2.2-7.5 2.2-5.7 0-10.6-3.8-12.3-9l-.3.1-6.6 5.1-.1.3C8.3 41.1 15.6 46 24 46" />
    <path fill="#FBBC05" d="M11.7 28.7c-.5-1.4-.7-2.8-.7-4.2s.3-2.9.7-4.2v-.3l-6.7-5.2-.2.1A22 22 0 0 0 2 24.5c0 3.5.9 6.9 2.8 10l6.9-5.8" />
    <path fill="#EA4335" d="M24 11.1c4 0 6.8 1.8 8.3 3.2l6.1-5.9C34.7 5 29.8 3 24 3 15.6 3 8.3 7.9 4.8 14.5l6.9 5.8c1.7-5.2 6.6-9.2 12.3-9.2" />
  </svg>
);

function strengthOf(pw) {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Strong'][score];
  return { score, label };
}

export default function AccountSection({ user }) {
  const { hasPasswordProvider, providerIds, changePassword, linkProvider, unlinkProvider } = useAuth();
  const toast = useToast();

  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [linkBusy, setLinkBusy] = useState(null);

  const strength = strengthOf(next);
  const googleLinked = providerIds.includes('google.com');

  async function submitPassword() {
    setPwError(null);
    if (!cur || !next) { setPwError('Fill in every field.'); return; }
    if (next.length < 8) { setPwError('Use at least 8 characters.'); return; }
    if (next !== confirm) { setPwError('New passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await changePassword(cur, next);
      setPwOpen(false); setCur(''); setNext(''); setConfirm('');
      toast({ kind: 'ok', title: 'Password updated' });
    } catch (err) {
      setPwError(err.message);
    }
    setPwBusy(false);
  }

  async function toggleProvider(id, linked) {
    setLinkBusy(id);
    try {
      if (linked) {
        await unlinkProvider(id);
        toast({ kind: 'ok', title: 'Account disconnected' });
      } else {
        await linkProvider(id);
        toast({ kind: 'ok', title: 'Account connected' });
      }
    } catch (err) {
      toast({ kind: 'bad', title: 'Could not update connection', detail: err.message });
    }
    setLinkBusy(null);
  }

  return (
    <>
      <Section title="Account information">
        <DetailRow
          label="Email address"
          value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {user?.email}
              {user?.emailVerified
                ? <StatusBadge tone="ok">Verified</StatusBadge>
                : <StatusBadge tone="warn">Unverified</StatusBadge>}
            </span>
          }
        />
        <DetailRow label="Account created" value={user?.metadata?.creationTime
          ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : null} />
        <DetailRow label="User ID" value={<code className="uid-code">{user?.uid}</code>} />
      </Section>

      <Section title="Password">
        <Row
          title="Account password"
          description={hasPasswordProvider
            ? 'Used together with your email address to sign in.'
            : 'You sign in with Google, so there is no separate password on this account.'}
          control={hasPasswordProvider
            ? <button className="btn btn-secondary btn-sm" onClick={() => setPwOpen(true)}>Change password</button>
            : <span className="srow-desc" style={{ margin: 0 }}>Not applicable</span>}
        />
      </Section>

      <Section
        title="Connected accounts"
        description="Sign-in methods linked to this account. Google is also what authorises Gmail drafts."
      >
        <div className="conn">
          <span className="conn-ico">{GOOGLE_MARK}</span>
          <div className="conn-text">
            <div className="conn-name">Google</div>
            <div className="conn-sub">
              {googleLinked
                ? user?.providerData?.find(p => p.providerId === 'google.com')?.email || 'Connected'
                : 'Not connected'}
            </div>
          </div>
          {googleLinked && <StatusBadge tone="ok">Connected</StatusBadge>}
          <button
            className={`btn btn-sm ${googleLinked ? 'btn-ghost' : 'btn-secondary'}`}
            disabled={linkBusy === 'google.com'}
            onClick={() => toggleProvider('google.com', googleLinked)}
          >
            {linkBusy === 'google.com' ? 'Working…' : googleLinked ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        <div className="conn">
          <span className="conn-ico" aria-hidden="true">✉</span>
          <div className="conn-text">
            <div className="conn-name">Email and password</div>
            <div className="conn-sub">{hasPasswordProvider ? user?.email : 'Not set up'}</div>
          </div>
          {hasPasswordProvider && <StatusBadge tone="ok">Connected</StatusBadge>}
        </div>
      </Section>

      <ConfirmModal
        open={pwOpen}
        onClose={() => { setPwOpen(false); setPwError(null); }}
        title="Change password"
        tone="primary"
        confirmLabel="Update password"
        busy={pwBusy}
        onConfirm={submitPassword}
        body={
          <div className="pw-form">
            {pwError && <div className="error-box" style={{ marginBottom: 14 }}>{pwError}</div>}
            <Field label="Current password">
              <input type="password" value={cur} autoComplete="current-password" onChange={e => setCur(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters. Mix cases, numbers and symbols for a stronger password.">
              <input type="password" value={next} autoComplete="new-password" onChange={e => setNext(e.target.value)} />
            </Field>
            {next && (
              <div className="pw-strength">
                <div className="pw-bars" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map(i => (
                    <span key={i} className={`pw-bar${i < strength.score ? ` is-on s${Math.min(strength.score, 5)}` : ''}`} />
                  ))}
                </div>
                <span className="pw-strength-label">{strength.label}</span>
              </div>
            )}
            <Field label="Confirm new password">
              <input type="password" value={confirm} autoComplete="new-password" onChange={e => setConfirm(e.target.value)} />
            </Field>
          </div>
        }
      />
    </>
  );
}
