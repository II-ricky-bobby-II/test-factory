import express from "express";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "node:crypto";
import { executeQaRun } from "./browserAgent.js";
import { AuthService } from "./auth.js";
import { safeClaudeErrorMessage } from "./claudeErrors.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import { GitHubAppClient } from "./githubApp.js";
import {
  applyGitHubAppEnv,
  buildGitHubAppManifest,
  convertGitHubAppManifest,
  gitHubAppConfigFromManifest,
  githubManifestActionUrl,
  persistGitHubAppEnv,
  renderGitHubManifestForm
} from "./githubManifest.js";
import { PrAutomationService } from "./prAutomation.js";
import type { PrTestRecommender } from "./prTestRecommender.js";
import { ProjectStore, toPublicProject } from "./projectStore.js";
import { assertAllowedHostedTarget } from "./hostedTargetPolicy.js";
import { dataUriToResponse } from "./persistence.js";
import { buildRepoContext, parseGitHubRepoUrl } from "./repoContext.js";
import { isBlobPersistenceEnabled } from "./runtime.js";
import { RunStore } from "./runStore.js";
import { SecretStore } from "./secretStore.js";
import { planClaudeSmokeSteps, planFallbackSteps, type ClaudePlanDiagnostics } from "./stepPlanner.js";
import {
  prAutomationPatchSchema,
  projectCreateSchema,
  projectUpdateSchema,
  runRequestSchema,
  savedTestRunRequestSchema,
  testCreateSchema,
  testPlanRequestSchema,
  testUpdateSchema,
  type Project,
  type ReusableTestStep,
  type RunRequest,
  type SmokeStep,
  type TestDefinition
} from "./types.js";
import { VercelClient } from "./vercelClient.js";

interface AppServices {
  secretStore?: SecretStore;
  githubClient?: GitHubAppClient;
  vercelClient?: VercelClient;
  prAutomationService?: PrAutomationService;
  prTestRecommender?: PrTestRecommender;
}

type RawBodyRequest = express.Request & { rawBody?: Buffer };
type PendingGitHubConnection = { projectId: string; createdAt: number };

const GITHUB_CONNECT_COOKIE = "qa_smoke_github_connect";
const GITHUB_CONNECT_TTL_MS = 15 * 60 * 1000;

export function createApp(store = new RunStore(), projectStore = new ProjectStore(), services: AppServices = {}): express.Express {
  const secretStore = services.secretStore || new SecretStore();
  const githubClient = services.githubClient || new GitHubAppClient();
  const vercelClient = services.vercelClient || new VercelClient();
  const prAutomation =
    services.prAutomationService || new PrAutomationService(projectStore, store, secretStore, githubClient, vercelClient, services.prTestRecommender);
  const pendingGitHubConnections = new Map<string, PendingGitHubConnection>();
  const auth = new AuthService();
  const app = express();
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = Buffer.from(buffer);
      }
    })
  );

  app.use(async (_request, _response, next) => {
    try {
      await store.ready();
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/session", (request, response) => {
    response.json(auth.status(request));
  });

  app.post("/api/auth/login", (request, response) => {
    if (!auth.isEnabled()) {
      response.json(auth.status(request));
      return;
    }
    if (!auth.isConfigured()) {
      response.status(503).json({ error: "Test Factory owner login is not configured." });
      return;
    }
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!auth.verifyPassword(password)) {
      response.status(401).json({ error: "Invalid owner password." });
      return;
    }
    response.setHeader("Set-Cookie", auth.issueCookie(request));
    response.json({ ...auth.status(request), authenticated: true });
  });

  app.post("/api/auth/logout", (request, response) => {
    response.setHeader("Set-Cookie", auth.clearCookie(request));
    response.json({ ok: true });
  });

  app.use(auth.requireAuth());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      claudeConfigured: isClaudeConfigured(),
      claudeModel: getClaudeModel(),
      browserModeRequiresClaude: true,
      githubAppConfigured: githubClient.isConfigured(),
      githubWebhookSecretConfigured: githubClient.hasWebhookSecret(),
      githubInstallFlowConfigured: githubClient.isInstallFlowConfigured(),
      publicUrlConfigured: githubClient.isPublicUrlConfigured(),
      ownerAuthEnabled: auth.isEnabled(),
      ownerAuthConfigured: auth.isConfigured(),
      blobPersistenceConfigured: isBlobPersistenceEnabled()
    });
  });

  app.get("/api/runs", (_request, response) => {
    response.json({ runs: store.list() });
  });

  app.get("/api/integrations/status", (request, response) => {
    const githubStatus = githubClient.integrationStatus();
    const integrationBaseUrl = githubStatus.publicUrl || requestBaseUrl(request);
    response.json({
      ...githubStatus,
      githubSetupUrl: `${integrationBaseUrl}/api/github/setup`,
      githubWebhookUrl: `${integrationBaseUrl}/api/github/webhook`,
      githubManifestFlowSupported: true,
      vercelManualConnection: true
    });
  });

  app.get("/api/github/manifest/new", async (request, response, next) => {
    try {
      const projectId = typeof request.query.projectId === "string" ? request.query.projectId : "";
      const organization = typeof request.query.organization === "string" ? request.query.organization : undefined;
      const project = projectId ? await projectStore.getProject(projectId) : undefined;
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      prunePendingGitHubConnections(pendingGitHubConnections);
      const state = randomUUID();
      pendingGitHubConnections.set(state, { projectId: project.id, createdAt: Date.now() });
      const baseUrl = githubClient.publicUrl() || requestBaseUrl(request);
      const manifest = buildGitHubAppManifest({ projectName: project.name, baseUrl });
      response.setHeader("Set-Cookie", cookieHeader(GITHUB_CONNECT_COOKIE, state, GITHUB_CONNECT_TTL_MS / 1000));
      response.type("html").send(
        renderGitHubManifestForm({
          actionUrl: githubManifestActionUrl(organization),
          state,
          manifest
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/github/manifest/callback", async (request, response, next) => {
    try {
      const code = typeof request.query.code === "string" ? request.query.code : "";
      const returnedState = typeof request.query.state === "string" ? request.query.state : "";
      const cookieState = parseCookie(request.headers.cookie || "")[GITHUB_CONNECT_COOKIE] || "";
      if (!code) {
        response.redirect("/integrations?githubError=manifest_missing_code");
        return;
      }
      if (!returnedState || !cookieState || returnedState !== cookieState) {
        response.redirect("/integrations?githubError=expired_login");
        return;
      }

      const pending = pendingGitHubConnections.get(returnedState);
      if (!pending || Date.now() - pending.createdAt > GITHUB_CONNECT_TTL_MS) {
        response.redirect("/integrations?githubError=expired_login");
        return;
      }
      const project = await projectStore.getProject(pending.projectId);
      if (!project) {
        response.redirect("/integrations?githubError=project_not_found");
        return;
      }

      const conversion = await convertGitHubAppManifest(code);
      const config = gitHubAppConfigFromManifest(conversion);
      await persistGitHubAppEnv(config);
      applyGitHubAppEnv(config);
      githubClient.updateConfig(config);

      response.setHeader("Set-Cookie", cookieHeader(GITHUB_CONNECT_COOKIE, returnedState, GITHUB_CONNECT_TTL_MS / 1000));
      response.redirect(`https://github.com/apps/${encodeURIComponent(conversion.slug)}/installations/new`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/github/login", async (request, response, next) => {
    try {
      const projectId = typeof request.query.projectId === "string" ? request.query.projectId : "";
      const project = projectId ? await projectStore.getProject(projectId) : undefined;
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (!githubClient.isInstallFlowConfigured()) {
        response.status(400).json({
          error: "GitHub login needs GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL. Create the GitHub App from Integrations or add one value to .env and restart the server."
        });
        return;
      }
      const url = githubClient.installationUrl();
      if (!url) {
        response.status(400).json({ error: "GitHub App install URL is not configured." });
        return;
      }

      prunePendingGitHubConnections(pendingGitHubConnections);
      const state = randomUUID();
      pendingGitHubConnections.set(state, { projectId: project.id, createdAt: Date.now() });
      response.setHeader("Set-Cookie", cookieHeader(GITHUB_CONNECT_COOKIE, state, GITHUB_CONNECT_TTL_MS / 1000));
      response.redirect(url);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/github/setup", async (request, response, next) => {
    try {
      const installationId = typeof request.query.installation_id === "string" ? request.query.installation_id : "";
      if (!installationId) {
        response.redirect("/integrations?githubError=missing_installation");
        return;
      }
      const state = parseCookie(request.headers.cookie || "")[GITHUB_CONNECT_COOKIE] || "";
      const pending = pendingGitHubConnections.get(state);
      if (state) pendingGitHubConnections.delete(state);
      response.setHeader("Set-Cookie", clearCookieHeader(GITHUB_CONNECT_COOKIE));

      const resolvedSetup =
        pending && Date.now() - pending.createdAt <= GITHUB_CONNECT_TTL_MS
          ? await resolvePendingGitHubSetup(projectStore, githubClient, installationId, pending.projectId)
          : await inferGitHubSetupFromInstallation(projectStore, githubClient, installationId);
      if (!resolvedSetup) {
        response.redirect(`/integrations?githubError=${pending ? "project_not_found" : "setup_unmatched"}`);
        return;
      }

      const { project, resolved } = resolvedSetup;
      await projectStore.updatePrAutomation(project.id, {
        githubOwner: resolved.owner,
        githubRepo: resolved.repo,
        githubInstallationId: installationId,
        lastGithubSync: { ok: true, message: resolved.message, at: new Date().toISOString() }
      });
      response.redirect(`/integrations?projectId=${encodeURIComponent(project.id)}&githubConnected=1`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", async (_request, response, next) => {
    try {
      response.json({ projects: await projectStore.listPublicProjects() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects", async (request, response, next) => {
    try {
      const parsed = projectCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      await assertAllowedHostedTarget(parsed.data.deploymentUrl);
      const project = await projectStore.createProject(parsed.data);
      response.status(201).json({ project: toPublicProject(project) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:id", async (request, response, next) => {
    try {
      const parsed = projectUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      if (parsed.data.deploymentUrl) await assertAllowedHostedTarget(parsed.data.deploymentUrl);
      const project = await projectStore.updateProject(request.params.id, parsed.data);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      response.json({ project: toPublicProject(project) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/pr-automation", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      response.json({ prAutomation: toPublicProject(project).prAutomation });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/projects/:id/pr-automation", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      const parsed = prAutomationPatchSchema.safeParse(request.body || {});
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }

      const update = {
        enabled: parsed.data.enabled,
        githubOwner: parsed.data.githubOwner,
        githubRepo: parsed.data.githubRepo,
        githubInstallationId: parsed.data.githubInstallationId,
        selectedTestIds: parsed.data.selectedTestIds,
        previewWaitTimeoutSeconds: parsed.data.previewWaitTimeoutSeconds,
        vercelProjectId: parsed.data.vercelProjectId,
        vercelProjectName: parsed.data.vercelProjectName,
        vercelTeamId: parsed.data.vercelTeamId,
        vercelTeamSlug: parsed.data.vercelTeamSlug,
        vercelApiTokenSecretId: project.prAutomation.vercel.apiTokenSecretId,
        vercelBypassSecretId: project.prAutomation.vercel.bypassSecretId
      };

      if (parsed.data.vercelApiToken !== undefined) {
        if (parsed.data.vercelApiToken.trim()) {
          update.vercelApiTokenSecretId = await secretStore.setSecret(
            parsed.data.vercelApiToken,
            project.prAutomation.vercel.apiTokenSecretId
          );
        }
      }

      if (parsed.data.vercelBypassSecret !== undefined) {
        if (parsed.data.vercelBypassSecret.trim()) {
          update.vercelBypassSecretId = await secretStore.setSecret(
            parsed.data.vercelBypassSecret,
            project.prAutomation.vercel.bypassSecretId
          );
        }
      }

      const updated = await projectStore.updatePrAutomation(project.id, update);
      response.json({ project: toPublicProject(updated!) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/pr-automation/vercel/verify", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      const parsed = prAutomationPatchSchema.safeParse(request.body || {});
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      const updated = await prAutomation.verifyProjectVercel(project, parsed.data);
      response.json({ project: toPublicProject(updated), prAutomation: toPublicProject(updated).prAutomation });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/pr-automation/vercel/projects", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      const parsed = prAutomationPatchSchema.safeParse(request.body || {});
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      const listed = await prAutomation.listVercelProjects(project, parsed.data);
      response.json({ ...listed.result, project: toPublicProject(listed.project) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/pr-automation/github/sync", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      if (!githubClient.isConfigured()) {
        response.status(400).json({ error: `GitHub App configuration is incomplete. Missing ${formatGitHubMissingConfig(githubClient.missingConfig())}.` });
        return;
      }
      const updated = await prAutomation.syncProjectGitHub(project);
      response.json({ project: toPublicProject(updated), prAutomation: toPublicProject(updated).prAutomation });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/projects/:id", async (request, response, next) => {
    try {
      const deleted = await projectStore.deleteProject(request.params.id);
      if (!deleted) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/tests", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      response.json({ tests: await projectStore.listTests(project.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/tests", async (request, response, next) => {
    try {
      const parsed = testCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      const test = await projectStore.createTest(request.params.id, parsed.data);
      if (!test) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      response.status(201).json({ test });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/tests/plan", async (request, response, next) => {
    try {
      const project = await projectStore.getProject(request.params.id);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }

      const parsed = testPlanRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }

      const planned = await planReusableTest(project, parsed.data.prompt, parsed.data.credentials);
      response.json(planned);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tests/:testId", async (request, response, next) => {
    try {
      const test = await projectStore.getTest(request.params.testId);
      if (!test) {
        response.status(404).json({ error: "Test not found." });
        return;
      }
      response.json({ test });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/tests/:testId", async (request, response, next) => {
    try {
      const parsed = testUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      const test = await projectStore.updateTest(request.params.testId, parsed.data);
      if (!test) {
        response.status(404).json({ error: "Test not found." });
        return;
      }
      response.json({ test });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/tests/:testId", async (request, response, next) => {
    try {
      const deleted = await projectStore.deleteTest(request.params.testId);
      if (!deleted) {
        response.status(404).json({ error: "Test not found." });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tests/:testId/runs", async (request, response, next) => {
    try {
      const test = await projectStore.getTest(request.params.testId);
      if (!test) {
        response.status(404).json({ error: "Test not found." });
        return;
      }
      const project = await projectStore.getProject(test.projectId);
      if (!project) {
        response.status(404).json({ error: "Project not found for test." });
        return;
      }

      const parsed = savedTestRunRequestSchema.safeParse(request.body || {});
      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }
      if (requiresCredentials(test) && !hasCompleteCredentials(parsed.data.credentials)) {
        response.status(400).json({ error: "This saved test includes a login step. Provide username and password to run it." });
        return;
      }

      const runRequest: RunRequest = {
        githubRepo: project.githubRepo,
        deploymentUrl: project.deploymentUrl,
        credentials: parsed.data.credentials,
        smokePrompt: test.sourcePrompt || test.title,
        agentMode: parsed.data.agentMode || project.defaultAgentMode,
        maxActions: parsed.data.maxActions || project.defaultMaxActions,
        projectId: project.id,
        testId: test.id,
        testTitle: test.title
      };
      await assertAllowedHostedTarget(runRequest.deploymentUrl);
      const run = store.create(runRequest, smokeStepsFromReusable(test.steps));
      response.status(202).json({ run: store.getPublic(run.id) });

      scheduleBackgroundRun(executeStoredTestRun(run, store, project).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.setReport(run.id, {
          outcome: "failed",
          summary: "Smoke run crashed.",
          errors: [message],
          repairBrief: "Inspect server logs and retry the run."
        });
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runs", async (request, response) => {
    const parsed = runRequestSchema.safeParse({
      ...request.body,
      maxActions: Number(request.body?.maxActions || 8)
    });

    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      response.status(400).json({
        error: messages[0] || "Invalid run request.",
        issues: parsed.error.flatten().fieldErrors
      });
      return;
    }
    try {
      await assertAllowedHostedTarget(parsed.data.deploymentUrl);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (parsed.data.agentMode === "demo") {
      const run = store.create(parsed.data, planFallbackSteps(parsed.data));
      response.status(202).json({ run: store.getPublic(run.id) });

      scheduleBackgroundRun(executeQaRun(run, store).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.setReport(run.id, {
          outcome: "failed",
          summary: "Smoke run crashed.",
          errors: [message],
          repairBrief: "Inspect server logs and retry the run."
        });
      }));
      return;
    }

    const plan = await createBrowserPlan(parsed.data);
    if (!plan.ok) {
      const run = store.create(parsed.data, [planningStep("failed")]);
      store.setStep(run.id, "step-1", "failed", plan.error);
      store.setReport(run.id, {
        outcome: "failed",
        summary: "Claude could not plan the Browser-mode smoke run.",
        errors: [plan.error],
        repairBrief: "Check ANTHROPIC_API_KEY, CLAUDE_MODEL, Anthropic billing, and the prompt shape, then retry."
      });
      response.status(202).json({ run: store.getPublic(run.id) });
      return;
    }

    const run = store.create(parsed.data, plan.steps);
    logPlanningDiagnostics(store, run.id, plan.diagnostics);
    response.status(202).json({ run: store.getPublic(run.id) });

    scheduleBackgroundRun(executeQaRun(run, store, { repoContext: plan.repoContext }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      store.setReport(run.id, {
        outcome: "failed",
        summary: "Smoke run crashed.",
        errors: [message],
        repairBrief: "Inspect server logs and retry the run."
      });
    }));
  });

  app.post("/api/github/webhook", async (request: RawBodyRequest, response, next) => {
    try {
      if (!githubClient.hasWebhookSecret()) {
        response.status(503).json({ error: "GitHub webhook secret is not configured." });
        return;
      }
      if (!githubClient.verifyWebhookSignature(request.rawBody || Buffer.from(""), request.headers["x-hub-signature-256"])) {
        response.status(401).json({ error: "Invalid GitHub webhook signature." });
        return;
      }
      const result = await prAutomation.handleGitHubWebhook(String(request.headers["x-github-event"] || ""), request.body);
      response.status(result.accepted ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pr-runs", (request, response) => {
    const projectId = typeof request.query.projectId === "string" ? request.query.projectId : undefined;
    response.json({ prRuns: store.listPrRuns(projectId) });
  });

  app.post("/api/pr-runs/:id/rerun", async (request, response, next) => {
    try {
      const prRun = await prAutomation.rerunPrRun(request.params.id);
      if (!prRun) {
        response.status(404).json({ error: "PR automation run not found." });
        return;
      }
      response.status(202).json({ prRun });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pr-runs/:id/test-drafts", async (request, response, next) => {
    try {
      const prRun = store.getPrRun(request.params.id);
      if (!prRun) {
        response.status(404).json({ error: "PR automation run not found." });
        return;
      }
      const recommendationSet = await prAutomation.getPrTestRecommendationSetForRun(request.params.id);
      response.json({ recommendationSet: recommendationSet || null });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pr-runs/:id/test-drafts/generate", async (request, response, next) => {
    try {
      const prRun = store.getPrRun(request.params.id);
      if (!prRun) {
        response.status(404).json({ error: "PR automation run not found." });
        return;
      }
      const recommendationSet = await prAutomation.generatePrTestDrafts(request.params.id);
      response.status(202).json({ recommendationSet });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pr-test-drafts/:id/promote", async (request, response, next) => {
    try {
      const result = await projectStore.promotePrTestDraft(request.params.id);
      if (!result) {
        response.status(404).json({ error: "PR test draft not found or cannot be promoted." });
        return;
      }
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pr-test-drafts/:id/dismiss", async (request, response, next) => {
    try {
      const recommendationSet = await projectStore.dismissPrTestDraft(request.params.id);
      if (!recommendationSet) {
        response.status(404).json({ error: "PR test draft not found." });
        return;
      }
      response.json({ recommendationSet });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pr-runs/:id/open-preview", async (request, response, next) => {
    try {
      const prRun = store.getPrRun(request.params.id);
      if (!prRun?.previewUrl) {
        response.status(404).json({ error: "Preview URL not found for PR run." });
        return;
      }
      const project = await projectStore.getProject(prRun.projectId);
      if (!project) {
        response.status(404).json({ error: "Project not found." });
        return;
      }
      const bypassSecret = await secretStore.getSecret(project.prAutomation.vercel.bypassSecretId);
      const url = new URL(prRun.previewUrl);
      if (bypassSecret) {
        url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
        url.searchParams.set("x-vercel-set-bypass-cookie", "true");
      }
      response.redirect(url.toString());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runs/:id", (request, response) => {
    const run = store.getPublic(request.params.id);
    if (!run) {
      response.status(404).json({ error: "Run not found." });
      return;
    }
    response.json({ run });
  });

  app.get("/api/runs/:id/events", (request, response) => {
    const run = store.get(request.params.id);
    if (!run) {
      response.status(404).end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    for (const event of run.events) {
      response.write(`id: ${event.id}\n`);
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const sent = new Set(run.events.map((event) => event.id));

    const unsubscribe = store.subscribe(run.id, (event) => {
      sent.add(event.id);
      response.write(`id: ${event.id}\n`);
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const poll = store.hasPersistence()
      ? setInterval(() => {
          void store.refresh().then(() => {
            const refreshed = store.get(request.params.id);
            for (const event of refreshed?.events || []) {
              if (sent.has(event.id)) continue;
              sent.add(event.id);
              response.write(`id: ${event.id}\n`);
              response.write(`event: ${event.type}\n`);
              response.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          });
        }, 1500)
      : undefined;

    request.on("close", () => {
      unsubscribe();
      if (poll) clearInterval(poll);
    });
  });

  app.get("/api/runs/:id/screenshots/:screenshotId", async (request, response, next) => {
    try {
      const dataUri = await store.getScreenshotDataUri(request.params.id, request.params.screenshotId);
      const image = dataUri ? dataUriToResponse(dataUri) : undefined;
      if (!image) {
        response.status(404).json({ error: "Screenshot not found." });
        return;
      }
      response.setHeader("Content-Type", image.contentType);
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.send(image.buffer);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = /Hosted runs|deployment URL hostname|Deployment URL is invalid/i.test(message) ? 400 : 500;
    response.status(status).json({ error: message || "Internal server error." });
  });

  return app;
}

type BrowserPlanResult =
  | { ok: true; steps: SmokeStep[]; diagnostics: ClaudePlanDiagnostics; repoContext: Awaited<ReturnType<typeof buildRepoContext>> }
  | { ok: false; error: string };

async function createBrowserPlan(request: RunRequest): Promise<BrowserPlanResult> {
  if (!isClaudeConfigured()) {
    return { ok: false, error: "Browser mode requires ANTHROPIC_API_KEY; Claude planning is not configured." };
  }

  const repoContext = await buildRepoContext(request.githubRepo);
  try {
    const plan = await planClaudeSmokeSteps(request, repoContext);
    return { ok: true, steps: plan.steps, diagnostics: plan.diagnostics, repoContext };
  } catch (error) {
    return { ok: false, error: safeClaudeErrorMessage(error) };
  }
}

function logPlanningDiagnostics(store: RunStore, runId: string, diagnostics: ClaudePlanDiagnostics): void {
  const warningLevel = diagnostics.repoContextWarnings.length > 0 ? "warning" : "info";
  store.addLog(runId, warningLevel, diagnostics.repoContextSummary, {
    repoContextFileCount: diagnostics.repoContextFileCount,
    warnings: diagnostics.repoContextWarnings
  });
  store.addLog(runId, "info", `Claude planned ${store.get(runId)?.steps.length || 0} steps with ${diagnostics.model}.`, {
    model: diagnostics.model,
    tokenUsage: diagnostics.tokenUsage,
    repoContextFileCount: diagnostics.repoContextFileCount
  });
}

function scheduleBackgroundRun(promise: Promise<void>): void {
  waitUntil(promise);
}

function planningStep(status: SmokeStep["status"]): SmokeStep {
  return {
    id: "step-1",
    title: "Plan Browser-mode smoke run with Claude",
    detail: "Ask Claude to plan the smoke run from the prompt, deployment URL, and repo context.",
    status
  };
}

async function planReusableTest(
  project: Project,
  prompt: string,
  credentials: RunRequest["credentials"]
): Promise<{ source: "claude" | "fallback"; steps: ReusableTestStep[]; diagnostics?: ClaudePlanDiagnostics; warning?: string }> {
  const request: RunRequest = {
    githubRepo: project.githubRepo,
    deploymentUrl: project.deploymentUrl,
    credentials,
    smokePrompt: prompt,
    agentMode: project.defaultAgentMode,
    maxActions: project.defaultMaxActions,
    projectId: project.id
  };

  if (!isClaudeConfigured()) {
    return { source: "fallback", steps: reusableStepsFromSmoke(planFallbackSteps(request)) };
  }

  const repoContext = await buildRepoContext(project.githubRepo);
  try {
    const plan = await planClaudeSmokeSteps(request, repoContext);
    return { source: "claude", steps: reusableStepsFromSmoke(plan.steps), diagnostics: plan.diagnostics };
  } catch (error) {
    return {
      source: "fallback",
      steps: reusableStepsFromSmoke(planFallbackSteps(request)),
      warning: safeClaudeErrorMessage(error)
    };
  }
}

async function executeStoredTestRun(run: Parameters<typeof executeQaRun>[0], store: RunStore, project: Project): Promise<void> {
  const repoContext = await buildRepoContext(project.githubRepo);
  await executeQaRun(run, store, { repoContext });
}

function reusableStepsFromSmoke(steps: SmokeStep[]): ReusableTestStep[] {
  return steps.slice(0, 8).map((step, index) => ({
    id: `step-${index + 1}`,
    type: inferReusableStepType(step),
    title: step.title,
    detail: step.detail
  }));
}

function inferReusableStepType(step: Pick<SmokeStep, "title" | "detail">): ReusableTestStep["type"] {
  const text = `${step.title} ${step.detail}`;
  if (/\b(?:log ?in|sign ?in|authenticate|credentials?)\b/i.test(text)) return "login";
  if (/\b(?:screenshot|capture)\b/i.test(text)) return "screenshot";
  if (/\b(?:assert|confirm|verify|check|expect|without|no visible|no error)\b/i.test(text)) return "assert";
  return "act";
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

function hasCompleteCredentials(credentials: RunRequest["credentials"]): boolean {
  return Boolean(credentials?.username && credentials?.password);
}

function sendValidationError(response: express.Response, error: { issues: { message: string }[]; flatten: () => { fieldErrors: Record<string, string[]> } }): void {
  const messages = error.issues.map((issue) => issue.message);
  response.status(400).json({
    error: messages[0] || "Invalid request.",
    issues: error.flatten().fieldErrors
  });
}

async function resolvePendingGitHubSetup(
  projectStore: ProjectStore,
  githubClient: GitHubAppClient,
  installationId: string,
  projectId: string
): Promise<{ project: Project; resolved: { owner: string; repo: string; message: string } } | undefined> {
  const project = await projectStore.getProject(projectId);
  if (!project) return undefined;
  const resolved = await githubClient.resolveInstallationRepository(installationId, preferredGitHubRepo(project));
  return { project, resolved };
}

async function inferGitHubSetupFromInstallation(
  projectStore: ProjectStore,
  githubClient: GitHubAppClient,
  installationId: string
): Promise<{ project: Project; resolved: { owner: string; repo: string; message: string } } | undefined> {
  const projects = await projectStore.listProjects();
  const candidates = projects
    .map((project) => ({ project, preferred: preferredGitHubRepo(project) }))
    .filter((candidate): candidate is { project: Project; preferred: { owner: string; repo: string; url?: string } } => Boolean(candidate.preferred));
  const matches: Array<{ project: Project; resolved: { owner: string; repo: string; message: string } }> = [];
  for (const candidate of candidates) {
    try {
      const resolved = await githubClient.resolveInstallationRepository(installationId, candidate.preferred);
      matches.push({ project: candidate.project, resolved });
    } catch {
      // The installation cannot access this project's configured repository.
    }
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 || projects.length !== 1) return undefined;
  const resolved = await githubClient.resolveInstallationRepository(installationId);
  return { project: projects[0], resolved };
}

function preferredGitHubRepo(project: Project): { owner: string; repo: string; url?: string } | undefined {
  return (
    parseGitHubRepoUrl(project.githubRepo) ||
    (project.prAutomation.github.owner && project.prAutomation.github.repo
      ? { owner: project.prAutomation.github.owner, repo: project.prAutomation.github.repo, url: "" }
      : undefined)
  );
}

function requestBaseUrl(request: express.Request): string {
  const forwardedProto = headerFirstValue(request.headers["x-forwarded-proto"]);
  const forwardedHost = headerFirstValue(request.headers["x-forwarded-host"]);
  const proto = forwardedProto || request.protocol || "http";
  const host = forwardedHost || request.headers.host || "localhost:4317";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function headerFirstValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

function formatGitHubMissingConfig(missing: ReturnType<GitHubAppClient["missingConfig"]>): string {
  const labels = [
    missing.appId ? "GITHUB_APP_ID" : "",
    missing.privateKey ? "GITHUB_APP_PRIVATE_KEY" : "",
    missing.webhookSecret ? "GITHUB_WEBHOOK_SECRET" : "",
    missing.installUrl ? "GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL" : ""
  ].filter(Boolean);
  return labels.length ? labels.join(", ") : "no required fields";
}

function prunePendingGitHubConnections(connections: Map<string, PendingGitHubConnection>): void {
  const now = Date.now();
  for (const [state, pending] of connections) {
    if (now - pending.createdAt > GITHUB_CONNECT_TTL_MS) connections.delete(state);
  }
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAgeSeconds)}; Path=/api/github; HttpOnly; SameSite=Lax`;
}

function clearCookieHeader(name: string): string {
  return `${name}=; Max-Age=0; Path=/api/github; HttpOnly; SameSite=Lax`;
}

function parseCookie(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}
