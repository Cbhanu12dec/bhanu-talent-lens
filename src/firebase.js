import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// These VITE_FIREBASE_* values are the public web-app config from
// Firebase console → Project settings → General → Your apps.
// They are safe to ship to the client — they are not secrets.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Extra scope so we can create Gmail drafts (with the resume attached) on
// the user's behalf. Google will show this as an additional consent line
// the first time someone signs in.
googleProvider.addScope('https://www.googleapis.com/auth/gmail.compose');
// Always show the consent screen (rather than silently reusing a cached
// session). Without this, a user who signed in before this scope existed
// keeps getting a token that never had Gmail consent, and every Gmail API
// call fails with "insufficient authentication scopes" until they clear
// their session manually.
googleProvider.setCustomParameters({ prompt: 'consent' });
export const db = getFirestore(app);
export const storage = getStorage(app);
// Region should match the region you deploy functions to (see functions/index.js)
export const functions = getFunctions(app, 'us-central1');
