import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Google OAuth access token — used only for Gmail API draft creation.
  // Firebase does not persist this across reloads, so it's re-requested
  // (silently via popup) whenever a Gmail call needs it and it's missing.
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function login() {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) setAccessToken(credential.accessToken);
    return result;
  }

  // Call this before a Gmail API request if accessToken is null/expired.
  async function ensureGmailToken() {
    if (accessToken) return accessToken;
    return refreshGmailToken();
  }

  // Forces a brand-new sign-in popup (ignoring any cached token), used when
  // Gmail rejects a request with "insufficient authentication scopes" —
  // usually because the cached token predates the gmail.compose scope.
  async function refreshGmailToken() {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    setAccessToken(credential?.accessToken || null);
    return credential?.accessToken || null;
  }

  const logout = () => { setAccessToken(null); return signOut(auth); };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, accessToken, ensureGmailToken, refreshGmailToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
