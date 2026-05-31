import { z } from "zod";

export const credentialsSchema = z.object({
  username: z.string().trim().optional().default(""),
  password: z.string().optional().default("")
});

export function normalizeDeploymentUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `${isLocalHttpHost(trimmed) ? "http" : "https"}://${trimmed}`;
}

function isLocalHttpHost(value: string): boolean {
  const host = value.replace(/^\[/, "").split(/[/:]/)[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export const deploymentUrlSchema = z
  .preprocess(normalizeDeploymentUrl, z.string().trim().url("Enter a valid deployment URL or hostname."))
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, {
    message: "Deployment URL must use http or https."
  });

export const agentModeSchema = z.enum(["browser", "demo"]);
export const maxActionsValueSchema = z.coerce.number().int().min(2).max(20);
export const maxActionsSchema = maxActionsValueSchema.default(8);

export const prRunContextSchema = z
  .object({
    prRunId: z.string().trim().min(1),
    prNumber: z.number().int().positive(),
    headSha: z.string().trim().min(1),
    branch: z.string().trim().min(1),
    deploymentId: z.string().trim().optional(),
    previewUrl: z.string().trim().url().optional(),
    githubCheckRunId: z.string().trim().optional(),
    automationId: z.string().trim().optional()
  })
  .optional();

export const runRequestSchema = z.object({
  githubRepo: z.string().trim().optional().default(""),
  deploymentUrl: deploymentUrlSchema,
  credentials: credentialsSchema.optional(),
  smokePrompt: z.string().trim().min(12, "Describe the flow you want the agent to test."),
  agentMode: agentModeSchema.default("browser"),
  maxActions: maxActionsSchema,
  projectId: z.string().trim().optional(),
  testId: z.string().trim().optional(),
  testTitle: z.string().trim().optional(),
  pr: prRunContextSchema
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export type RunStatus = "queued" | "running" | "passed" | "failed";
export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type EventLevel = "info" | "success" | "warning" | "error";

export const reusableStepTypeSchema = z.enum(["act", "assert", "login", "screenshot"]);

export const reusableTestStepInputSchema = z.object({
  id: z.string().trim().optional(),
  type: reusableStepTypeSchema.default("act"),
  title: z.string().trim().min(1, "Step title is required.").max(140),
  detail: z.string().trim().min(1, "Step detail is required.").max(1000)
});

export const reusableTestStepSchema = reusableTestStepInputSchema.extend({
  id: z.string().trim().min(1)
});

const projectBaseSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(120),
  deploymentUrl: deploymentUrlSchema,
  githubRepo: z.string().trim(),
  defaultAgentMode: agentModeSchema,
  defaultMaxActions: maxActionsValueSchema
});

export const projectCreateSchema = projectBaseSchema.extend({
  githubRepo: z.string().trim().optional().default(""),
  defaultAgentMode: agentModeSchema.default("browser"),
  defaultMaxActions: maxActionsSchema
});
export const projectUpdateSchema = projectBaseSchema.partial();

const testBaseSchema = z.object({
  title: z.string().trim().min(1, "Test title is required.").max(140),
  description: z.string().trim(),
  sourcePrompt: z.string().trim(),
  steps: z.array(reusableTestStepInputSchema).min(1, "Add at least one test step.").max(8, "Reusable tests support up to 8 steps.")
});

export const testCreateSchema = testBaseSchema.extend({
  description: z.string().trim().optional().default(""),
  sourcePrompt: z.string().trim().optional().default("")
});
export const testUpdateSchema = testBaseSchema.partial();

export const testPlanRequestSchema = z.object({
  prompt: z.string().trim().min(12, "Describe the reusable test to generate."),
  credentials: credentialsSchema.optional()
});

export const savedTestRunRequestSchema = z.object({
  credentials: credentialsSchema.optional(),
  agentMode: agentModeSchema.optional(),
  maxActions: maxActionsValueSchema.optional()
});

export const verificationStateSchema = z.enum(["untested", "valid", "invalid"]);

export const prAutomationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  githubOwner: z.string().trim().optional(),
  githubRepo: z.string().trim().optional(),
  githubInstallationId: z.string().trim().optional(),
  selectedTestIds: z.array(z.string().trim().min(1)).max(50).optional(),
  previewWaitTimeoutSeconds: z.coerce.number().int().min(0).max(1800).optional(),
  vercelProjectId: z.string().trim().optional(),
  vercelProjectName: z.string().trim().optional(),
  vercelTeamId: z.string().trim().optional(),
  vercelTeamSlug: z.string().trim().optional(),
  vercelApiToken: z.string().optional(),
  vercelBypassSecret: z.string().optional()
});

export type PrAutomationPatch = z.infer<typeof prAutomationPatchSchema>;

export interface IntegrationCheck {
  ok: boolean;
  message: string;
  at: string;
  details?: string[];
}

export interface PrAutomationConfig {
  enabled: boolean;
  github: {
    owner: string;
    repo: string;
    installationId: string;
    lastSync?: IntegrationCheck;
  };
  vercel: {
    projectId: string;
    projectName: string;
    teamId: string;
    teamSlug: string;
    apiTokenSecretId?: string;
    bypassSecretId?: string;
    lastVerification?: IntegrationCheck;
  };
  selectedTestIds: string[];
  previewWaitTimeoutSeconds: number;
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
  defaultAgentMode: "browser" | "demo";
  defaultMaxActions: number;
  prAutomation: PrAutomationConfig;
  createdAt: string;
  updatedAt: string;
}

export type PublicProject = Omit<Project, "prAutomation"> & {
  prAutomation: PublicPrAutomationConfig;
};

export type ReusableStepType = z.infer<typeof reusableStepTypeSchema>;

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

export const prTestDraftPrioritySchema = z.enum(["critical", "high", "medium", "low"]);
export const prTestDraftStatusSchema = z.enum(["draft", "promoted", "dismissed"]);
export const prTestRecommendationStatusSchema = z.enum(["generating", "ready", "failed", "superseded"]);
export const prTestRecommendationSourceSchema = z.enum(["claude", "fallback"]);
export const prTestDraftAccessTagSchema = z.enum(["auth", "credentials", "privileged", "billing", "payment"]);

export type PrTestDraftPriority = z.infer<typeof prTestDraftPrioritySchema>;
export type PrTestDraftStatus = z.infer<typeof prTestDraftStatusSchema>;
export type PrTestRecommendationStatus = z.infer<typeof prTestRecommendationStatusSchema>;
export type PrTestRecommendationSource = z.infer<typeof prTestRecommendationSourceSchema>;
export type PrTestDraftAccessTag = z.infer<typeof prTestDraftAccessTagSchema>;

export interface PrTestDraft {
  id: string;
  recommendationSetId: string;
  projectId: string;
  title: string;
  rationale: string;
  priority: PrTestDraftPriority;
  impactedFiles: string[];
  accessTags: PrTestDraftAccessTag[];
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

export interface SmokeStep {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
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

export interface RunReport {
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
}

export interface QaRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  request: RunRequest;
  status: RunStatus;
  steps: SmokeStep[];
  events: QaEvent[];
  latestScreenshot?: string;
  report?: RunReport;
}

export interface PrRunContext {
  prRunId: string;
  prNumber: number;
  headSha: string;
  branch: string;
  deploymentId?: string;
  previewUrl?: string;
  githubCheckRunId?: string;
  automationId?: string;
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

export type PublicQaRun = Omit<QaRun, "request"> & {
  request: Omit<RunRequest, "credentials"> & {
    hasCredentials: boolean;
    credentials?: never;
  };
};
