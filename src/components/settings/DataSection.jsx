import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Section, Row, ConfirmModal, DetailRow } from '../ui/Primitives.jsx';
import { useToast } from '../ui/Toast.jsx';

const exportUserDataFn = httpsCallable(functions, 'exportUserData');
const deleteAccountFn = httpsCallable(functions, 'deleteAccount');

export default function DataSection({ user }) {
  const { logout } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState(null);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await exportUserDataFn();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resumecraftpro-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const counts = res.data?.counts || {};
      toast({
        kind: 'ok',
        title: 'Export downloaded',
        detail: `${counts.resumes ?? 0} resumes, ${counts.agentRuns ?? 0} tailoring runs, ${counts.billingHistory ?? 0} purchases.`
      });
    } catch (err) {
      console.error(err);
      toast({ kind: 'bad', title: 'Export failed', detail: err.message });
    }
    setExporting(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteAccountFn();
      // The server deletes the auth user, so this session is already invalid;
      // sign out locally to clear cached state and return to the login screen.
      await logout();
    } catch (err) {
      console.error(err);
      setDelError(err.message || 'Could not delete the account. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <>
      <Section
        title="Export your data"
        description="Download everything stored against your account as a single JSON file."
        action={
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Request data export'}
          </button>
        }
      >
        <DetailRow label="Included" value="Profile and preferences, saved resumes, career profiles, and purchase history." />
        <DetailRow label="Not included" value="Payment card details, which are held by Stripe and never reach our servers." />
        <DetailRow label="Format" value="JSON, downloaded directly to this device." />
      </Section>

      <Section
        title="How your data is used"
        description="Plain description of what actually happens to your resume content."
      >
        <Row
          title="Resume content is sent to Anthropic for generation"
          description="Job descriptions and the resume material you provide are sent to the Claude API to produce tailored output. It is not used to train models."
        />
        <Row
          title="Your resumes are private to your account"
          description="There is no public profile, no sharing link and no directory. Nothing you store is visible to other users."
        />
        <Row
          title="Stored in Google Cloud Firestore"
          description="Access is restricted by security rules to the signed-in owner of each document."
        />
      </Section>

      <Section title="Danger zone" tone="danger">
        <Row
          title="Delete account"
          description="Permanently deletes your account, resumes, career profiles, preferences and purchase history. Remaining credits are forfeited. This cannot be undone."
          control={<button className="btn btn-destructive btn-sm" onClick={() => setDelOpen(true)}>Delete account</button>}
        />
      </Section>

      <ConfirmModal
        open={delOpen}
        onClose={() => { if (!deleting) { setDelOpen(false); setDelError(null); } }}
        title="Delete your account?"
        confirmWord="DELETE"
        confirmLabel="Delete account"
        busy={deleting}
        onConfirm={handleDelete}
        body={
          <>
            {delError && <div className="error-box" style={{ marginBottom: 14 }}>{delError}</div>}
            <p style={{ margin: '0 0 10px' }}>
              This permanently removes <strong>{user?.email}</strong> along with every resume,
              career profile and preference stored against it.
            </p>
            <p style={{ margin: 0 }}>
              Any unused credits are forfeited and cannot be restored or refunded.
              Consider exporting your data first.
            </p>
          </>
        }
      />
    </>
  );
}
