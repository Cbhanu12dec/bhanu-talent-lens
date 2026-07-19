import {
  collection, doc, setDoc, deleteDoc, getDocs, getDoc,
  query, orderBy, serverTimestamp, runTransaction
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase.js';

const STARTER_CREDITS = 10;

// ---- Profile info (users/{uid}) ----
// `sendingEmail` is the address used as From/Reply-to on generated drafts.
// `credits` / `creditsTotal` back the demo credit system (see BillingView) —
// this is client/Firestore-tracked only, not enforced server-side. A
// determined user could bypass it by calling the Cloud Function directly;
// treat it as usage metering/UX, not a real paywall, unless you add
// server-side enforcement in functions/index.js later.
export async function saveProfileInfo(uid, info) {
  await setDoc(doc(db, 'users', uid), info, { merge: true });
}
export async function getProfileInfo(uid) {
  const ref_ = doc(db, 'users', uid);
  const snap = await getDoc(ref_);
  if (snap.exists() && snap.data().credits !== undefined) return snap.data();
  // First time we see this user — seed starter credits.
  const seeded = { ...(snap.exists() ? snap.data() : {}), credits: STARTER_CREDITS, creditsTotal: STARTER_CREDITS };
  await setDoc(ref_, { credits: STARTER_CREDITS, creditsTotal: STARTER_CREDITS }, { merge: true });
  return seeded;
}

export async function spendCredit(uid) {
  const ref_ = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref_);
    const current = snap.exists() ? (snap.data().credits ?? STARTER_CREDITS) : STARTER_CREDITS;
    if (current <= 0) throw new Error('OUT_OF_CREDITS');
    tx.set(ref_, { credits: current - 1 }, { merge: true });
    return current - 1;
  });
}

export async function addCredits(uid, amount) {
  const ref_ = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref_);
    const data = snap.exists() ? snap.data() : {};
    const current = data.credits ?? STARTER_CREDITS;
    const total = data.creditsTotal ?? STARTER_CREDITS;
    const newCredits = current + amount;
    const newTotal = Math.max(total, newCredits);
    tx.set(ref_, { credits: newCredits, creditsTotal: newTotal }, { merge: true });
    return { credits: newCredits, creditsTotal: newTotal };
  });
}

// ---- Resumes (users/{uid}/resumes/{id}) ----
export async function saveResume(uid, { label, text, fileUrl = null, fileName = null, prompts = [], atsTarget = 90 }) {
  const id = 'r_' + Date.now();
  const record = { id, label, text, fileUrl, fileName, prompts, atsTarget, createdAt: new Date() };
  await setDoc(doc(db, 'users', uid, 'resumes', id), {
    label, text, fileUrl, fileName, prompts, atsTarget, createdAt: serverTimestamp()
  });
  return record;
}
export async function listResumes(uid) {
  const q = query(collection(db, 'users', uid, 'resumes'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function deleteResume(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'resumes', id));
}
export async function updateResumeText(uid, id, text) {
  await setDoc(doc(db, 'users', uid, 'resumes', id), { text }, { merge: true });
}
export async function updateResumePrompts(uid, id, prompts) {
  await setDoc(doc(db, 'users', uid, 'resumes', id), { prompts }, { merge: true });
}
export async function updateResumeAtsTarget(uid, id, atsTarget) {
  await setDoc(doc(db, 'users', uid, 'resumes', id), { atsTarget }, { merge: true });
}

export async function uploadResumeFile(uid, file) {
  const path = `users/${uid}/resumes/${Date.now()}_${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, path };
}
