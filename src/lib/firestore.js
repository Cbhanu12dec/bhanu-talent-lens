import {
  collection, doc, setDoc, deleteDoc, getDocs, getDoc,
  query, orderBy, serverTimestamp, writeBatch, arrayUnion, arrayRemove, where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase.js';

// ---- Profile info (users/{uid}) ----
// `sendingEmail` is the address used as From/Reply-to on generated drafts.
// `credits` / `creditsTotal` are seeded and modified ONLY server-side (see
// functions/index.js: ensureAccount, claudeProxy, stripeWebhook) — this
// file has no write path for them, and firestore.rules blocks it too.
export async function saveProfileInfo(uid, info) {
  await setDoc(doc(db, 'users', uid), info, { merge: true });
}
export async function getProfileInfo(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : {};
}

export async function listBillingHistory(uid) {
  const q = query(collection(db, 'users', uid, 'billingHistory'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- Resumes (users/{uid}/resumes/{id}) ----
export async function saveResume(uid, { label, text, fileUrl = null, fileName = null, prompts = [], atsTarget = 92 }) {
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

// ============================================================
// CAREER PROFILE  (users/{uid}/careerProfile/{profileId} — one doc per profile)
// A user can have multiple profiles (e.g. "Primary", "Early-Career").
// `main` is the legacy/default doc id so existing single-profile accounts
// keep working without any migration.
// ============================================================

export async function listCareerProfiles(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'careerProfile'));
  if (snap.empty) return [{ id: 'main', name: 'Primary Profile', isDefault: true, experience: [], education: [], skills: [] }];
  const profiles = snap.docs.map(d => ({ id: d.id, name: 'Untitled Profile', isDefault: false, experience: [], education: [], skills: [], ...d.data() }));
  if (!profiles.some(p => p.isDefault)) profiles[0].isDefault = true;
  return profiles;
}

export async function createCareerProfile(uid, name) {
  const id = 'profile_' + Date.now();
  const record = { name, isDefault: false, experience: [], education: [], skills: [], createdAt: serverTimestamp() };
  await setDoc(doc(db, 'users', uid, 'careerProfile', id), record);
  return { id, name, isDefault: false, experience: [], education: [], skills: [] };
}

export async function renameCareerProfile(uid, profileId, name) {
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { name }, { merge: true });
}

export async function deleteCareerProfileDoc(uid, profileId) {
  await deleteDoc(doc(db, 'users', uid, 'careerProfile', profileId));
}

export async function setDefaultCareerProfile(uid, profileId) {
  const profiles = await listCareerProfiles(uid);
  const batch = writeBatch(db);
  profiles.forEach(p => {
    batch.set(doc(db, 'users', uid, 'careerProfile', p.id), { isDefault: p.id === profileId }, { merge: true });
  });
  await batch.commit();
}

export async function getCareerProfile(uid, profileId = 'main') {
  const snap = await getDoc(doc(db, 'users', uid, 'careerProfile', profileId));
  return snap.exists() ? { id: profileId, ...snap.data() } : { id: profileId, experience: [], education: [], skills: [] };
}

export async function addExperience(uid, entry, profileId = 'main') {
  const id = 'exp_' + Date.now();
  const item = { id, ...entry, sortOrder: Date.now() };
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { experience: arrayUnion(item) }, { merge: true });
  return item;
}

export async function updateExperience(uid, id, patch, profileId = 'main') {
  const profile = await getCareerProfile(uid, profileId);
  const updated = (profile.experience || []).map(e => e.id === id ? { ...e, ...patch } : e);
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { experience: updated }, { merge: true });
}

export async function deleteExperience(uid, id, profileId = 'main') {
  const profile = await getCareerProfile(uid, profileId);
  const filtered = (profile.experience || []).filter(e => e.id !== id);
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { experience: filtered }, { merge: true });
}

export async function addEducation(uid, entry, profileId = 'main') {
  const id = 'edu_' + Date.now();
  const item = { id, ...entry };
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { education: arrayUnion(item) }, { merge: true });
  return item;
}

export async function deleteEducation(uid, id, profileId = 'main') {
  const profile = await getCareerProfile(uid, profileId);
  const filtered = (profile.education || []).filter(e => e.id !== id);
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { education: filtered }, { merge: true });
}

export async function addSkill(uid, label, profileId = 'main') {
  const id = 'sk_' + Date.now();
  const item = { id, label };
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { skills: arrayUnion(item) }, { merge: true });
  return item;
}

export async function deleteSkill(uid, id, profileId = 'main') {
  const profile = await getCareerProfile(uid, profileId);
  const filtered = (profile.skills || []).filter(s => s.id !== id);
  await setDoc(doc(db, 'users', uid, 'careerProfile', profileId), { skills: filtered }, { merge: true });
}

// ============================================================
// DOMAINS  (domains/{domainId})
// User role sees name + summary only — the query only selects those fields.
// Admin role loads the full document including categories/skills/strongPoints.
// ============================================================

export async function listDomainsPublic() {
  const q = query(collection(db, 'domains'), where('status', '==', 'published'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, name: d.data().name, summary: d.data().summary }));
}

export async function listDomainsAdmin() {
  const snap = await getDocs(collection(db, 'domains'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveDomain(data, id = null) {
  const ref = id ? doc(db, 'domains', id) : doc(collection(db, 'domains'));
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return { id: ref.id, ...data };
}

export async function deleteDomain(id) {
  await deleteDoc(doc(db, 'domains', id));
}

// ============================================================
// CUSTOM DOMAINS  (users/{uid}/customDomains/{id})
// Self-serve domains a user creates from the workspace. Deliberately kept
// out of the global `domains` collection so a user can never read, edit, or
// delete another user's domain, nor mutate the admin-curated published set.
// ============================================================

export async function listCustomDomains(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'customDomains'));
  return snap.docs.map(d => ({ id: d.id, ...d.data(), isCustom: true }));
}

export async function createCustomDomain(uid, { name, parentDomainId = null, parentDomainName = '', keywords = [] }) {
  const ref = doc(collection(db, 'users', uid, 'customDomains'));
  const data = {
    name: name.trim(),
    summary: parentDomainName ? `Custom domain under ${parentDomainName}` : 'Custom domain',
    parentDomainId, parentDomainName,
    keywords: [...new Set(keywords.map(k => k.trim()).filter(Boolean))],
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return { id: ref.id, ...data, isCustom: true };
}

export async function deleteCustomDomain(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'customDomains', id));
}

// ============================================================
// JOB DESCRIPTIONS  (users/{uid}/jobDescriptions/{id})
// ============================================================

export async function createJobDescription(uid, rawText) {
  const id = 'jd_' + Date.now();
  const data = { id, rawText, createdAt: serverTimestamp(), parsed: false };
  await setDoc(doc(db, 'users', uid, 'jobDescriptions', id), data);
  return data;
}

export async function getJobDescription(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'jobDescriptions', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listJobDescriptions(uid) {
  const q = query(collection(db, 'users', uid, 'jobDescriptions'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// AGENT RUNS  (users/{uid}/agentRuns/{runId})
// ============================================================

export async function createAgentRun(uid, { careerProfileSnapshot, domainId, jobDescriptionId }) {
  const id = 'run_' + Date.now();
  const data = {
    id, careerProfileSnapshot, domainId, jobDescriptionId,
    currentStep: 'setup', status: 'in_progress',
    strategySnapshot: null, buildLog: [],
    startedAt: serverTimestamp(), completedAt: null,
  };
  await setDoc(doc(db, 'users', uid, 'agentRuns', id), data);
  return data;
}

export async function getAgentRun(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'agentRuns', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateAgentRun(uid, id, patch) {
  await setDoc(doc(db, 'users', uid, 'agentRuns', id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

export async function listAgentRuns(uid) {
  const q = query(collection(db, 'users', uid, 'agentRuns'), orderBy('startedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// RESUME VERSIONS  (users/{uid}/resumeVersions/{versionId})
// Versions are immutable once created — edits always create a new version.
// ============================================================

export async function saveResumeVersion(uid, { agentRunId, versionNumber, label, content, matchScore, scoreBreakdown, changes, flags, requirementMatches }) {
  const id = 'rv_' + Date.now();
  const data = {
    id, agentRunId, versionNumber, label, content, matchScore: matchScore || null,
    scoreBreakdown: scoreBreakdown || null, changes: changes || [],
    flags: flags || [], requirementMatches: requirementMatches || [],
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'users', uid, 'resumeVersions', id), data);
  return data;
}

export async function getResumeVersion(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'resumeVersions', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listResumeVersions(uid) {
  const q = query(collection(db, 'users', uid, 'resumeVersions'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateResumeVersionChanges(uid, id, changes) {
  await setDoc(doc(db, 'users', uid, 'resumeVersions', id), { changes }, { merge: true });
}

export async function updateQualityFlag(uid, versionId, flagId, patch) {
  const version = await getResumeVersion(uid, versionId);
  if (!version) return;
  const flags = (version.flags || []).map(f => f.id === flagId ? { ...f, ...patch } : f);
  await setDoc(doc(db, 'users', uid, 'resumeVersions', versionId), { flags }, { merge: true });
}
