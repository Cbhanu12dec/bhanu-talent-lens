import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores';
import AppShell from './components/layout/AppShell';
import Login from './routes/Login';
import Dashboard from './routes/dashboard/Dashboard';
import ResumesPage from './routes/resumes/ResumesPage';
import CareerProfilePage from './routes/career-profile/CareerProfilePage';
import AgentSetup from './routes/agent/setup';
import AgentIntelligence from './routes/agent/intelligence';
import AgentStrategy from './routes/agent/strategy';
import AgentBuild from './routes/agent/build';
import AgentReview from './routes/agent/review';
import AgentExport from './routes/agent/export';
import KeywordsPage from './routes/keywords/KeywordsPage';
import BillingPage from './routes/billing/BillingPage';
import SettingsPage from './routes/settings/SettingsPage';
import AdminPage from './routes/admin/AdminPage';
import DomainBuilderPage from './routes/admin/domain-builder/DomainBuilderPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user || user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="resumes" element={<ResumesPage />} />
          <Route path="career-profile" element={<CareerProfilePage />} />
          {/* Agent Mode wizard steps */}
          <Route path="agent/:runId/setup"        element={<AgentSetup />} />
          <Route path="agent/:runId/intelligence" element={<AgentIntelligence />} />
          <Route path="agent/:runId/strategy"     element={<AgentStrategy />} />
          <Route path="agent/:runId/build"        element={<AgentBuild />} />
          <Route path="agent/:runId/review"       element={<AgentReview />} />
          <Route path="agent/:runId/export"       element={<AgentExport />} />
          <Route path="keywords" element={<KeywordsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* Admin-only routes */}
          <Route path="admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
          <Route path="admin/domain-builder" element={<RequireAdmin><DomainBuilderPage /></RequireAdmin>} />
          <Route path="admin/domain-builder/:id" element={<RequireAdmin><DomainBuilderPage /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
