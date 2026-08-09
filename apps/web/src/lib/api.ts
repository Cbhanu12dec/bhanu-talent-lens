const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

import { useAuthStore } from '../stores';

function getToken() {
  return useAuthStore.getState().token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function get<T>(path: string) { return request<T>(path, { method: 'GET' }); }
function post<T>(path: string, body?: unknown) { return request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
function patch<T>(path: string, body?: unknown) { return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
function del<T>(path: string) { return request<T>(path, { method: 'DELETE' }); }

// ===== AUTH =====
export const api = {
  auth: {
    login: (body: { email: string; password: string }) => post<any>('/auth/login', body),
    register: (body: { fullName: string; email: string; password: string }) => post<any>('/auth/register', body),
    me: () => get<any>('/auth/me'),
  },
  careerProfiles: {
    list: () => get<any[]>('/career-profiles'),
    create: (body: { name: string }) => post<any>('/career-profiles', body),
    addExperience: (id: string, body: any) => post<any>(`/career-profiles/${id}/experience`, body),
    updateExperience: (id: string, body: any) => patch<any>(`/experience/${id}`, body),
    deleteExperience: (id: string) => del<void>(`/experience/${id}`),
    addEducation: (id: string, body: any) => post<any>(`/career-profiles/${id}/education`, body),
    addSkill: (id: string, body: { label: string }) => post<any>(`/career-profiles/${id}/skills`, body),
    deleteSkill: (id: string) => del<void>(`/skills/${id}`),
  },
  domains: {
    list: () => get<any[]>('/domains'),
    adminList: () => get<any[]>('/admin/domains'),
    adminCreate: (body: { name: string; summary: string }) => post<any>('/admin/domains', body),
    adminPublish: (id: string, status: 'PUBLISHED' | 'DRAFT') => patch<any>(`/admin/domains/${id}/publish`, { status }),
    adminAddCategory: (id: string, body: { name: string }) => post<any>(`/admin/domains/${id}/categories`, body),
    adminAddSkill: (categoryId: string, body: { label: string; weight?: number }) => post<any>(`/admin/domain-categories/${categoryId}/skills`, body),
    adminAddStrongPoint: (categoryId: string, body: { text: string }) => post<any>(`/admin/domain-categories/${categoryId}/strong-points`, body),
    adminStats: () => get<any>('/admin/stats'),
    adminUsers: () => get<any[]>('/admin/users'),
  },
  jobDescriptions: {
    list: () => get<any[]>('/job-descriptions'),
    create: (body: { rawText: string }) => post<any>('/job-descriptions', body),
    get: (id: string) => get<any>(`/job-descriptions/${id}`),
  },
  agentRuns: {
    list: () => get<any[]>('/agent-runs'),
    create: (body: { careerProfileId: string; domainId: string; jobDescriptionId: string }) => post<any>('/agent-runs', body),
    get: (id: string) => get<any>(`/agent-runs/${id}`),
    status: (id: string) => get<any>(`/agent-runs/${id}/status`),
    findings: (id: string) => get<any>(`/agent-runs/${id}/findings`),
    analyze: (id: string) => post<any>(`/agent-runs/${id}/analyze`),
    updateStrategy: (id: string, body: any) => patch<any>(`/agent-runs/${id}/strategy`, body),
    build: (id: string) => post<any>(`/agent-runs/${id}/build`),
    buildActivity: (id: string) => get<any>(`/agent-runs/${id}/build-activity`),
  },
  resumes: {
    list: () => get<any[]>('/resumes'),
    get: (id: string) => get<any>(`/resumes/${id}`),
    getVersion: (resumeId: string, versionId: string) => get<any>(`/resumes/${resumeId}/versions/${versionId}`),
    changes: (versionId: string) => get<any[]>(`/resume-versions/${versionId}/changes`),
    updateChange: (id: string, status: 'ACCEPTED' | 'REVERTED') => patch<any>(`/resume-changes/${id}`, { status }),
    acceptAll: (versionId: string) => post<any>(`/resume-versions/${versionId}/changes/accept-all`),
    requirementMatches: (versionId: string) => get<any[]>(`/resume-versions/${versionId}/requirement-matches`),
    qualityFlags: (versionId: string) => get<any[]>(`/resume-versions/${versionId}/quality-flags`),
    verifyFlag: (id: string) => patch<any>(`/quality-flags/${id}`, { status: 'VERIFIED' }),
    inlineAi: (versionId: string, body: any) => post<any>(`/resume-versions/${versionId}/inline-ai`, body),
    export: (id: string, body: any) => post<any>(`/resumes/${id}/export`, body),
  },
  billing: {
    plans: () => get<any[]>('/billing/plans'),
    credits: () => get<any>('/billing/credits'),
  },
};
