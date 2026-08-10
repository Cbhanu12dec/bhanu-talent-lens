# ResumeCraftPro — JD-to-Resume Application Assembler

React + Firebase Auth (Google) + Firestore + Storage + Hosting. Claude calls
run through a Cloud Function so the **Anthropic API key never reaches the
browser**. Sending uses the **Gmail API** to create a real draft with the
tailored resume attached (not a `mailto:` link).

```
resumecraftpro-app/
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
firebase projects:create resumecraftpro-yourname
```

In the [Firebase console](https://console.firebase.google.com):

1. **Authentication → Sign-in method** → enable **Google** and **Email/Password**.
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

## 7. Set up Stripe (real payments for credits)

1. Create a [Stripe account](https://dashboard.stripe.com/register) if you
   don't have one. Everything below works in **test mode** first — use
   Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.
2. Dashboard → **Developers → API keys** → copy the **Secret key**:
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY
   ```
3. The webhook needs its own signing secret, but you don't have the
   webhook's URL until *after* the first deploy — so deploy functions once
   first with a placeholder:
   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET   # paste anything for now, e.g. "placeholder"
   firebase deploy --only functions
   ```
   This prints a URL for `stripeWebhook`, something like:
   `https://stripewebhook-xxxxxxxxxx-uc.a.run.app`
4. Dashboard → **Developers → Webhooks → Add endpoint** → paste that URL →
   select the event **`checkout.session.completed`** → save. Stripe shows
   you the real **Signing secret** (`whsec_...`) for that endpoint — set it
   for real now, overwriting the placeholder:
   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase deploy --only functions
   ```
5. (Optional, for local testing) Install the
   [Stripe CLI](https://stripe.com/docs/stripe-cli) and run
   `stripe listen --forward-to <your local/deployed webhook URL>` to see
   webhook events live while testing a purchase.
6. When you're ready for real charges, switch the dashboard from test to
   live mode, generate live API keys, and repeat steps 2–4 with those.

## 8. Set up the admin account and billing controls

1. Deploy functions first (needed before the admin account has anything to
   connect to): `firebase deploy --only functions`
2. Through your deployed app's own **Sign Up** screen, create an account
   with `cbhanu12dec@gmail.com` / `Srinivas@135`. This exact email is
   hardcoded in `functions/index.js` as `ADMIN_EMAILS` — signing up with it
   automatically grants admin access (checked server-side on every admin
   call, never trusted from the client).
3. Sign in with that account — an **Admin** link appears in the sidebar
   under Account. From there you can:
   - Toggle **Free mode** — tailoring costs 0 credits for every user,
     takes effect immediately, no redeploy
   - Set the credit cost per tailor (default 1) for when free mode is off
   - Create/disable **coupons** (percent or fixed-amount off a credit
     pack), with optional usage caps and expiry dates
4. To add more admins later, add their email to the `ADMIN_EMAILS` array in
   `functions/index.js` and redeploy.

Coupons are applied on the Billing page — enter a code, it's validated
server-side (real-time, before checkout) and shows the discounted price,
then re-validated again inside `createCheckoutSession` right before
Stripe is called (never trusting a client-computed discount for the
actual charge). Usage count only increments on confirmed payment via the
webhook — an abandoned checkout never counts against a coupon's limit.

## 9. Install & run locally

```bash
npm install
cd functions && npm install && cd ..
npm run dev
```

Optional local emulation of the functions before deploying:
```bash
firebase emulators:start --only functions,firestore,auth,storage
```

## 10. Deploy — end to end

```bash
npm run build
firebase deploy
```
Deploys Hosting, all four Cloud Functions (`claudeProxy`, `ensureAccount`,
`createCheckoutSession`, `stripeWebhook`), and Firestore/Storage rules.
Firebase prints your live URL (`https://YOUR_PROJECT_ID.web.app`).

Deploy pieces individually later with `firebase deploy --only hosting`,
`--only functions`, or `--only firestore:rules,storage:rules`.

## How each new piece works

- **Navigation**: Dashboard and Resume library are the two workspace tabs
  (Applications/Templates/Cover letters exist as components but are
  currently unlinked from the sidebar — re-add their `WORKSPACE_NAV`
  entries in `Sidebar.jsx` whenever they're ready), plus Billing, AI
  preferences, and Settings under Account — and an **Admin** link that
  only renders for the admin email, alongside a persistent topbar with a
  credit pill, notifications dropdown, and profile dropdown.
- **Admin & billing control**: sign-up with `cbhanu12dec@gmail.com` grants
  admin access, verified server-side by email on every admin call — the
  Firestore `role` field is display-only and never trusted for real
  authorization. Admins can flip a global **free-mode** toggle (0-credit
  tailoring for everyone, live immediately) and create **coupons**
  (percent/fixed discount, usage caps, expiry) from the Admin screen.
- **Coupons on checkout**: validated twice — once client-side for the
  discount preview (`validateCoupon`), and again inside
  `createCheckoutSession` right before Stripe is called, since a client
  could otherwise send any discount it wants. Usage count only increments
  via the webhook on confirmed payment, never on session creation.
- **Credits — now server-enforced, not just tracked**: `users/{uid}.credits`
  / `.creditsTotal` in Firestore are seeded by `ensureAccount` and can
  **only be written by Cloud Functions** (`firestore.rules` explicitly
  blocks the client from touching those two fields — see Security notes).
  Spending happens inside `claudeProxy`'s `tailor` task: it reserves 1
  credit in an atomic transaction *before* calling Anthropic, and refunds
  it if generation fails, so a failed tailor doesn't cost a credit and
  concurrent double-clicks can't double-spend.
- **Billing page — real Stripe Checkout**: "Buy" calls the
  `createCheckoutSession` function, which creates a Stripe Checkout Session
  server-side and redirects the browser to Stripe's hosted payment page.
  Card details never touch your servers. Credits are granted only by
  `stripeWebhook` after Stripe confirms `checkout.session.completed` —
  *not* on redirect back, which is why the Billing page polls for a few
  seconds after a successful checkout rather than crediting instantly. Each
  successful payment writes a real `billingHistory` record (amount,
  currency, credits, Stripe session id) — no fabricated payment method or
  invoice data.
- **Notifications**: generated from real actions in the current session
  (tailoring completed with its ATS score, credits running low, a resume
  added to the library) — held in React state, so they reset on reload
  rather than persisting to Firestore.

- **Login**: email/password (sign up, sign in, forgot-password) or Google —
  both create a Firebase Auth user with the same `uid`-scoped Firestore
  data model. If someone signs up with email/password and later hits
  **Send**, the app links a Google account to their *existing* uid to get
  Gmail permission (`linkWithPopup`), rather than signing them into a
  separate Google-identity account — this preserves their saved resumes
  instead of silently switching users underneath them.

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

## Troubleshooting: credits not increasing after payment

The webhook now logs every event it receives, unconditionally, so this is
diagnosable from Cloud Logging rather than guesswork:

```bash
firebase functions:log --only stripeWebhook
```

Filter for `jsonPayload.tag` in the Cloud Console logs explorer:

1. **Nothing at all logged for the payment you just made** — the webhook
   endpoint isn't registered in Stripe's dashboard (or is registered for
   the wrong mode — test vs. live have separate webhook configs), or the
   URL is wrong. Go to Stripe Dashboard → Developers → Webhooks, confirm
   an endpoint exists pointing at your deployed `stripeWebhook` URL, in
   the same mode (test/live) you're actually paying in.
2. **`stripe_webhook_signature_failed`** — `STRIPE_WEBHOOK_SECRET` doesn't
   match the endpoint Stripe actually sent the event from. Re-copy the
   signing secret from that specific endpoint in Stripe's dashboard and
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` again.
3. **`stripe_webhook_received` shows up, but `eventType` is never
   `checkout.session.completed`** — the endpoint in Stripe's dashboard
   isn't subscribed to that event. Edit the endpoint and add it.
4. **`stripe_webhook_missing_metadata`** — the Checkout Session was
   created without `uid`/`credits` in its metadata. This would point at a
   bug in `createCheckoutSession`, not the webhook — shouldn't happen with
   the current code, but the log will show exactly what metadata (if any)
   was present if it ever does.
5. **`stripe_webhook_credited` logged, but the user still doesn't see the
   new balance** — that's a client-side display issue, not a crediting
   issue. The Billing page's **"↻ Refresh balance"** button forces a fresh
   read and is the fastest fix; the automatic poll after redirect also
   gives up after ~20s and tells the user to use that button.

## Security notes

- `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`
  live only as Functions secrets — never in `.env` or any `VITE_*`
  variable.
- Firestore/Storage rules scope every read/write to `request.auth.uid`.
- **`credits` and `creditsTotal` are locked to server-only writes.**
  `firestore.rules` explicitly excludes those two field names from what
  `create`/`update` will accept from the client — the Admin SDK inside
  Cloud Functions bypasses rules entirely, so it's the only thing that can
  change a balance. Without this, any signed-in user could open devtools
  and write `credits: 999999` directly with the Firestore client SDK.
- `billingHistory` documents are read-only for their owner and
  unconditionally deny all client writes (`allow write: if false`) —
  only `stripeWebhook` (Admin SDK) creates them, so there's no way to
  fabricate a fake "paid" entry from the client.
- The Stripe webhook verifies every request's signature
  (`stripe.webhooks.constructEvent`) against `STRIPE_WEBHOOK_SECRET`
  before trusting anything in the payload — an unsigned or wrongly-signed
  POST to that URL is rejected with 400, so someone can't just call the
  webhook URL directly to grant themselves credits.
- Webhook processing is idempotent: it keys the `billingHistory` doc by
  Stripe's session id, so a retried/duplicate webhook delivery (which
  Stripe does by design) can't double-credit an account.
- The Gmail access token is held in memory only (React state) — it is not
  persisted to Firestore or localStorage, and is dropped on sign-out.
- All Cloud Functions reject any call without `request.auth` set.
