import React, { useMemo, useState } from 'react';
import { saveProfileInfo } from '../../lib/firestore.js';
import { Section, Row, Toggle, ToggleRow, SaveBar } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

// Only categories the app actually raises and actually gates. Adding a switch
// here without a matching check in notify() would make it decorative.
export const NOTIFY_DEFAULTS = { tailoring: true, billing: true };

export default function NotificationsSection({ uid, state }) {
  const { profileInfo, setProfileInfo } = state;
  const saved = useMemo(
    () => ({ ...NOTIFY_DEFAULTS, ...(profileInfo.notifications || {}) }),
    [profileInfo]
  );
  const [draft, setDraft] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const keys = Object.keys(NOTIFY_DEFAULTS);
  const dirty = keys.some(k => draft[k] !== baseline[k]);
  if (!dirty && keys.some(k => baseline[k] !== saved[k])) {
    setBaseline(saved);
    setDraft(saved);
  }

  async function save() {
    setSaving(true);
    try {
      await saveProfileInfo(uid, { notifications: draft });
      setProfileInfo({ ...profileInfo, notifications: draft });
      setBaseline(draft);
      toast({ kind: 'ok', title: 'Notification preferences saved' });
    } catch (err) {
      toast({ kind: 'bad', title: 'Could not save', detail: err.message });
    }
    setSaving(false);
  }

  return (
    <>
      <Section
        title="In-app notifications"
        description="Shown in the bell menu in the top bar. ResumeCraft Pro does not send marketing email."
      >
        <ToggleRow
          title="Resume tailoring"
          description="When a tailoring run finishes, or fails part way through."
          checked={draft.tailoring}
          onChange={v => setDraft(d => ({ ...d, tailoring: v }))}
        />
        <ToggleRow
          title="Billing and credits"
          description="Credit purchases confirmed by Stripe, and low balance warnings."
          checked={draft.billing}
          onChange={v => setDraft(d => ({ ...d, billing: v }))}
        />
        <Row
          title="Security alerts"
          description="Sign-in and password changes. These cannot be turned off, because losing them would put your account at risk."
          control={
            <span className="locked-toggle">
              <Toggle checked disabled label="Security alerts" lockedReason="Required for account safety" />
              <span className="locked-note">Always on</span>
            </span>
          }
        />
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(baseline)} />
    </>
  );
}
