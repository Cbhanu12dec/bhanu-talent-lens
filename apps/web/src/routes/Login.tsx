import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores';
import { api } from '../lib/api';

export default function Login() {
  const [tab, setTab] = useState<'login'|'register'>('login');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const data = tab === 'login'
        ? await api.auth.login({ email: form.email, password: form.password })
        : await api.auth.register({ fullName: form.fullName, email: form.email, password: form.password });
      setAuth(data.accessToken, data.user);
      navigate('/dashboard');
    } catch (err: any) { setError(err.message || 'Something went wrong'); }
    setLoading(false);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark">TL</div>
          <div className="auth-logo-name">TalentLens</div>
        </div>
        <div className="auth-tabs">
          {(['login','register'] as const).map(t => (
            <button key={t} className={`auth-tab${tab===t?' active':''}`} onClick={() => setTab(t)}>
              {t === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
        {error && <div className="error-msg" style={{ marginBottom: 14 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {tab === 'register' && (
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input type="text" required value={form.fullName} onChange={e => setForm(p => ({...p, fullName: e.target.value}))} placeholder="Jane Smith" />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" required value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))} placeholder="you@company.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input type="password" required value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))} placeholder={tab === 'register' ? 'At least 8 characters' : '••••••••'} />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
