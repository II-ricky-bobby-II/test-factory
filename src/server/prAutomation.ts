import { setTimeout as delay } from "node:timers/promises";
import { executeQaRun } from "./browserAgent.js";
import { assertAllowedHostedTarget } from "./hostedTargetPolicy.js";
import {
  checkConclusionForReports,
  GitHubAppClient,
  renderStickyComment,
  stickyCommentMarker,
  type GitHubCheckConclusion
} from "./githubApp.js";
import { ProjectStore } from "./projectStore.js";
import {
  recommendPrTestDrafts,
  type PrTestRecommendationResult,
  type PrTestRecommender
} from "./prTestRecommender.js";
import { buildRepoContext } from "./repoContext.js";
import { RunStore } from "./runStore.js";
import { SecretStore } from "./secretStore.js";
import type {
  PrAutomationConfig,
  PrAutomationPatch,
  PrAutomationRun,
  PrTestRecommendationSet,
  Project,
  ReusableTestStep,
  RunReport,
  RunRequest,
  SmokeStep,
  TestDefinition
} from "./types.js";
import { VercelClient, type PreviewResolution, type VercelProjectCredentials, type VercelProjectListResult } from "./vercelClient.js";

const SUPPORTED_PR_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
const PREVIEW_POLL_INTERVAL_MS = 5000;

export interface PullRequestWebhookPayload {
  action?: string;
  installation?: { id?: number | string };
  repository?: {
    name?: string;
    full_name?: string;
    owner?: { login?: string };
    html_url?: string;
  };
  pull_request?: {
    number?: number;
    html_url?: string;
    draft?: boolean;
    head?: {
      ref?: string;
      sha?: string;
      repo?: {
        full_name?: string;
      };
    };
  };
}

export interface PrAutomationStartContext {
  githubOwner: string;
  githubRepo: string;
  githubInstallationId: string;
  prNumber: number;
  branch: string;
  headSha: string;
}

export class PrAutomationService {
  constructor(
    private readonly projectStore: ProjectStore,
    private readonly runStore: RunStore,
    private readonly secretStore: SecretStore,
    private readonly github: GitHubAppClient,
    private readonly vercel: VercelClient,
    private readonly recommendTests: PrTestRecommender = recommendPrTestDrafts
  ) {}

  async handleGitHubWebhook(eventName: string, payload: PullRequestWebhookPayload): Promise<{ accepted: boolean; prRuns: PrAutomationRun[]; message: string }> {
    if (eventName !== "pull_request" || !SUPPORTED_PR_ACTIONS.has(payload.action || "")) {
      return { accepted: false, prRuns: [], message: "Ignored unsupported GitHub webhook event." };
    }
    if (!payload.pull_request || payload.pull_request.draft) {
      return { accepted: false, prRuns: [], message: "Ignored draft or missing pull request payload." };
    }

    const context = webhookContext(payload);
    if (!context) {
      return { accepted: false, prRuns: [], message: "Ignored pull request payload missing repository, installation, branch, or SHA." };
    }

    const projects = (await this.projectStore.listProjects()).filter((project) => automationMatches(project.prAutomation, context));
    const prRuns = projects.map((project) => this.createPrRun(project, context));
    for (const prRun of prRuns) {
      void this.generatePrTestDrafts(prRun.id).catch(() => undefined);
      void this.executePrRun(prRun.id).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.runStore.updatePrRun(prRun.id, { status: "failed", error: message, summary: "PR preview automation crashed." });
      });
    }

    return {
      accepted: prRuns.length > 0,
      prRuns,
      message: prRuns.length > 0 ? `Started ${prRuns.length} PR preview automation run(s).` : "No enabled Test Factory project matched this PR."
    };
  }

  async rerunPrRun(prRunId: string): Promise<PrAutomationRun | undefined> {
    const existing = this.runStore.getPrRun(prRunId);
    if (!existing) return undefined;
    const project = await this.projectStore.getProject(existing.projectId);
    if (!project) return undefined;
    const next = this.createPrRun(project, {
      githubOwner: existing.githubOwner,
      githubRepo: existing.githubRepo,
      githubInstallationId: project.prAutomation.github.installationId,
      prNumber: existing.prNumber,
      branch: existing.branch,
      headSha: existing.headSha
    });
    void this.executePrRun(next.id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.runStore.updatePrRun(next.id, { status: "failed", error: message, summary: "PR preview automation crashed." });
    });
    return next;
  }

  async getPrTestRecommendationSetForRun(prRunId: string): Promise<PrTestRecommendationSet | undefined> {
    const prRun = this.runStore.getPrRun(prRunId);
    if (!prRun) return undefined;
    return this.projectStore.getActivePrTestRecommendationSetForRun(prRun);
  }

  async generatePrTestDrafts(prRunId: string): Promise<PrTestRecommendationSet | undefined> {
    const prRun = this.runStore.getPrRun(prRunId);
    if (!prRun) return undefined;
    const project = await this.projectStore.getProject(prRun.projectId);
    if (!project) return undefined;

    const generating = await this.projectStore.createPrTestRecommendationSet({
      projectId: project.id,
      githubOwner: prRun.githubOwner,
      githubRepo: prRun.githubRepo,
      prNumber: prRun.prNumber,
      prTitle: `PR #${prRun.prNumber}`,
      branch: prRun.branch,
      headSha: prRun.headSha,
      summary: "Generating PR-aware user-flow test drafts.",
      changedFiles: [],
      source: "fallback",
      status: "generating",
      drafts: []
    });
    if (!generating) return undefined;
    this.runStore.updatePrRun(prRun.id, {
      recommendationSetId: generating.id,
      recommendationStatus: "generating"
    });

    try {
      if (!this.github.isConfigured() || !project.prAutomation.github.installationId) {
        throw new Error("GitHub App is not connected for this project.");
      }
      const prContext = await this.github.getPullRequestContext({
        owner: prRun.githubOwner,
        repo: prRun.githubRepo,
        installationId: project.prAutomation.github.installationId,
        prNumber: prRun.prNumber,
        headSha: prRun.headSha
      });
      const recommendation = await this.recommendTests({
        projectName: project.name,
        projectDeploymentUrl: project.deploymentUrl,
        githubRepo: project.githubRepo,
        previewUrl: prRun.previewUrl,
        pr: prContext
      });
      const ready = await this.projectStore.updatePrTestRecommendationSet(generating.id, {
        githubOwner: prContext.owner,
        githubRepo: prContext.repo,
        prNumber: prContext.prNumber,
        prTitle: prContext.title || generating.prTitle,
        prUrl: prContext.htmlUrl,
        branch: prContext.headRef || prRun.branch,
        baseSha: prContext.baseSha,
        headSha: prContext.headSha || prRun.headSha,
        status: "ready",
        summary: recommendationSummary(recommendation),
        error: undefined,
        changedFiles: prContext.changedFiles.map((file) => file.path).filter(Boolean),
        source: recommendation.source,
        model: recommendation.model,
        tokenUsage: recommendation.tokenUsage,
        drafts: recommendation.drafts
      });
      this.runStore.updatePrRun(prRun.id, {
        recommendationSetId: generating.id,
        recommendationStatus: "ready"
      });
      return ready;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.projectStore.updatePrTestRecommendationSet(generating.id, {
        status: "failed",
        summary: "Could not generate PR-aware user-flow test drafts.",
        error: message
      });
      this.runStore.updatePrRun(prRun.id, {
        recommendationSetId: generating.id,
        recommendationStatus: "failed"
      });
      return failed || generating;
    }
  }

  async syncProjectGitHub(project: Project): Promise<Project> {
    const owner = project.prAutomation.github.owner || parseGitHubRepo(project.githubRepo)?.owner || "";
    const repo = project.prAutomation.github.repo || parseGitHubRepo(project.githubRepo)?.repo || "";
    if (!owner || !repo) throw new Error("GitHub owner and repo are required.");
    const result = await this.github.syncRepositoryInstallation(owner, repo);
    const updated = await this.projectStore.updatePrAutomation(project.id, {
      githubOwner: owner,
      githubRepo: repo,
      githubInstallationId: result.installationId,
      lastGithubSync: { ok: true, message: result.message, at: new Date().toISOString() }
    });
    if (!updated) throw new Error("Project not found.");
    return updated;
  }

  async verifyProjectVercel(project: Project, input: PrAutomationPatch = {}): Promise<Project> {
    const credentials = await this.vercelCredentials(project, input);
    if (!credentials) {
      const updated = await this.projectStore.updatePrAutomation(project.id, {
        lastVercelVerification: {
          ok: false,
          message: "Vercel API token and project ID are required.",
          at: new Date().toISOString(),
          details: ["No Vercel API token was available to send."]
        }
      });
      if (!updated) throw new Error("Project not found.");
      return updated;
    }

    const result = await this.vercel.verifyProject(credentials);
    const verification = { ok: result.ok, message: result.message, at: new Date().toISOString(), details: result.diagnostics };
    const update = result.ok
      ? {
          vercelProjectId: result.project?.id || result.scope?.projectId || credentials.projectId,
          vercelProjectName: result.project?.name || input.vercelProjectName || project.prAutomation.vercel.projectName,
          vercelTeamId: result.scope?.teamId || "",
          vercelTeamSlug: result.scope?.teamSlug || "",
          vercelApiTokenSecretId: input.vercelApiToken?.trim()
            ? await this.secretStore.setSecret(input.vercelApiToken, project.prAutomation.vercel.apiTokenSecretId)
            : project.prAutomation.vercel.apiTokenSecretId,
          vercelBypassSecretId: input.vercelBypassSecret?.trim()
            ? await this.secretStore.setSecret(input.vercelBypassSecret, project.prAutomation.vercel.bypassSecretId)
            : project.prAutomation.vercel.bypassSecretId,
          lastVercelVerification: verification
        }
      : {
          lastVercelVerification: verification
        };
    const updated = await this.projectStore.updatePrAutomation(project.id, update);
    if (!updated) throw new Error("Project not found.");
    return updated;
  }

  async listVercelProjects(project: Project, input: PrAutomationPatch = {}): Promise<{ result: VercelProjectListResult; project: Project }> {
    const requestToken = input.vercelApiToken?.trim();
    const requestBypassSecret = input.vercelBypassSecret?.trim();
    const apiToken = requestToken || (await this.secretStore.getSecret(project.prAutomation.vercel.apiTokenSecretId));
    const result = await this.vercel.listProjects({
      apiToken: apiToken || "",
      projectId: input.vercelProjectId?.trim() || project.prAutomation.vercel.projectId || undefined,
      projectName: input.vercelProjectName?.trim() || project.prAutomation.vercel.projectName || undefined,
      teamId: input.vercelTeamId?.trim() || project.prAutomation.vercel.teamId || undefined,
      teamSlug: input.vercelTeamSlug?.trim() || project.prAutomation.vercel.teamSlug || undefined,
      githubRepo: project.githubRepo || undefined
    });
    if (!result.ok) return { result, project };

    const update: Parameters<ProjectStore["updatePrAutomation"]>[1] = {};
    if (requestToken) update.vercelApiTokenSecretId = await this.secretStore.setSecret(requestToken, project.prAutomation.vercel.apiTokenSecretId);
    if (requestBypassSecret) update.vercelBypassSecretId = await this.secretStore.setSecret(requestBypassSecret, project.prAutomation.vercel.bypassSecretId);
    if (input.vercelTeamId !== undefined && result.scope?.teamId !== undefined) update.vercelTeamId = result.scope.teamId || "";
    if (input.vercelTeamSlug !== undefined && result.scope?.teamSlug !== undefined) update.vercelTeamSlug = result.scope.teamSlug || "";

    if (Object.keys(update).length === 0) return { result, project };
    const updated = await this.projectStore.updatePrAutomation(project.id, update);
    if (!updated) throw new Error("Project not found.");
    return { result, project: updated };
  }

  private createPrRun(project: Project, context: PrAutomationStartContext): PrAutomationRun {
    return this.runStore.createPrRun({
      projectId: project.id,
      githubOwner: context.githubOwner,
      githubRepo: context.githubRepo,
      prNumber: context.prNumber,
      headSha: context.headSha,
      branch: context.branch,
      testIds: [...project.prAutomation.selectedTestIds],
      status: "queued"
    });
  }

  private async executePrRun(prRunId: string): Promise<void> {
    const initial = this.runStore.getPrRun(prRunId);
    if (!initial) return;
    const project = await this.projectStore.getProject(initial.projectId);
    if (!project) {
      this.runStore.updatePrRun(prRunId, { status: "failed", error: "Project not found.", summary: "PR automation project was deleted." });
      return;
    }

    const detailsUrl = appDetailsUrl();
    const checkRunId = await this.ensureQueuedCheck(project, initial, detailsUrl);
    this.runStore.updatePrRun(prRunId, {
      status: "resolving-preview",
      githubCheckRunId: checkRunId,
      summary: "Looking for a READY Vercel preview deployment."
    });

    const credentials = await this.vercelCredentials(project);
    if (!credentials) {
      await this.finish(project, prRunId, [], "failure", "Vercel is not connected for this project.", detailsUrl);
      return;
    }
    if (project.prAutomation.selectedTestIds.length === 0) {
      await this.finish(project, prRunId, [], "neutral", "No saved tests are selected for the PR suite.", detailsUrl);
      return;
    }

    const resolution = await this.waitForPreview(project.prAutomation, credentials, initial.headSha, initial.branch);
    if (!resolution) {
      await this.finish(project, prRunId, [], "neutral", "No READY Vercel preview was found for this PR head SHA or branch.", detailsUrl);
      return;
    }
    await assertAllowedHostedTarget(resolution.deployment.url);

    const latest = this.runStore.updatePrRun(prRunId, {
      status: "running",
      previewUrl: resolution.deployment.url,
      deploymentId: resolution.deployment.id,
      summary: `Running saved tests against Vercel preview matched by ${resolution.matchedBy}.`
    });
    await this.updateCheck(project, latest || initial, "in_progress", undefined, "Test Factory running", "Running saved PR smoke tests.", detailsUrl);

    const reports: Array<RunReport | undefined> = [];
    const repoContext = await buildRepoContext(project.githubRepo);
    const bypassSecret = await this.secretStore.getSecret(project.prAutomation.vercel.bypassSecretId);
    for (const testId of project.prAutomation.selectedTestIds) {
      const test = await this.projectStore.getTest(testId);
      if (!test || test.projectId !== project.id) continue;
      const report = await this.runSavedTest(project, test, prRunId, resolution, repoContext, bypassSecret);
      reports.push(report);
    }

    const conclusion = checkConclusionForReports(reports);
    const summary = conclusion === "success" ? "All PR smoke tests passed." : "One or more PR smoke tests failed.";
    await this.finish(project, prRunId, reports, conclusion, summary, detailsUrl);
  }

  private async runSavedTest(
    project: Project,
    test: TestDefinition,
    prRunId: string,
    resolution: PreviewResolution,
    repoContext: Awaited<ReturnType<typeof buildRepoContext>>,
    bypassSecret?: string
  ): Promise<RunReport | undefined> {
    const currentPrRun = this.runStore.getPrRun(prRunId);
    if (!currentPrRun) return undefined;
    const runRequest: RunRequest = {
      githubRepo: project.githubRepo,
      deploymentUrl: resolution.deployment.url,
      smokePrompt: test.sourcePrompt || test.title,
      agentMode: project.defaultAgentMode,
      maxActions: project.defaultMaxActions,
      projectId: project.id,
      testId: test.id,
      testTitle: test.title,
      pr: {
        prRunId,
        prNumber: currentPrRun.prNumber,
        headSha: currentPrRun.headSha,
        branch: currentPrRun.branch,
        deploymentId: resolution.deployment.id,
        previewUrl: resolution.deployment.url,
        githubCheckRunId: currentPrRun.githubCheckRunId,
        automationId: project.id
      }
    };
    const run = this.runStore.create(runRequest, smokeStepsFromReusable(test.steps));
    this.runStore.addRunToPrRun(prRunId, run.id);

    if (requiresCredentials(test)) {
      this.runStore.setReport(run.id, {
        outcome: "failed",
        summary: "PR smoke test requires credentials.",
        errors: ["This saved test includes a login step. PR automation does not store or replay QA credentials."],
        repairBrief: "Remove login steps from the PR suite or keep this test manual."
      });
      return this.runStore.get(run.id)?.report;
    }

    await executeQaRun(run, this.runStore, { repoContext, vercelProtectionBypassSecret: bypassSecret });
    return this.runStore.get(run.id)?.report;
  }

  private async waitForPreview(
    automation: PrAutomationConfig,
    credentials: VercelProjectCredentials,
    headSha: string,
    branch: string
  ): Promise<PreviewResolution | undefined> {
    const deadline = Date.now() + automation.previewWaitTimeoutSeconds * 1000;
    do {
      const resolution = await this.vercel.resolvePreview({ ...credentials, headSha, branch });
      if (resolution) return resolution;
      if (Date.now() >= deadline) return undefined;
      await delay(Math.min(PREVIEW_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return undefined;
  }

  private async vercelCredentials(project: Project, input: PrAutomationPatch = {}): Promise<VercelProjectCredentials | undefined> {
    const automation = project.prAutomation;
    const apiToken = input.vercelApiToken?.trim() || (await this.secretStore.getSecret(automation.vercel.apiTokenSecretId));
    const projectId = input.vercelProjectId?.trim() || automation.vercel.projectId;
    if (!apiToken || !projectId) return undefined;
    return {
      apiToken,
      projectId,
      projectName: input.vercelProjectName?.trim() || automation.vercel.projectName || undefined,
      githubRepo: project.githubRepo || undefined,
      teamId: input.vercelTeamId?.trim() || automation.vercel.teamId || undefined,
      teamSlug: input.vercelTeamSlug?.trim() || automation.vercel.teamSlug || undefined
    };
  }

  private async ensureQueuedCheck(project: Project, prRun: PrAutomationRun, detailsUrl?: string): Promise<string | undefined> {
    if (!this.github.isConfigured() || !project.prAutomation.github.installationId) return undefined;
    try {
      const check = await this.github.createQueuedCheck({
        owner: prRun.githubOwner,
        repo: prRun.githubRepo,
        installationId: project.prAutomation.github.installationId,
        headSha: prRun.headSha,
        summary: "Test Factory is waiting for the Vercel preview deployment.",
        detailsUrl
      });
      return check.id;
    } catch (error) {
      this.recordGitHubWritebackError(prRun.id, "create a GitHub check run", error);
      return undefined;
    }
  }

  private async finish(
    project: Project,
    prRunId: string,
    reports: Array<RunReport | undefined>,
    conclusion: GitHubCheckConclusion,
    summary: string,
    detailsUrl?: string
  ): Promise<void> {
    const status = conclusion === "success" ? "passed" : conclusion === "neutral" ? "neutral" : "failed";
    const prRun = this.runStore.updatePrRun(prRunId, { status, summary, error: conclusion === "failure" ? summary : undefined });
    if (!prRun) return;
    await this.updateCheck(project, prRun, "completed", conclusion, status === "passed" ? "Test Factory passed" : status === "neutral" ? "Test Factory neutral" : "Test Factory failed", summary, detailsUrl);
    await this.upsertComment(project, prRun, reports);
  }

  private async updateCheck(
    project: Project,
    prRun: PrAutomationRun,
    status: "queued" | "in_progress" | "completed",
    conclusion: GitHubCheckConclusion | undefined,
    title: string,
    summary: string,
    detailsUrl?: string
  ): Promise<void> {
    if (!this.github.isConfigured() || !prRun.githubCheckRunId || !project.prAutomation.github.installationId) return;
    try {
      await this.github.updateCheck({
        owner: prRun.githubOwner,
        repo: prRun.githubRepo,
        installationId: project.prAutomation.github.installationId,
        checkRunId: prRun.githubCheckRunId,
        status,
        conclusion,
        title,
        summary,
        detailsUrl
      });
    } catch (error) {
      this.recordGitHubWritebackError(prRun.id, "update the GitHub check run", error);
    }
  }

  private async upsertComment(project: Project, prRun: PrAutomationRun, reports: Array<RunReport | undefined>): Promise<void> {
    if (!this.github.isConfigured() || !project.prAutomation.github.installationId) return;
    try {
      const comment = await this.github.upsertStickyComment({
        owner: prRun.githubOwner,
        repo: prRun.githubRepo,
        installationId: project.prAutomation.github.installationId,
        issueNumber: prRun.prNumber,
        marker: stickyCommentMarker(project.id),
        body: renderStickyComment({
          prRun,
          projectName: project.name,
          previewUrl: prRun.previewUrl,
          appUrl: appDetailsUrl(),
          reports
        })
      });
      this.runStore.updatePrRun(prRun.id, { githubCommentId: comment.id });
    } catch (error) {
      this.recordGitHubWritebackError(prRun.id, "post or update the GitHub PR comment", error);
    }
  }

  private recordGitHubWritebackError(prRunId: string, action: string, error: unknown): void {
    this.runStore.updatePrRun(prRunId, {
      githubWritebackError: `Could not ${action}. ${formatWritebackError(error)}`
    });
  }
}

function recommendationSummary(recommendation: PrTestRecommendationResult): string {
  if (recommendation.warning) return `${recommendation.summary} ${recommendation.warning}`;
  return recommendation.summary;
}

function webhookContext(payload: PullRequestWebhookPayload): PrAutomationStartContext | undefined {
  const repoFullName = payload.repository?.full_name || "";
  const [ownerFromFullName, repoFromFullName] = repoFullName.split("/");
  const owner = payload.repository?.owner?.login || ownerFromFullName || "";
  const repo = payload.repository?.name || repoFromFullName || "";
  const installationId = payload.installation?.id ? String(payload.installation.id) : "";
  const prNumber = payload.pull_request?.number || 0;
  const branch = payload.pull_request?.head?.ref || "";
  const headSha = payload.pull_request?.head?.sha || "";
  if (!owner || !repo || !installationId || !prNumber || !branch || !headSha) return undefined;
  return {
    githubOwner: owner,
    githubRepo: repo,
    githubInstallationId: installationId,
    prNumber,
    branch,
    headSha
  };
}

function automationMatches(automation: PrAutomationConfig, context: PrAutomationStartContext): boolean {
  return (
    automation.enabled &&
    automation.github.owner.toLowerCase() === context.githubOwner.toLowerCase() &&
    automation.github.repo.toLowerCase() === context.githubRepo.toLowerCase() &&
    automation.github.installationId === context.githubInstallationId
  );
}

function parseGitHubRepo(value: string): { owner: string; repo: string } | undefined {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return undefined;
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return undefined;
  }
}

function smokeStepsFromReusable(steps: ReusableTestStep[]): SmokeStep[] {
  return steps.map((step, index) => ({
    id: `step-${index + 1}`,
    title: step.title,
    detail: step.detail,
    status: "pending"
  }));
}

function requiresCredentials(test: TestDefinition): boolean {
  return test.steps.some((step) => step.type === "login");
}

function appDetailsUrl(): string | undefined {
  const publicUrl = process.env.QA_SMOKE_PUBLIC_URL?.replace(/\/+$/, "");
  return publicUrl ? `${publicUrl}/integrations` : undefined;
}

function formatWritebackError(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? `HTTP ${(error as { status: unknown }).status}` : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (status && message) return `${status}: ${message}`;
  return status || message || "GitHub rejected the writeback request.";
}
