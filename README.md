# TalentLens — JD-to-Resume Application Assembler

React + Firebase Auth (Google) + Firestore + Storage + Hosting. Claude calls
run through a Cloud Function so the **Anthropic API key never reaches the
browser**. Sending uses the **Gmail API** to create a real draft with the
tailored resume attached (not a `mailto:` link).

```
talentlens-app/
├── src/
│   ├── components/
│   │   ├── Login.jsx
│   │   ├── Sidebar.jsx
│   │   ├── ProfileView.jsx      Basic info + sending email, resume library,
│   │   │                        tailoring prompts, ATS target
│   │   └── DashboardView.jsx    JD input (text/image), inline tailored
│   │                            preview + ATS badge, PDF/DOCX export,
│   │                            Gmail draft with attachment
│   ├── contexts/AuthContext.jsx  Google sign-in + Gmail OAuth token
│   ├── lib/
│   │   ├── claude.js             calls the Cloud Function
│   │   ├── firestore.js          profile / resumes CRUD
│   │   ├── pdf.js                jsPDF export
│   │   ├── docx.js               docx export
│   │   └── gmail.js              builds MIME message, creates Gmail draft
│   ├── firebase.js
│   └── styles.css
├── functions/index.js            claudeProxy Cloud Function (holds the key)
├── firebase.json / firestore.rules / storage.rules
└── .env.example
```

## 1. Prerequisites

- Node.js 20+, `npm install -g firebase-tools`
- A Google account, and a Google Cloud project (Firebase creates one for you)

## 2. Create the Firebase project

```bash
firebase login
firebase projects:create talentlens-app-yourname
```

In the [Firebase console](https://console.firebase.google.com):

1. **Authentication → Sign-in method** → enable **Google**.
2. **Firestore Database** → Create database (production mode).
3. **Storage** → Get started (default bucket).
4. **Project settings → General → Your apps** → add a **Web app** → copy
   the config into `.env` (step 4).
5. Upgrade to the **Blaze plan** — required for Cloud Functions to call
   external APIs (Anthropic). Has a solid free tier.

## 3. Enable the Gmail API and configure OAuth consent

This is the part that makes "Send" actually create a Gmail draft.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → select
   the same project Firebase created for you.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External (or Internal if you're on Google Workspace).
   - Add the scope `https://www.googleapis.com/auth/gmail.compose`.
   - Under **Test users**, add the Google account(s) you'll sign in with
     while developing — required because `gmail.compose` is a sensitive
     scope Google won't allow for unverified apps outside test users.
   - (Only if you plan to launch this publicly: Google requires an app
     verification review before `gmail.compose` works for arbitrary users,
     not just test users. Fine to skip for personal/internal use.)

## 4. Point the project at your Firebase project

Edit `.firebaserc`, replace `YOUR_FIREBASE_PROJECT_ID` with your real project ID.

## 5. Configure environment variables

```bash
cp .env.example .env
```
Fill in the six `VITE_FIREBASE_*` values (public client config, safe to ship).

## 6. Set the Anthropic API key (server-side secret)

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```
Read only inside `functions/index.js` via `defineSecret`; never bundled
into the frontend.

## 7. Install & run locally

```bash
npm install
cd functions && npm install && cd ..
npm run dev
```

Optional local emulation of the function before deploying:
```bash
firebase emulators:start --only functions,firestore,auth,storage
```

## 8. Deploy — end to end

```bash
npm run build
firebase deploy
```
Deploys Hosting, the `claudeProxy` function, and Firestore/Storage rules.
Firebase prints your live URL (`https://YOUR_PROJECT_ID.web.app`).

Deploy pieces individually later with `firebase deploy --only hosting`,
`--only functions`, or `--only firestore:rules,storage:rules`.

## How each new piece works

- **Sending email (profile)**: `profileInfo.sendingEmail` is stored in
  Firestore and shown read-only as "From" on the Dashboard. It should match
  the Google account you signed in with, since Gmail drafts are created
  under that account.
- **Resume upload/paste**: unchanged from before — `.docx`/`.txt`/`.md`
  auto-extracted client-side via `mammoth`; anything else falls back to
  manual paste. Multiple resumes persist per user in Firestore.
- **Tailoring prompts**: an array of free-text instructions stored on each
  resume (`resumes/{id}.prompts`), sent to Claude every time that resume
  is tailored, so wording preferences stick across applications.
- **ATS target**: a per-resume number (`resumes/{id}.atsTarget`, default
  90) also sent to Claude as the score it should aim to hit. The Dashboard
  preview shows the *achieved* score Claude reports back for that specific
  tailored draft — an estimate, not a guarantee against any real ATS.
- **JD intake**: paste text, or upload a screenshot — the image is sent to
  Claude via the same Cloud Function for transcription (OCR-by-vision).
- **Download PDF/DOCX**: generated fully client-side (`jspdf`, `docx`) from
  the tailored resume text — no server round-trip.
- **Send**: `ensureGmailToken()` gets a Gmail-scoped OAuth token (silently
  reusing the one from sign-in, or re-prompting if it's missing/expired),
  then `gmail.js` builds a MIME multipart message with the resume PDF as a
  base64 attachment and POSTs it to `users/me/drafts` — a real draft lands
  in the signed-in user's Gmail account for them to review and send.

## Security notes

- `ANTHROPIC_API_KEY` lives only as a Functions secret — never in `.env`
  or any `VITE_*` variable.
- Firestore/Storage rules scope every read/write to `request.auth.uid`.
- The Gmail access token is held in memory only (React state) — it is not
  persisted to Firestore or localStorage, and is dropped on sign-out.
- The Cloud Function rejects any call without `request.auth` set.
