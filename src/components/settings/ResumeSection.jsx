import React, { useMemo, useState } from 'react';
import { saveProfileInfo } from '../../lib/firestore.js';
import { Section, Row, ChoiceGroup, SaveBar, Toggle } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

export const RESUME_DEFAULTS = { pageSize: 'letter' };

const PAGE_PREVIEW = ratio => (
  <span className="page-prev" style={{ aspectRatio: ratio }} aria-hidden="true">
    <span /><span /><span />
  </span>
);

export default function ResumeSection({ uid, state }) {
  const { profileInfo, setProfileInfo } = state;
  const saved = useMemo(
    () => ({ ...RESUME_DEFAULTS, ...(profileInfo.resumePreferences || {}) }),
    [profileInfo]
  );
  const [draft, setDraft] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const keys = Object.keys(RESUME_DEFAULTS);
  const dirty = keys.some(k => draft[k] !== baseline[k]);
  if (!dirty && keys.some(k => baseline[k] !== saved[k])) {
    setBaseline(saved);
    setDraft(saved);
  }

  async function save() {
    setSaving(true);
    try {
      await saveProfileInfo(uid, { resumePreferences: draft });
      setProfileInfo({ ...profileInfo, resumePreferences: draft });
      setBaseline(draft);
      toast({ kind: 'ok', title: 'Resume preferences saved' });
    } catch (err) {
      toast({ kind: 'bad', title: 'Could not save', detail: err.message });
    }
    setSaving(false);
  }

  return (
    <>
      <Section
        title="Page size"
        description="Applied to every PDF and Word document you download."
      >
        <ChoiceGroup
          columns={2}
          value={draft.pageSize}
          onChange={v => setDraft(d => ({ ...d, pageSize: v }))}
          options={[
            { value: 'letter', label: 'US Letter', description: '8.5 × 11 in — standard in the US and Canada', preview: PAGE_PREVIEW('8.5 / 11') },
            { value: 'a4', label: 'A4', description: '210 × 297 mm — standard almost everywhere else', preview: PAGE_PREVIEW('210 / 297') }
          ]}
        />
      </Section>

      <Section
        title="Formatting rules"
        description="Applied automatically to every export so the file survives resume parsers. These are not optional."
      >
        {[
          ['ATS-safe layout', 'Single column, no tables, text boxes or graphics that parsers drop.'],
          ['Standard section headings', 'Professional Summary, Technical Skills, Professional Experience, Education.'],
          ['Selectable text', 'Never rasterised, so a parser can always read the content.'],
          ['Half-inch margins', 'Wide enough for parsers, tight enough to use the page.']
        ].map(([title, desc]) => (
          <Row
            key={title} title={title} description={desc}
            control={
              <span className="locked-toggle">
                <Toggle checked disabled label={title} lockedReason="Always applied" />
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
