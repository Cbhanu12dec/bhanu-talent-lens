import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import Logo from './Logo.jsx';

const GOOGLE_G = (
  <svg width="16" height="16" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.4 29.4 35.5 24 35.5c-6.9 0-12.5-5.6-12.5-12.5S17.1 10.5 24 10.5c3.2 0 6 1.2 8.2 3.1l5.7-5.7C34.6 4.7 29.6 2.5 24 2.5 12.1 2.5 2.5 12.1 2.5 24S12.1 45.5 24 45.5 45.5 35.9 45.5 24c0-1.2-.1-2.4-.3-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.6l6.6 4.8C14.6 15.7 18.9 12.5 24 12.5c3.2 0 6 1.2 8.2 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5c-7.6 0-14.1 4.3-17.4 10.6z" />
    <path fill="#4CAF50" d="M24 45.5c5.5 0 10.4-1.9 14.2-5.1l-6.5-5.5c-2.1 1.5-4.8 2.4-7.7 2.4-5.4 0-9.9-3.1-11.4-7.7l-6.6 5.1C9.8 41.1 16.4 45.5 24 45.5z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.8-3.6 5.1l6.5 5.5C41.8 35.8 45.5 30.4 45.5 24c0-1.2-.1-2.4-.3-3.5z" />
  </svg>
);

export default function Login() {
  const { signUpWithEmail, signInWithEmail, resetPassword, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next) {
    setMode(next); setError(null); setSuccess(null);
  }

  async function handleGoogle() {
    setError(null); setSuccess(null); setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!email.trim()) { setError('Enter your email.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (password.length < 6) { setError('Password should be at least 6 characters.'); setBusy(false); return; }
        await signUpWithEmail(email.trim(), password, name.trim());
      } else if (mode === 'signin') {
        if (!password) { setError('Enter your password.'); setBusy(false); return; }
        await signInWithEmail(email.trim(), password);
      } else if (mode === 'reset') {
        await resetPassword(email.trim());
        setSuccess('Password reset email sent — check your inbox.');
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const heading = mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back';
  const subhead = mode === 'signup'
    ? `Start tailoring resumes in minutes. 10 free credits included.`
    : mode === 'reset'
      ? "Enter your email and we'll send you a reset link."
      : 'Log in to keep tailoring your resume.';

  return (
    <div className="login-shell">
      <div className="login-card">
        <Logo size={44} />
        <h1 style={{ textAlign: 'center', fontSize: 22, margin: '14px 0 6px' }}>{heading}</h1>
        <p>{subhead}</p>

        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        {mode !== 'reset' && (
          <>
            <button className="btn btn-google" style={{ width: '100%' }} disabled={busy} onClick={handleGoogle}>
              {GOOGLE_G} Continue with Google
            </button>
            <div className="auth-divider">or</div>
          </>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="field">
              <span className="field-label">Full name</span>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Alex Rivera" />
            </div>
          )}
          <div className="field">
            <span className="field-label">Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
          </div>
          {mode !== 'reset' && (
            <div className="field">
              <span className="field-label">Password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'} />
            </div>
          )}

          {mode === 'signin' && (
            <div className="auth-link" onClick={() => switchMode('reset')}>Forgot password?</div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account →' : mode === 'reset' ? 'Send reset link' : 'Log in →'}
          </button>
        </form>

        {mode === 'reset' ? (
          <p style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
            <span className="auth-link" style={{ display: 'inline', marginTop: 0 }} onClick={() => switchMode('signin')}>← Back to log in</span>
          </p>
        ) : mode === 'signup' ? (
          <p style={{ textAlign: 'center', marginBottom: 0 }}>Already have an account? <span className="auth-link" style={{ display: 'inline', marginTop: 0 }} onClick={() => switchMode('signin')}>Log in</span></p>
        ) : (
          <p style={{ textAlign: 'center', marginBottom: 0 }}>Don't have an account? <span className="auth-link" style={{ display: 'inline', marginTop: 0 }} onClick={() => switchMode('signup')}>Sign up</span></p>
        )}
      </div>
    </div>
  );
}
