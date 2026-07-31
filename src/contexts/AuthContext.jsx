import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, linkWithPopup,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';

const AuthContext = createContext(null);

function friendlyAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'An account already exists with this email. Try signing in instead.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Sign-in window was closed before finishing.',
    'auth/credential-already-in-use': 'That Google account is already linked to a different TalentLens account.'
  };
  return map[err?.code] || err?.message || 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Google OAuth access token — used only for Gmail API draft creation.
  // Not persisted across reloads; re-requested on demand via ensureGmailToken.
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signUpWithEmail(email, password, displayName) {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(result.user, { displayName });
      return result;
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  async function signInWithEmail(email, password) {
    try {
      return await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  async function resetPassword(email) {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  async function loginWithGoogle() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) setAccessToken(credential.accessToken);
      return result;
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  // Gets a Gmail-scoped access token for the CURRENT account, without ever
  // switching which account is signed in:
  // - If Google is already a linked provider, re-run Google sign-in (same
  //   identity, same uid) to refresh the token.
  // - If the account is email/password only, LINK Google to it instead of
  //   signing in fresh — linking preserves the existing uid (and therefore
  //   all of that user's Firestore data), whereas a plain signInWithPopup
  //   would silently switch to a different Google-identity account.
  async function ensureGmailToken() {
    if (accessToken) return accessToken;
    const current = auth.currentUser;
    const alreadyLinked = current?.providerData?.some(p => p.providerId === 'google.com');
    try {
      const result = alreadyLinked
        ? await signInWithPopup(auth, googleProvider)
        : await linkWithPopup(current, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      setAccessToken(credential?.accessToken || null);
      return credential?.accessToken || null;
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  const logout = () => { setAccessToken(null); return signOut(auth); };

  const hasPasswordProvider = !!user?.providerData?.some(p => p.providerId === 'password');

  async function changePassword(currentPassword, newPassword) {
    if (!auth.currentUser) throw new Error('Not signed in.');
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPassword);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  }

  return (
    <AuthContext.Provider value={{
      user, loading, accessToken, hasPasswordProvider,
      signUpWithEmail, signInWithEmail, resetPassword, loginWithGoogle,
      ensureGmailToken, logout, changePassword
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
