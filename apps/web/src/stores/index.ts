import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: any | null;
  setAuth: (token: string, user: any) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('tl_token'),
  user: (() => { try { const u = localStorage.getItem('tl_user'); return u ? JSON.parse(u) : null; } catch { return null; } })(),
  setAuth: (token, user) => {
    localStorage.setItem('tl_token', token);
    localStorage.setItem('tl_user', JSON.stringify(user));
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem('tl_token');
    localStorage.removeItem('tl_user');
    set({ token: null, user: null });
  },
}));

// ===== AGENT RUN WIZARD STATE =====
interface AgentRunState {
  runId: string | null;
  step: number;
  careerProfileId: string | null;
  domainId: string | null;
  jobDescriptionId: string | null;
  strategy: any | null;
  setRunId: (id: string) => void;
  setStep: (step: number) => void;
  setSetup: (careerProfileId: string, domainId: string, jobDescriptionId: string) => void;
  setStrategy: (strategy: any) => void;
  reset: () => void;
}

export const useAgentRunStore = create<AgentRunState>((set) => ({
  runId: null,
  step: 0,
  careerProfileId: null,
  domainId: null,
  jobDescriptionId: null,
  strategy: null,
  setRunId: (runId) => set({ runId }),
  setStep: (step) => set({ step }),
  setSetup: (careerProfileId, domainId, jobDescriptionId) =>
    set({ careerProfileId, domainId, jobDescriptionId }),
  setStrategy: (strategy) => set({ strategy }),
  reset: () => set({ runId: null, step: 0, careerProfileId: null, domainId: null, jobDescriptionId: null, strategy: null }),
}));
