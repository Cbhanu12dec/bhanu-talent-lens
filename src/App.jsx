import React, { useEffect, useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import ProfileView from './components/ProfileView.jsx';
import DashboardView from './components/DashboardView.jsx';
import { getProfileInfo, listResumes } from './lib/firestore.js';

function Workspace() {
  const { user } = useAuth();
  const uid = user.uid;
  const [view, setView] = useState('profile');

  const [profileInfo, setProfileInfo] = useState({});
  const [resumes, setResumes] = useState([]);
  const [activeResumeId, setActiveResumeId] = useState(null);

  const refreshResumes = useCallback(async () => {
    const r = await listResumes(uid);
    setResumes(r);
    if (!activeResumeId && r.length) setActiveResumeId(r[0].id);
  }, [uid, activeResumeId]);

  useEffect(() => {
    (async () => {
      setProfileInfo(await getProfileInfo(uid));
      await refreshResumes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const state = { profileInfo, setProfileInfo, resumes, setResumes, activeResumeId, setActiveResumeId };

  return (
    <div className="shell">
      <Sidebar view={view} setView={setView} sendingEmail={profileInfo.sendingEmail} resumeCount={resumes.length} />
      <main className="main">
        {view === 'profile' && <ProfileView uid={uid} state={state} />}
        {view === 'dashboard' && <DashboardView state={state} />}
      </main>
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
