import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  return (
    <div className="login-shell">
      <div className="brand">
        <div className="brand-mark"></div>
        <div className="brand-text">TalentLens<small>APPLICATION ASSEMBLY</small></div>
      </div>
      <div className="login-card">
        <p>Sign in to save your resumes and tailored applications. We'll also ask for Gmail permission so "Send" can create a draft with your resume attached.</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={login}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
