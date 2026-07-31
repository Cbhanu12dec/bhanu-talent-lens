import React, { useEffect, useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import DashboardView from './components/DashboardView.jsx';
import ResumeLibraryView from './components/ResumeLibraryView.jsx';
import BillingView from './components/BillingView.jsx';
import ProfileSettingsView from './components/ProfileSettingsView.jsx';
import AIPreferencesView from './components/AIPreferencesView.jsx';
import ComingSoonView from './components/ComingSoonView.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { getProfileInfo, listResumes } from './lib/firestore.js';
import { ensureAccount } from './lib/billing.js';

function getCheckoutStatusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('checkout'); // 'success' | 'cancel' | null
  if (status) {
    // Strip the param so a page refresh doesn't re-trigger the banner/poll.
    params.delete('checkout');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
  return status;
}

// Keeps a view mounted at all times (rather than unmounting on navigation)
// so in-progress state — a pasted JD, a tailored resume, a draft email —
// survives switching to another page and back. It only goes away on a full
// page refresh, or when the view's own "Clear"/"Tailor" action resets it.
function Keep({ active, children }) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>;
}

function Workspace() {
  const { user } = useAuth();
  const uid = user.uid;
  const [checkoutStatus] = useState(getCheckoutStatusFromUrl);
  const [view, setView] = useState(checkoutStatus ? 'billing' : 'dashboard');

  const [profileInfo, setProfileInfo] = useState({});
  const [resumes, setResumes] = useState([]);
  const [activeResumeId, setActiveResumeId] = useState(null);
  const [credits, setCredits] = useState(null);
  const [creditsTotal, setCreditsTotal] = useState(null);
  const [notifications, setNotifications] = useState([]);

  const refreshResumes = useCallback(async () => {
    const r = await listResumes(uid);
    setResumes(r);
    if (!activeResumeId && r.length) setActiveResumeId(r[0].id);
  }, [uid, activeResumeId]);

  const refreshProfile = useCallback(async () => {
    const info = await getProfileInfo(uid);
    setProfileInfo(info);
    setCredits(info.credits);
    setCreditsTotal(info.creditsTotal);
    return info;
  }, [uid]);

  useEffect(() => {
    (async () => {
      await ensureAccount(); // idempotent server-side credit seeding
      await refreshProfile();
      await refreshResumes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Stripe's webhook grants credits asynchronously, so the balance right
  // after redirect back from Checkout may still be stale. Poll a few times
  // over ~10s rather than making the user manually refresh.
  useEffect(() => {
    if (checkoutStatus !== 'success') return;
    let attempts = 0;
    const id = setInterval(async () => {
      attempts += 1;
      await refreshProfile();
      if (attempts >= 5) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutStatus]);

  function notify({ kind, title, detail }) {
    setNotifications(prev => [{ kind, title, detail, unread: true }, ...prev].slice(0, 20));
  }

  function handleCreditsChange(newCredits, newTotal) {
    setCredits(newCredits);
    if (newTotal !== undefined) setCreditsTotal(newTotal);
  }

  const state = { profileInfo, setProfileInfo, resumes, setResumes, activeResumeId, setActiveResumeId };

  return (
    <div className="shell">
      <CommandPalette setView={setView} />
      <Sidebar view={view} setView={setView} resumeCount={resumes.length} credits={credits} creditsTotal={creditsTotal} />
      <div className="main-col">
        <Topbar view={view} setView={setView} credits={credits} notifications={notifications} />
        <main className="main">
          <Keep active={view === 'dashboard'}>
            <DashboardView
              uid={uid} state={state}
              credits={credits} onCreditsChange={handleCreditsChange}
              notify={notify} goToBilling={() => setView('billing')} goToLibrary={() => setView('library')}
            />
          </Keep>
          <Keep active={view === 'library'}>
            <ResumeLibraryView uid={uid} state={state} notify={notify} />
          </Keep>
          <Keep active={view === 'billing'}>
            <BillingView uid={uid} credits={credits} creditsTotal={creditsTotal} checkoutStatus={checkoutStatus} active={view === 'billing'} />
          </Keep>
          <Keep active={view === 'settings'}>
            <ProfileSettingsView uid={uid} state={state} />
          </Keep>
          <Keep active={view === 'aiprefs'}>
            <AIPreferencesView uid={uid} state={state} />
          </Keep>
          <Keep active={view === 'applications'}>
            <ComingSoonView title="Applications" sub="Track every application end to end." icon="📋"
              blurb="A kanban of every role you've applied to — Applied, Interview, Rejected, Offer — linked back to the exact tailored resume and ATS score you sent." />
          </Keep>
          <Keep active={view === 'templates'}>
            <ComingSoonView title="Templates" sub="Reusable resume layouts and section presets." icon="🧩"
              blurb="Save a resume's structure and formatting as a reusable template you can apply to new base resumes." />
          </Keep>
          <Keep active={view === 'coverletters'}>
            <ComingSoonView title="Cover letters" sub="Your saved cover letters, in one place." icon="✉️"
              blurb="Every cover letter you generate from the Dashboard will be saved here for reuse and editing, instead of living only in a single session." />
          </Keep>
        </main>
      </div>
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Workspace /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
