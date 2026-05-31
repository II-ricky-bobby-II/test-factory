export type RunStatus = "queued" | "running" | "passed" | "failed";
export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type EventLevel = "info" | "success" | "warning" | "error";

export interface SmokeStep {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
}

export type AgentMode = "browser" | "demo";
export type ReusableStepType = "act" | "assert" | "login" | "screenshot";

export interface IntegrationCheck {
  ok: boolean;
  message: string;
  at: string;
  details?: string[];
}

export interface PublicPrAutomationConfig {
  enabled: boolean;
  githubOwner: string;
  githubRepo: string;
  githubInstallationId: string;
  githubInstalled: boolean;
  selectedTestIds: string[];
  previewWaitTimeoutSeconds: number;
  vercelProjectId: string;
  vercelProjectName: string;
  vercelTeamId: string;
  vercelTeamSlug: string;
  vercelConnected: boolean;
  bypassConfigured: boolean;
  lastGithubSync?: IntegrationCheck;
  lastVercelVerification?: IntegrationCheck;
}

export interface Project {
  id: string;
  name: string;
  deploymentUrl: string;
  githubRepo: string;
  defaultAgentMode: AgentMode;
  defaultMaxActions: number;
  prAutomation: PublicPrAutomationConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ReusableTestStep {
  id: string;
  type: ReusableStepType;
  title: string;
  detail: string;
}

export interface TestDefinition {
  id: string;
  projectId: string;
  title: string;
  description: string;
  sourcePrompt: string;
  steps: ReusableTestStep[];
  createdAt: string;
  updatedAt: string;
}

export type PrTestDraftPriority = "critical" | "high" | "medium" | "low";
export type PrTestDraftStatus = "draft" | "promoted" | "dismissed";
export type PrTestRecommendationStatus = "generating" | "ready" | "failed" | "superseded";
export type PrTestRecommendationSource = "claude" | "fallback";
export type PrTestDraftAccessTag = "auth" | "credentials" | "privileged" | "billing" | "payment";

export interface PrTestDraft {
  id: string;
  recommendationSetId: string;
  projectId: string;
  title: string;
  rationale: string;
  priority: PrTestDraftPriority;
  impactedFiles: string[];
  accessTags?: PrTestDraftAccessTag[];
  runnable: boolean;
  manualReason?: string;
  sourcePrompt: string;
  steps: ReusableTestStep[];
  status: PrTestDraftStatus;
  promotedTestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrTestRecommendationSet {
  id: string;
  projectId: string;
  githubOwner: string;
  githubRepo: string;
  prNumber: number;
  prTitle: string;
  prUrl?: string;
  branch: string;
  baseSha?: string;
  headSha: string;
  status: PrTestRecommendationStatus;
  summary: string;
  error?: string;
  changedFiles: string[];
  source: PrTestRecommendationSource;
  model?: string;
  tokenUsage?: Record<string, number>;
  drafts: PrTestDraft[];
  createdAt: string;
  updatedAt: string;
}

export interface QaEvent {
  id: string;
  runId: string;
  at: string;
  type: "status" | "step" | "log" | "screenshot" | "report";
  level: EventLevel;
  message: string;
  stepId?: string;
  screenshot?: string;
  details?: Record<string, unknown>;
}

export interface PublicQaRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  request: {
    githubRepo: string;
    deploymentUrl: string;
    smokePrompt: string;
    agentMode: AgentMode;
    maxActions: number;
    projectId?: string;
    testId?: string;
    testTitle?: string;
    pr?: {
      prRunId: string;
      prNumber: number;
      headSha: string;
      branch: string;
      deploymentId?: string;
      previewUrl?: string;
      githubCheckRunId?: string;
      automationId?: string;
    };
    hasCredentials: boolean;
  };
  steps: SmokeStep[];
  events: QaEvent[];
  latestScreenshot?: string;
  report?: {
    outcome: RunStatus;
    summary: string;
    errors: string[];
    repairBrief?: string;
    fixPrompt?: {
      text: string;
      source: "claude" | "fallback";
      model?: string;
      repoUrl?: string;
      repoContextSummary: string;
      warnings: string[];
      tokenUsage?: Record<string, number>;
    };
  };
}

export interface RunFormState {
  profileName: string;
  githubRepo: string;
  deploymentUrl: string;
  username: string;
  password: string;
  smokePrompt: string;
  agentMode: AgentMode;
  maxActions: number;
}

export interface SavedRunProfile extends RunFormState {
  id: string;
  updatedAt: string;
}

export interface ProjectFormState {
  name: string;
  deploymentUrl: string;
  githubRepo: string;
  defaultAgentMode: AgentMode;
  defaultMaxActions: number;
}

export interface PrAutomationFormState {
  enabled: boolean;
  githubOwner: string;
  githubRepo: string;
  githubInstallationId: string;
  selectedTestIds: string[];
  previewWaitTimeoutSeconds: number;
  vercelProjectId: string;
  vercelProjectName: string;
  vercelTeamId: string;
  vercelTeamSlug: string;
  vercelApiToken: string;
  vercelBypassSecret: string;
}

export interface IntegrationStatus {
  githubAppConfigured: boolean;
  githubWebhookSecretConfigured: boolean;
  githubInstallFlowConfigured: boolean;
  publicUrlConfigured: boolean;
  publicUrl: string;
  githubInstallUrl: string;
  githubSetupUrl: string;
  githubWebhookUrl: string;
  githubManifestFlowSupported: boolean;
  githubMissingConfig: {
    appId: boolean;
    privateKey: boolean;
    webhookSecret: boolean;
    installUrl: boolean;
    publicUrl: boolean;
  };
  vercelManualConnection: boolean;
}

export interface VercelProjectSummary {
  id: string;
  name: string;
  accountId?: string;
  repoUrl?: string;
  productionUrl?: string;
  teamId?: string;
  teamSlug?: string;
  source?: "api" | "cli";
  updatedAt?: number;
  createdAt?: number;
  matchedRepo: boolean;
}

export interface VercelProjectListResult {
  ok: boolean;
  message: string;
  diagnostics: string[];
  projects: VercelProjectSummary[];
  project?: Project;
  scope?: {
    teamId?: string;
    teamSlug?: string;
  };
}

export type PrAutomationRunStatus = "queued" | "resolving-preview" | "running" | "passed" | "failed" | "neutral";

export interface PrAutomationRun {
  id: string;
  projectId: string;
  githubOwner: string;
  githubRepo: string;
  prNumber: number;
  headSha: string;
  branch: string;
  status: PrAutomationRunStatus;
  createdAt: string;
  updatedAt: string;
  testIds: string[];
  runIds: string[];
  recommendationSetId?: string;
  recommendationStatus?: PrTestRecommendationStatus;
  previewUrl?: string;
  deploymentId?: string;
  githubCheckRunId?: string;
  githubCommentId?: string;
  githubWritebackError?: string;
  summary?: string;
  error?: string;
}

export interface TestEditorState {
  title: string;
  description: string;
  sourcePrompt: string;
  steps: ReusableTestStep[];
}

export interface SavedTestRunForm {
  username: string;
  password: string;
  agentMode: AgentMode;
  maxActions: number;
}

export interface TestPlanResult {
  source: "claude" | "fallback";
  steps: ReusableTestStep[];
  warning?: string;
}

export interface AuthSession {
  authEnabled: boolean;
  configured: boolean;
  authenticated: boolean;
  expiresAt?: string;
}
