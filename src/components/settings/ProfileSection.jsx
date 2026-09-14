import React, { useMemo, useState } from 'react';
import { saveProfileInfo } from '../../lib/firestore.js';
import { Section, Field, SaveBar, Row } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

const FIELDS = ['name', 'title', 'sendingEmail', 'phone', 'location', 'link', 'portfolio'];
const pick = src => Object.fromEntries(FIELDS.map(k => [k, src?.[k] || '']));

export default function ProfileSection({ uid, state, user }) {
  const { profileInfo, setProfileInfo } = state;
  const saved = useMemo(() => pick(profileInfo), [profileInfo]);
  const [draft, setDraft] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const toast = useToast();

  // Adopt server state when it arrives, but never clobber in-progress edits.
  const dirty = FIELDS.some(k => draft[k] !== baseline[k]);
  if (!dirty && FIELDS.some(k => baseline[k] !== saved[k])) {
    setBaseline(saved);
    setDraft(saved);
  }

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  function validate() {
    const next = {};
    if (draft.sendingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.sendingEmail)) {
      next.sendingEmail = 'Enter a valid email address.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      await saveProfileInfo(uid, draft);
      setProfileInfo({ ...profileInfo, ...draft });
      setBaseline(draft);
      toast({ kind: 'ok', title: 'Changes saved' });
    } catch (err) {
      console.error(err);
      toast({ kind: 'bad', title: 'Could not save', detail: err.message });
    }
    setSaving(false);
  }

  const initials = (draft.name || user?.email || '?').trim().slice(0, 1).toUpperCase();

  return (
    <>
      <Section title="Profile photo" description="Your avatar comes from the Google account you signed in with.">
        <Row
          title={draft.name || user?.displayName || 'Your account'}
          description={user?.email}
          control={
            user?.photoURL
              ? <img className="avatar-lg" src={user.photoURL} alt="" width="48" height="48" />
              : <span className="avatar-lg avatar-lg--initial" aria-hidden="true">{initials}</span>
          }
        />
      </Section>

      <Section title="Personal information" description="Used to populate contact details on the resumes you generate.">
        <div className="fgrid">
          <Field label="Full name" error={errors.name}>
            <input type="text" value={draft.name} onChange={e => set('name', e.target.value)} placeholder="Alex Rivera" />
          </Field>
          <Field label="Professional title">
            <input type="text" value={draft.title} onChange={e => set('title', e.target.value)} placeholder="Senior Data Engineer" />
          </Field>
          <Field
            label="Sending email" error={errors.sendingEmail}
            hint="Used as the From/Reply-to on Gmail drafts, so it must match the Google account you signed in with."
          >
            <input type="email" value={draft.sendingEmail} onChange={e => set('sendingEmail', e.target.value)} placeholder="alex@rivera.dev" />
          </Field>
          <Field label="Phone">
            <input type="tel" value={draft.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 555 010 1234" />
          </Field>
          <Field label="Location">
            <input type="text" value={draft.location} onChange={e => set('location', e.target.value)} placeholder="Dallas, TX" />
          </Field>
          <Field label="LinkedIn">
            <input type="text" value={draft.link} onChange={e => set('link', e.target.value)} placeholder="linkedin.com/in/alexrivera" />
          </Field>
          <Field label="Portfolio or website" wide>
            <input type="text" value={draft.portfolio} onChange={e => set('portfolio', e.target.value)} placeholder="alexrivera.dev" />
          </Field>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setDraft(baseline); setErrors({}); }} />
    </>
  );
}
