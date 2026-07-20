import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

const callClaudeProxy = httpsCallable(functions, 'claudeProxy');

async function proxy(task, payload) {
  const res = await callClaudeProxy({ task, payload });
  if (!res || !res.data) {
    throw new Error(`No response from claudeProxy for task "${task}".`);
  }
  return res.data;
}

export async function analyzeJD({ jdText, resumeText }) {
  const { json } = await proxy('analyze', { jdText, resumeText });
  return json; // { matched, gaps, summary, atsScore }
}

export async function tailorResume({ jdText, resumeText, gaps, prompts, atsTarget }) {
  try {
    const { json, creditsRemaining } = await proxy('tailor', { jdText, resumeText, gaps, prompts, atsTarget });
    if (!json || !json.resume || !json.resume.name || !Array.isArray(json.resume.sections)) {
      throw new Error('Tailoring response was missing resume data — the deployed Cloud Function may be out of date. Try "firebase deploy --only functions".');
    }
    return { ...json, creditsRemaining }; // { resume, atsScore, creditsRemaining }
  } catch (err) {
    if (err?.code === 'functions/resource-exhausted') {
      const outOfCreditsErr = new Error('Out of credits.');
      outOfCreditsErr.code = 'OUT_OF_CREDITS';
      throw outOfCreditsErr;
    }
    throw err;
  }
}

export async function draftEmail({ jdText, resumeText, company, contactName, senderName }) {
  const { json } = await proxy('email', { jdText, resumeText, company, contactName, senderName });
  if (!json || typeof json.subject !== 'string') {
    throw new Error('Email draft response was malformed — the deployed Cloud Function may be out of date. Try "firebase deploy --only functions".');
  }
  return json; // { subject, body }
}

export async function ocrImage({ base64, mediaType }) {
  const { text } = await proxy('ocr', { base64, mediaType });
  return text;
}
