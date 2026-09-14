import React, { useMemo, useState } from 'react';
import { saveProfileInfo } from '../../lib/firestore.js';
import { Section, Row, Toggle, ToggleRow, SaveBar, Field } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

export const AI_DEFAULTS = {
  preferredLanguage: '',
  backendFocus: false,
  atsTarget: 92,
  leadershipEmphasis: false,
  technicalDepth: false
};

// Enforced unconditionally by the prompt in functions/index.js. Surfaced as
// locked rows rather than toggles, because offering a switch that cannot
// actually be turned off would be a lie about how the product works.
const GUARANTEES = [
  ['Preserve factual information', 'Employers, dates, titles and credentials are only ever reused from your own material.'],
  ['Never invent metrics', 'Numbers are only used where your source resume or career profile already supports them.'],
  ['Preserve official job titles', 'Your real title is always kept; a target-role framing may be added alongside it.'],
  ['Flag gaps instead of filling them', 'Unsupported requirements are reported back to you, never written in as experience.']
];

export default function AiSection({ uid, state }) {
  const { profileInfo, setProfileInfo } = state;
  const saved = useMemo(() => ({ ...AI_DEFAULTS, ...(profileInfo.aiPreferences || {}) }), [profileInfo]);
  const [draft, setDraft] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const keys = Object.keys(AI_DEFAULTS);
  const dirty = keys.some(k => draft[k] !== baseline[k]);
  if (!dirty && keys.some(k => baseline[k] !== saved[k])) {
    setBaseline(saved);
    setDraft(saved);
  }

  const set = patch => setDraft(d => ({ ...d, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await saveProfileInfo(uid, { aiPreferences: draft });
      setProfileInfo({ ...profileInfo, aiPreferences: draft });
      setBaseline(draft);
      toast({ kind: 'ok', title: 'AI preferences saved' });
    } catch (err) {
      toast({ kind: 'bad', title: 'Could not save', detail: err.message });
    }
    setSaving(false);
  }

  return (
    <>
      <Section
        title="Writing emphasis"
        description="Applied to every tailoring run, on top of any per-resume instructions in your library."
      >
        <ToggleRow
          title="Emphasise leadership"
          description="Favour scope, ownership and stakeholder impact over individual contribution."
          checked={draft.leadershipEmphasis}
          onChange={v => set({ leadershipEmphasis: v })}
        />
        <ToggleRow
          title="Emphasise technical depth"
          description="Favour architecture, implementation detail and technical decision-making."
          checked={draft.technicalDepth}
          onChange={v => set({ technicalDepth: v })}
        />
        <ToggleRow
          title="Backend-leaning framing"
          description="When work spans frontend and backend, lead with the backend side."
          checked={draft.backendFocus}
          onChange={v => set({ backendFocus: v })}
        />
      </Section>

      <Section title="Defaults" description="Starting values for each new tailoring run. You can still override them per run.">
        <div className="fgrid">
          <Field
            label="Preferred language or stack"
            hint="Optional. Used when your experience spans several stacks."
          >
            <input
              type="text" value={draft.preferredLanguage}
              onChange={e => set({ preferredLanguage: e.target.value })}
              placeholder="e.g. Java, Go"
            />
          </Field>
          <Field
            label={`Target ATS score — ${draft.atsTarget}%`}
            hint="The agent re-runs a repair pass until the measured score clears this bar."
          >
            <input
              type="range" min="60" max="100" value={draft.atsTarget}
              onChange={e => set({ atsTarget: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Content guarantees"
        description="These rules are enforced on the server for every run and cannot be turned off."
      >
        {GUARANTEES.map(([title, desc]) => (
          <Row
            key={title}
            title={title}
            description={desc}
            control={
              <span className="locked-toggle">
                <Toggle checked disabled label={title} lockedReason="Always enforced" />
                <span className="locked-note">Always on</span>
              </span>
            }
          />
        ))}
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(baseline)} />
    </>
  );
}
