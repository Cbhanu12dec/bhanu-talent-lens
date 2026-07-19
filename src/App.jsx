import React, { useEffect, useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import DashboardView from './components/DashboardView.jsx';
import ResumeLibraryView from './components/ResumeLibraryView.jsx';
import BillingView from './components/BillingView.jsx';
import ProfileSettingsView from './components/ProfileSettingsView.jsx';
import { getProfileInfo, listResumes } from './lib/firestore.js';

function Workspace() {
  const { user } = useAuth();
  const uid = user.uid;
  const [view, setView] = useState('dashboard');

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

  useEffect(() => {
    (async () => {
      const info = await getProfileInfo(uid);
      setProfileInfo(info);
      setCredits(info.credits);
      setCreditsTotal(info.creditsTotal);
      await refreshResumes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

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
      <Sidebar view={view} setView={setView} resumeCount={resumes.length} credits={credits} creditsTotal={creditsTotal} />
      <div className="main-col">
        <Topbar view={view} setView={setView} credits={credits} notifications={notifications} />
        <main className="main">
          {view === 'dashboard' && (
            <DashboardView
              uid={uid} state={state}
              credits={credits} onCreditsChange={handleCreditsChange}
              notify={notify} goToBilling={() => setView('billing')} goToLibrary={() => setView('library')}
            />
          )}
          {view === 'library' && <ResumeLibraryView uid={uid} state={state} notify={notify} />}
          {view === 'billing' && (
            <BillingView uid={uid} credits={credits} creditsTotal={creditsTotal} onCreditsChange={handleCreditsChange} notify={notify} />
          )}
          {view === 'profile' && <ProfileSettingsView uid={uid} state={state} />}
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
