import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { projectTextStore, type TextStore } from "./persistence.js";
import {
  prTestDraftPrioritySchema,
  prTestDraftAccessTagSchema,
  prTestDraftStatusSchema,
  prTestRecommendationSourceSchema,
  prTestRecommendationStatusSchema,
  projectCreateSchema,
  projectUpdateSchema,
  reusableStepTypeSchema,
  reusableTestStepSchema,
  testCreateSchema,
  testUpdateSchema,
  type IntegrationCheck,
  type PrAutomationConfig,
  type PrAutomationRun,
  type PrTestDraft,
  type PrTestRecommendationSet,
  type Project,
  type PublicProject,
  type ReusableTestStep,
  type TestDefinition
} from "./types.js";

const STORE_VERSION = 3;

const integrationCheckSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  at: z.string(),
  details: z.array(z.string()).optional()
});

const persistedPrAutomationSchema: z.ZodType<PrAutomationConfig> = z.object({
  enabled: z.boolean(),
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    installationId: z.string(),
    lastSync: integrationCheckSchema.optional()
  }),
  vercel: z.object({
    projectId: z.string(),
    projectName: z.string(),
    teamId: z.string(),
    teamSlug: z.string(),
    apiTokenSecretId: z.string().optional(),
    bypassSecretId: z.string().optional(),
    lastVerification: integrationCheckSchema.optional()
  }),
  selectedTestIds: z.array(z.string()),
  previewWaitTimeoutSeconds: z.number().int().min(0).max(1800)
});

const persistedProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  deploymentUrl: z.string().url(),
  githubRepo: z.string(),
  defaultAgentMode: z.enum(["browser", "demo"]),
  defaultMaxActions: z.number().int().min(2).max(20),
  prAutomation: persistedPrAutomationSchema.default(defaultPrAutomationConfig),
  createdAt: z.string(),
  updatedAt: z.string()
});

const persistedReusableTestStepSchema = z.object({
  id: z.string().min(1),
  type: reusableStepTypeSchema,
  title: z.string().min(1),
  detail: z.string().min(1)
});

const persistedTestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  sourcePrompt: z.string(),
  steps: z.array(persistedReusableTestStepSchema).min(1).max(8),
  createdAt: z.string(),
  updatedAt: z.string()
});

const persistedPrTestDraftSchema: z.ZodType<PrTestDraft, z.ZodTypeDef, unknown> = z.object({
  id: z.string().min(1),
  recommendationSetId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string(),
  priority: prTestDraftPrioritySchema,
  impactedFiles: z.array(z.string()),
  accessTags: z.array(prTestDraftAccessTagSchema).optional().default([]),
  runnable: z.boolean(),
  manualReason: z.string().optional(),
  sourcePrompt: z.string(),
  steps: z.array(persistedReusableTestStepSchema).min(1).max(8),
  status: prTestDraftStatusSchema,
  promotedTestId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const persistedRecommendationSetSchema: z.ZodType<PrTestRecommendationSet, z.ZodTypeDef, unknown> = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  githubOwner: z.string(),
  githubRepo: z.string(),
  prNumber: z.number().int().positive(),
  prTitle: z.string(),
  prUrl: z.string().optional(),
  branch: z.string(),
  baseSha: z.string().optional(),
  headSha: z.string(),
  status: prTestRecommendationStatusSchema,
  summary: z.string(),
  error: z.string().optional(),
  changedFiles: z.array(z.string()),
  source: prTestRecommendationSourceSchema,
  model: z.string().optional(),
  tokenUsage: z.record(z.number()).optional(),
  drafts: z.array(persistedPrTestDraftSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

const persistedDataSchema = z.object({
  version: z.literal(STORE_VERSION),
  projects: z.array(persistedProjectSchema),
  tests: z.array(persistedTestSchema),
  recommendationSets: z.array(persistedRecommendationSetSchema)
});

const persistedV1ProjectSchema = persistedProjectSchema.omit({ prAutomation: true });
const persistedV1DataSchema = z.object({
  version: z.literal(1),
  projects: z.array(persistedV1ProjectSchema),
  tests: z.array(persistedTestSchema)
});
const persistedV2DataSchema = z.object({
  version: z.literal(2),
  projects: z.array(persistedProjectSchema),
  tests: z.array(persistedTestSchema)
});

type PersistedData = z.infer<typeof persistedDataSchema>;
export type PrTestDraftCreateInput = Omit<
  PrTestDraft,
  "id" | "recommendationSetId" | "projectId" | "accessTags" | "status" | "promotedTestId" | "createdAt" | "updatedAt"
> & {
  id?: string;
  accessTags?: PrTestDraft["accessTags"];
  status?: PrTestDraft["status"];
};
export type PrTestRecommendationSetCreateInput = Omit<
  PrTestRecommendationSet,
  "id" | "drafts" | "status" | "createdAt" | "updatedAt"
> & {
  id?: string;
  status?: PrTestRecommendationSet["status"];
  drafts?: PrTestDraftCreateInput[];
};
export type PrTestRecommendationSetUpdateInput = Partial<
  Omit<PrTestRecommendationSet, "id" | "projectId" | "createdAt" | "drafts">
> & {
  drafts?: PrTestDraftCreateInput[];
};
export interface PromotePrTestDraftResult {
  test: TestDefinition;
  recommendationSet: PrTestRecommendationSet;
}
type PrAutomationUpdate = Partial<{
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
  vercelApiTokenSecretId: string | undefined;
  vercelBypassSecretId: string | undefined;
  lastGithubSync: IntegrationCheck;
  lastVercelVerification: IntegrationCheck;
}>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type TestCreateInput = z.infer<typeof testCreateSchema>;
export type TestUpdateInput = z.infer<typeof testUpdateSchema>;

export class ProjectStore {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly store: TextStore;

  constructor(filePathOrStore: string | TextStore = resolveProjectStorePath()) {
    this.store = typeof filePathOrStore === "string" ? projectTextStore(filePathOrStore) : filePathOrStore;
  }

  async listProjects(): Promise<Project[]> {
    const data = await this.read();
    return [...data.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listPublicProjects(): Promise<PublicProject[]> {
    const projects = await this.listProjects();
    return projects.map(toPublicProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const data = await this.read();
    return data.projects.find((project) => project.id === id);
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    return this.mutate((data) => {
      const now = new Date().toISOString();
      const project: Project = {
        id: randomUUID(),
        ...input,
        prAutomation: defaultPrAutomationConfig(),
        createdAt: now,
        updatedAt: now
      };
      data.projects.push(project);
      return project;
    });
  }

  async updateProject(id: string, input: ProjectUpdateInput): Promise<Project | undefined> {
    return this.mutate((data) => {
      const project = data.projects.find((candidate) => candidate.id === id);
      if (!project) return undefined;
      Object.assign(project, input, { updatedAt: new Date().toISOString() });
      return project;
    });
  }

  async updatePrAutomation(id: string, input: PrAutomationUpdate): Promise<Project | undefined> {
    return this.mutate((data) => {
      const project = data.projects.find((candidate) => candidate.id === id);
      if (!project) return undefined;
      const automation = project.prAutomation;

      if (input.enabled !== undefined) automation.enabled = input.enabled;
      if (input.githubOwner !== undefined) automation.github.owner = input.githubOwner;
      if (input.githubRepo !== undefined) automation.github.repo = input.githubRepo;
      if (input.githubInstallationId !== undefined) automation.github.installationId = input.githubInstallationId;
      if (input.selectedTestIds !== undefined) {
        const validTestIds = new Set(data.tests.filter((test) => test.projectId === id).map((test) => test.id));
        automation.selectedTestIds = input.selectedTestIds.filter((testId) => validTestIds.has(testId));
      }
      if (input.previewWaitTimeoutSeconds !== undefined) automation.previewWaitTimeoutSeconds = input.previewWaitTimeoutSeconds;

      if (input.vercelProjectId !== undefined) automation.vercel.projectId = input.vercelProjectId;
      if (input.vercelProjectName !== undefined) automation.vercel.projectName = input.vercelProjectName;
      if (input.vercelTeamId !== undefined) automation.vercel.teamId = input.vercelTeamId;
      if (input.vercelTeamSlug !== undefined) automation.vercel.teamSlug = input.vercelTeamSlug;
      if ("vercelApiTokenSecretId" in input) automation.vercel.apiTokenSecretId = input.vercelApiTokenSecretId;
      if ("vercelBypassSecretId" in input) automation.vercel.bypassSecretId = input.vercelBypassSecretId;
      if (input.lastGithubSync !== undefined) automation.github.lastSync = input.lastGithubSync;
      if (input.lastVercelVerification !== undefined) automation.vercel.lastVerification = input.lastVercelVerification;

      project.updatedAt = new Date().toISOString();
      return project;
    });
  }

  async deleteProject(id: string): Promise<boolean> {
    return this.mutate((data) => {
      const before = data.projects.length;
      data.projects = data.projects.filter((project) => project.id !== id);
      if (data.projects.length === before) return false;
      data.tests = data.tests.filter((test) => test.projectId !== id);
      return true;
    });
  }

  async listTests(projectId: string): Promise<TestDefinition[]> {
    const data = await this.read();
    return data.tests
      .filter((test) => test.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTest(id: string): Promise<TestDefinition | undefined> {
    const data = await this.read();
    return data.tests.find((test) => test.id === id);
  }

  async createTest(projectId: string, input: TestCreateInput): Promise<TestDefinition | undefined> {
    return this.mutate((data) => {
      if (!data.projects.some((project) => project.id === projectId)) return undefined;
      const now = new Date().toISOString();
      const test: TestDefinition = {
        id: randomUUID(),
        projectId,
        title: input.title,
        description: input.description,
        sourcePrompt: input.sourcePrompt,
        steps: normalizeSteps(input.steps),
        createdAt: now,
        updatedAt: now
      };
      data.tests.push(test);
      return test;
    });
  }

  async updateTest(id: string, input: TestUpdateInput): Promise<TestDefinition | undefined> {
    return this.mutate((data) => {
      const test = data.tests.find((candidate) => candidate.id === id);
      if (!test) return undefined;
      if (input.title !== undefined) test.title = input.title;
      if (input.description !== undefined) test.description = input.description;
      if (input.sourcePrompt !== undefined) test.sourcePrompt = input.sourcePrompt;
      if (input.steps !== undefined) test.steps = normalizeSteps(input.steps);
      test.updatedAt = new Date().toISOString();
      return test;
    });
  }

  async deleteTest(id: string): Promise<boolean> {
    return this.mutate((data) => {
      const before = data.tests.length;
      data.tests = data.tests.filter((test) => test.id !== id);
      if (data.tests.length === before) return false;
      for (const project of data.projects) {
        project.prAutomation.selectedTestIds = project.prAutomation.selectedTestIds.filter((testId) => testId !== id);
      }
      return true;
    });
  }

  async createPrTestRecommendationSet(input: PrTestRecommendationSetCreateInput): Promise<PrTestRecommendationSet | undefined> {
    return this.mutate((data) => {
      if (!data.projects.some((project) => project.id === input.projectId)) return undefined;
      const now = new Date().toISOString();
      supersedeMatchingRecommendationSets(data, input, now);
      const id = input.id || randomUUID();
      const set: PrTestRecommendationSet = {
        id,
        projectId: input.projectId,
        githubOwner: input.githubOwner,
        githubRepo: input.githubRepo,
        prNumber: input.prNumber,
        prTitle: input.prTitle,
        prUrl: input.prUrl,
        branch: input.branch,
        baseSha: input.baseSha,
        headSha: input.headSha,
        status: input.status || "generating",
        summary: input.summary,
        error: input.error,
        changedFiles: [...input.changedFiles],
        source: input.source,
        model: input.model,
        tokenUsage: input.tokenUsage ? { ...input.tokenUsage } : undefined,
        drafts: normalizeDrafts(input.drafts || [], id, input.projectId, now),
        createdAt: now,
        updatedAt: now
      };
      data.recommendationSets.push(set);
      return cloneRecommendationSet(set);
    });
  }

  async updatePrTestRecommendationSet(id: string, input: PrTestRecommendationSetUpdateInput): Promise<PrTestRecommendationSet | undefined> {
    return this.mutate((data) => {
      const set = data.recommendationSets.find((candidate) => candidate.id === id);
      if (!set) return undefined;
      const now = new Date().toISOString();
      if (input.githubOwner !== undefined) set.githubOwner = input.githubOwner;
      if (input.githubRepo !== undefined) set.githubRepo = input.githubRepo;
      if (input.prNumber !== undefined) set.prNumber = input.prNumber;
      if (input.prTitle !== undefined) set.prTitle = input.prTitle;
      if (input.prUrl !== undefined) set.prUrl = input.prUrl;
      if (input.branch !== undefined) set.branch = input.branch;
      if (input.baseSha !== undefined) set.baseSha = input.baseSha;
      if (input.headSha !== undefined) set.headSha = input.headSha;
      if (input.status !== undefined) set.status = input.status;
      if (input.summary !== undefined) set.summary = input.summary;
      if (input.error !== undefined) set.error = input.error;
      if (input.changedFiles !== undefined) set.changedFiles = [...input.changedFiles];
      if (input.source !== undefined) set.source = input.source;
      if (input.model !== undefined) set.model = input.model;
      if (input.tokenUsage !== undefined) set.tokenUsage = input.tokenUsage ? { ...input.tokenUsage } : undefined;
      if (input.drafts !== undefined) set.drafts = normalizeDrafts(input.drafts, set.id, set.projectId, now);
      set.updatedAt = now;
      return cloneRecommendationSet(set);
    });
  }

  async getPrTestRecommendationSet(id: string): Promise<PrTestRecommendationSet | undefined> {
    const data = await this.read();
    const set = data.recommendationSets.find((candidate) => candidate.id === id);
    return set ? cloneRecommendationSet(set) : undefined;
  }

  async getActivePrTestRecommendationSetForRun(prRun: PrAutomationRun): Promise<PrTestRecommendationSet | undefined> {
    const data = await this.read();
    const byId = prRun.recommendationSetId
      ? data.recommendationSets.find((candidate) => candidate.id === prRun.recommendationSetId)
      : undefined;
    if (byId) return cloneRecommendationSet(byId);
    const matching = activeRecommendationSets(data)
      .filter((set) => recommendationMatchesRun(set, prRun))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return matching ? cloneRecommendationSet(matching) : undefined;
  }

  async promotePrTestDraft(draftId: string): Promise<PromotePrTestDraftResult | undefined> {
    return this.mutate((data) => {
      const set = data.recommendationSets.find((candidate) => candidate.drafts.some((draft) => draft.id === draftId));
      const draft = set?.drafts.find((candidate) => candidate.id === draftId);
      if (!set || !draft || draft.status === "dismissed") return undefined;
      if (draft.status === "promoted" && draft.promotedTestId) {
        const existing = data.tests.find((test) => test.id === draft.promotedTestId);
        if (existing) return { test: cloneTest(existing), recommendationSet: cloneRecommendationSet(set) };
      }

      const now = new Date().toISOString();
      const test: TestDefinition = {
        id: randomUUID(),
        projectId: draft.projectId,
        title: draft.title,
        description: draft.rationale,
        sourcePrompt: draft.sourcePrompt,
        steps: normalizeSteps(draft.steps),
        createdAt: now,
        updatedAt: now
      };
      data.tests.push(test);
      draft.status = "promoted";
      draft.promotedTestId = test.id;
      draft.updatedAt = now;
      set.updatedAt = now;
      return { test: cloneTest(test), recommendationSet: cloneRecommendationSet(set) };
    });
  }

  async dismissPrTestDraft(draftId: string): Promise<PrTestRecommendationSet | undefined> {
    return this.mutate((data) => {
      const set = data.recommendationSets.find((candidate) => candidate.drafts.some((draft) => draft.id === draftId));
      const draft = set?.drafts.find((candidate) => candidate.id === draftId);
      if (!set || !draft) return undefined;
      const now = new Date().toISOString();
      draft.status = "dismissed";
      draft.updatedAt = now;
      set.updatedAt = now;
      return cloneRecommendationSet(set);
    });
  }

  private async mutate<T>(operation: (data: PersistedData) => T): Promise<T> {
    const next = this.writeQueue.then(async () => {
      const data = await this.read();
      const result = operation(data);
      await this.write(data);
      return result;
    });
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<PersistedData> {
    const raw = await this.store.readText();
    if (!raw) return emptyData();

    const candidate = JSON.parse(raw) as unknown;
    const parsed = persistedDataSchema.safeParse(candidate);
    if (!parsed.success) {
      const migratedV2 = persistedV2DataSchema.safeParse(candidate);
      if (migratedV2.success) return migrateV2Data(migratedV2.data);
      const migrated = persistedV1DataSchema.safeParse(candidate);
      if (!migrated.success) {
        throw new Error(`Invalid Test Factory project store at ${this.store.description}: ${parsed.error.message}`);
      }
      return migrateV1Data(migrated.data);
    }
    return {
      version: STORE_VERSION,
      projects: parsed.data.projects.map(cloneProject),
      tests: parsed.data.tests.map(cloneTest),
      recommendationSets: parsed.data.recommendationSets.map(cloneRecommendationSet)
    };
  }

  private async write(data: PersistedData): Promise<void> {
    await this.store.writeText(`${JSON.stringify(data, null, 2)}\n`);
  }
}

export function resolveProjectStorePath(): string {
  return path.resolve(process.cwd(), process.env.QA_SMOKE_DATA_FILE || ".qa-smoke/data.json");
}

function normalizeSteps(steps: Array<z.infer<typeof reusableTestStepSchema> | z.infer<typeof testCreateSchema>["steps"][number]>): ReusableTestStep[] {
  return steps.map((step) => ({
    id: step.id?.trim() || randomUUID(),
    type: step.type,
    title: step.title,
    detail: step.detail
  }));
}

function emptyData(): PersistedData {
  return { version: STORE_VERSION, projects: [], tests: [], recommendationSets: [] };
}

export function defaultPrAutomationConfig(): PrAutomationConfig {
  return {
    enabled: false,
    github: {
      owner: "",
      repo: "",
      installationId: ""
    },
    vercel: {
      projectId: "",
      projectName: "",
      teamId: "",
      teamSlug: ""
    },
    selectedTestIds: [],
    previewWaitTimeoutSeconds: 120
  };
}

export function toPublicProject(project: Project): PublicProject {
  const automation = project.prAutomation || defaultPrAutomationConfig();
  return {
    ...project,
    prAutomation: {
      enabled: automation.enabled,
      githubOwner: automation.github.owner,
      githubRepo: automation.github.repo,
      githubInstallationId: automation.github.installationId,
      githubInstalled: Boolean(automation.github.owner && automation.github.repo && automation.github.installationId),
      selectedTestIds: [...automation.selectedTestIds],
      previewWaitTimeoutSeconds: automation.previewWaitTimeoutSeconds,
      vercelProjectId: automation.vercel.projectId,
      vercelProjectName: automation.vercel.projectName,
      vercelTeamId: automation.vercel.teamId,
      vercelTeamSlug: automation.vercel.teamSlug,
      vercelConnected: Boolean(automation.vercel.projectId && automation.vercel.apiTokenSecretId),
      bypassConfigured: Boolean(automation.vercel.bypassSecretId),
      lastGithubSync: automation.github.lastSync ? { ...automation.github.lastSync } : undefined,
      lastVercelVerification: automation.vercel.lastVerification ? { ...automation.vercel.lastVerification } : undefined
    }
  };
}

function migrateV1Data(data: z.infer<typeof persistedV1DataSchema>): PersistedData {
  return {
    version: STORE_VERSION,
    projects: data.projects.map((project) => ({
      ...project,
      prAutomation: defaultPrAutomationConfig()
    })),
    tests: data.tests.map(cloneTest),
    recommendationSets: []
  };
}

function migrateV2Data(data: z.infer<typeof persistedV2DataSchema>): PersistedData {
  return {
    version: STORE_VERSION,
    projects: data.projects.map(cloneProject),
    tests: data.tests.map(cloneTest),
    recommendationSets: []
  };
}

function cloneProject(project: Project): Project {
  return {
    ...project,
    prAutomation: {
      enabled: project.prAutomation.enabled,
      github: {
        ...project.prAutomation.github,
        lastSync: project.prAutomation.github.lastSync ? { ...project.prAutomation.github.lastSync } : undefined
      },
      vercel: {
        ...project.prAutomation.vercel,
        lastVerification: project.prAutomation.vercel.lastVerification ? { ...project.prAutomation.vercel.lastVerification } : undefined
      },
      selectedTestIds: [...project.prAutomation.selectedTestIds],
      previewWaitTimeoutSeconds: project.prAutomation.previewWaitTimeoutSeconds
    }
  };
}

function cloneTest(test: TestDefinition): TestDefinition {
  return { ...test, steps: test.steps.map((step) => ({ ...step })) };
}

function cloneRecommendationSet(set: PrTestRecommendationSet): PrTestRecommendationSet {
  return {
    ...set,
    changedFiles: [...set.changedFiles],
    tokenUsage: set.tokenUsage ? { ...set.tokenUsage } : undefined,
    drafts: set.drafts.map((draft) => ({
      ...draft,
      impactedFiles: [...draft.impactedFiles],
      accessTags: [...draft.accessTags],
      steps: draft.steps.map((step) => ({ ...step }))
    }))
  };
}

function normalizeDrafts(inputs: PrTestDraftCreateInput[], recommendationSetId: string, projectId: string, now: string): PrTestDraft[] {
  return inputs.slice(0, 30).map((draft) => ({
    id: draft.id || randomUUID(),
    recommendationSetId,
    projectId,
    title: draft.title,
    rationale: draft.rationale,
    priority: draft.priority,
    impactedFiles: [...draft.impactedFiles],
    accessTags: [...(draft.accessTags || [])],
    runnable: draft.runnable,
    manualReason: draft.manualReason,
    sourcePrompt: draft.sourcePrompt,
    steps: normalizeSteps(draft.steps),
    status: draft.status || "draft",
    createdAt: now,
    updatedAt: now
  }));
}

function supersedeMatchingRecommendationSets(data: PersistedData, input: PrTestRecommendationSetCreateInput, now: string): void {
  for (const set of data.recommendationSets) {
    if (set.status !== "superseded" && recommendationMatchesInput(set, input)) {
      set.status = "superseded";
      set.updatedAt = now;
    }
  }
}

function activeRecommendationSets(data: PersistedData): PrTestRecommendationSet[] {
  return data.recommendationSets.filter((set) => set.status !== "superseded");
}

function recommendationMatchesInput(set: PrTestRecommendationSet, input: PrTestRecommendationSetCreateInput): boolean {
  return (
    set.projectId === input.projectId &&
    set.githubOwner.toLowerCase() === input.githubOwner.toLowerCase() &&
    set.githubRepo.toLowerCase() === input.githubRepo.toLowerCase() &&
    set.prNumber === input.prNumber &&
    set.branch === input.branch &&
    set.headSha === input.headSha
  );
}

function recommendationMatchesRun(set: PrTestRecommendationSet, prRun: PrAutomationRun): boolean {
  return (
    set.projectId === prRun.projectId &&
    set.githubOwner.toLowerCase() === prRun.githubOwner.toLowerCase() &&
    set.githubRepo.toLowerCase() === prRun.githubRepo.toLowerCase() &&
    set.prNumber === prRun.prNumber &&
    set.branch === prRun.branch &&
    set.headSha === prRun.headSha &&
    set.status !== "superseded"
  );
}
