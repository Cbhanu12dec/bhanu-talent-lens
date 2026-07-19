import {
  collection, doc, setDoc, deleteDoc, getDocs, getDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase.js';

// ---- Profile info (users/{uid}) ----
// `sendingEmail` is the address used as From/Reply-to on generated drafts.
export async function saveProfileInfo(uid, info) {
  await setDoc(doc(db, 'users', uid), info, { merge: true });
}
export async function getProfileInfo(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : {};
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
