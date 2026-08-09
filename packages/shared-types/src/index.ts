// Shared DTOs between web and api — import from '@talentlens/shared-types'

// ===== ENUMS =====
export type Role = 'USER' | 'ADMIN';
export type ResumeStatus = 'ACTIVE' | 'INACTIVE';
export type DomainStatus = 'DRAFT' | 'PUBLISHED';
export type AgentRunStatus = 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED';
export type AgentRunStep = 'SETUP' | 'INTELLIGENCE' | 'STRATEGY' | 'BUILD' | 'REVIEW' | 'EXPORT';
export type EvidenceStrength = 'STRONG' | 'WEAK' | 'MISSING';
export type ChangeStatus = 'PENDING' | 'ACCEPTED' | 'REVERTED';
export type QualityFlagStatus = 'NEEDS_REVIEW' | 'VERIFIED';
export type ImportanceLevel = 'Critical' | 'High' | 'Medium' | 'Low';

// ===== AUTH =====
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}
export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  role: Role;
  credits: number;
  creditsMax: number;
  planId?: string;
  createdAt: string;
}
export interface LoginRequest { email: string; password: string; }
export interface RegisterRequest { fullName: string; email: string; password: string; }

// ===== CAREER PROFILE =====
export interface Experience {
  id: string;
  careerProfileId: string;
  title: string;
  company: string;
  location?: string;
  startDate: string;
  endDate?: string;
  sortOrder: number;
}
export interface Education {
  id: string;
  careerProfileId: string;
  school: string;
  degree: string;
  fieldOfStudy?: string;
  startDate: string;
  endDate?: string;
  sortOrder: number;
}
export interface ProfileSkill { id: string; careerProfileId: string; label: string; }
export interface CareerProfileSummary {
  id: string;
  name: string;
  isDefault: boolean;
  completenessPct: number;
  experienceCount: number;
  education: Pick<Education, 'id' | 'school' | 'degree'>[];
}
export interface CareerProfileDetail extends CareerProfileSummary {
  experience: Experience[];
  skills: ProfileSkill[];
}
export interface CreateExperienceRequest { title: string; company: string; location?: string; startDate: string; endDate?: string; }
export interface CreateEducationRequest { school: string; degree: string; fieldOfStudy?: string; startDate: string; endDate?: string; }

// ===== DOMAIN (user-facing only) =====
export interface DomainPublic { id: string; name: string; summary: string; }
export interface DomainSkill { id: string; label: string; weight: number; }
export interface DomainStrongPoint { id: string; text: string; sortOrder: number; }
export interface DomainCategory { id: string; name: string; skills: DomainSkill[]; strongPoints: DomainStrongPoint[]; }
export interface DomainFull {
  id: string; name: string; summary: string; status: DomainStatus;
  createdAt: string; updatedAt: string;
  categories: DomainCategory[];
}

// ===== JOB DESCRIPTION =====
export interface JDRequirement {
  id: string;
  jobDescriptionId: string;
  name: string;
  importance: ImportanceLevel;
  mentionCount: number;
}
export interface JobDescription {
  id: string;
  userId: string;
  rawText: string;
  company?: string;
  title?: string;
  seniority?: string;
  roleFamily?: string;
  parsedDomainGuess?: string;
  createdAt: string;
  requirements: JDRequirement[];
}

// ===== AGENT RUN =====
export interface AgentRunSummary {
  id: string;
  currentStep: AgentRunStep;
  status: AgentRunStatus;
  careerProfile: { id: string; name: string; };
  domain: { id: string; name: string; };
  jobDescription: { id: string; company?: string; title?: string; };
  strategySnapshot?: AgentStrategy;
  resumeId?: string;
}
export interface AgentStrategy {
  positioning: string;
  experiencePriority: Array<{ employer: string; level: 'Very High' | 'High' | 'Medium'; }>;
  skillPriority: string[];
  deemphasize: string[];
  targets: { resumeLength: string; targetMatchScore: number; };
}
export interface AgentFindings {
  roleMatch: 'Strong' | 'Good' | 'Partial' | 'Weak';
  strongestEvidence: string[];
  gaps: Array<{ requirement: string; strength: EvidenceStrength; promptUser: boolean; }>;
}
export interface ProgressItem { label: string; state: 'done' | 'active' | 'pending'; }

// ===== RESUME =====
export interface ResumeContentBullet { text: string; }
export interface ResumeContentExperience {
  company: string;
  title: string;
  dateRange: string;
  location?: string;
  bullets: string[];
}
export interface ResumeContent {
  summary: string;
  skills: string[];
  experience: ResumeContentExperience[];
  education: Array<{ school: string; degree: string; fieldOfStudy?: string; dateRange: string; }>;
  certifications?: string[];
  achievements?: string[];
}
export interface ScoreBreakdown {
  keywordCoverage: number;
  experienceRelevance: number;
  impactMetrics: number;
  roleAlignment: number;
  formatting: number;
  leadership: number;
}
export interface ResumeVersion {
  id: string;
  resumeId: string;
  versionNumber: number;
  label: string;
  content: ResumeContent;
  matchScore?: number;
  scoreBreakdown?: ScoreBreakdown;
  createdAt: string;
}
export interface ResumeChange {
  id: string;
  resumeVersionId: string;
  section: string;
  beforeText: string;
  afterText: string;
  rationale: string;
  status: ChangeStatus;
}
export interface RequirementMatch {
  requirementName: string;
  importance: ImportanceLevel;
  mentions: number;
  evidenceStrength: EvidenceStrength;
  resumeLocations: string[];
}
export interface QualityFlag {
  id: string;
  resumeVersionId: string;
  claimText: string;
  sourceRef?: string;
  status: QualityFlagStatus;
}
export interface InlineAiRequest {
  section: string;
  action: 'improve_impact' | 'shorten' | 'add_metrics' | 'match_jd' | 'emphasize_leadership';
  selectedText: string;
}
export interface InlineAiResponse { suggestion: string; rationale: string; }

// ===== EXPORT =====
export interface ExportRequest {
  format: 'pdf' | 'docx';
  type: 'resume' | 'cover_letter' | 'recruiter_email';
  templateId?: string;
}
export interface ExportResponse { downloadUrl: string; }

// ===== BILLING =====
export interface BillingPlan {
  id: string; name: string; credits: number;
  priceMonthly: number; priceAnnual: number; features: string[];
}
