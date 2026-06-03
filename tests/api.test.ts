import { mkdtemp, rm } from "node:fs/promises";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { hashPassword } from "../src/server/auth";
import { GitHubAppClient } from "../src/server/githubApp";
import { saveEncryptedGitHubAppConfig } from "../src/server/githubManifest";
import { ProjectStore } from "../src/server/projectStore";
import type { PrTestRecommender } from "../src/server/prTestRecommender";
import { RunStore } from "../src/server/runStore";
import { SecretStore } from "../src/server/secretStore";
import { VercelClient } from "../src/server/vercelClient";

describe("API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports Claude diagnostics from the health endpoint", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    const { store: projectStore, secretStore, cleanup } = await tempStores();

    try {
      const response = await request(createApp(new RunStore(), projectStore, { secretStore })).get("/api/health");

      expect(response.body).toEqual({
        ok: true,
        claudeConfigured: true,
        claudeModel: "claude-sonnet-4-20250514",
        browserModeRequiresClaude: true,
        githubAppConfigured: false,
        githubWebhookSecretConfigured: false,
        githubInstallFlowConfigured: false,
        publicUrlConfigured: false,
        ownerAuthEnabled: false,
        ownerAuthConfigured: false,
        blobPersistenceConfigured: false
      });
    } finally {
      await cleanup();
    }
  });

  it("requires account login and CSRF confirmation when production auth is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_FACTORY_ADMIN_EMAIL", "owner@example.com");
    vi.stubEnv("TEST_FACTORY_ADMIN_PASSWORD_HASH", hashPassword("owner-pass", Buffer.alloc(16, 1)));
    vi.stubEnv("TEST_FACTORY_SESSION_SECRET", "test-session-secret");
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);

      const blocked = await request(app).get("/api/projects");
      expect(blocked.status).toBe(401);

      const missingEmailLogin = await request(app).post("/api/auth/login").send({ password: "owner-pass" });
      expect(missingEmailLogin.status).toBe(401);

      const badEmailLogin = await request(app)
        .post("/api/auth/login")
        .send({ email: "other@example.com", password: "owner-pass" });
      expect(badEmailLogin.status).toBe(401);

      const badLogin = await request(app).post("/api/auth/login").send({ email: "owner@example.com", password: "wrong-pass" });
      expect(badLogin.status).toBe(401);

      const login = await request(app).post("/api/auth/login").send({ email: " OWNER@EXAMPLE.COM ", password: "owner-pass" });
      expect(login.status).toBe(200);
      expect(login.body).toMatchObject({ authEnabled: true, configured: true, authenticated: true });
      const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] || "";
      expect(cookie).toContain("test_factory_session=");
      const payload = decodeSessionCookiePayload(cookie);
      expect(payload).toMatchObject({ sub: "account" });
      expect(JSON.stringify(payload)).not.toContain("owner@example.com");
      expect(JSON.stringify(payload)).not.toContain("scrypt");

      const missingCsrf = await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({
          name: "Admin",
          deploymentUrl: "admin.example.com",
          defaultAgentMode: "demo",
          defaultMaxActions: 4
        });
      expect(missingCsrf.status).toBe(403);

      const created = await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .set("X-Test-Factory-CSRF", "1")
        .send({
          name: "Admin",
          deploymentUrl: "admin.example.com",
          defaultAgentMode: "demo",
          defaultMaxActions: 4
        });
      expect(created.status).toBe(201);

      const listed = await request(app).get("/api/projects").set("Cookie", cookie);
      expect(listed.status).toBe(200);
      expect(listed.body.projects).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("rejects existing account sessions after a password reset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_FACTORY_ADMIN_EMAIL", "owner@example.com");
    vi.stubEnv("TEST_FACTORY_ADMIN_PASSWORD_HASH", hashPassword("first-pass", Buffer.alloc(16, 1)));
    vi.stubEnv("TEST_FACTORY_SESSION_SECRET", "test-session-secret");
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const firstApp = createApp(new RunStore(), projectStore);
      const login = await request(firstApp)
        .post("/api/auth/login")
        .send({ email: "owner@example.com", password: "first-pass" });
      const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] || "";
      expect(cookie).toContain("test_factory_session=");

      vi.stubEnv("TEST_FACTORY_ADMIN_PASSWORD_HASH", hashPassword("second-pass", Buffer.alloc(16, 2)));
      const resetApp = createApp(new RunStore(), projectStore);
      const blocked = await request(resetApp).get("/api/projects").set("Cookie", cookie);

      expect(blocked.status).toBe(401);
    } finally {
      await cleanup();
    }
  });

  it("rate-limits repeated failed sign-in attempts by source and email", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_FACTORY_ADMIN_EMAIL", "owner@example.com");
    vi.stubEnv("TEST_FACTORY_ADMIN_PASSWORD_HASH", hashPassword("owner-pass", Buffer.alloc(16, 1)));
    vi.stubEnv("TEST_FACTORY_SESSION_SECRET", "test-session-secret");
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const source = "203.0.113.10";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await request(app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", source)
          .send({ email: "owner@example.com", password: `wrong-pass-${attempt}` });
        expect(failed.status).toBe(401);
      }

      const locked = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", source)
        .send({ email: "owner@example.com", password: "owner-pass" });
      expect(locked.status).toBe(429);
      expect(locked.headers["retry-after"]).toBeTruthy();

      const otherSource = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.11")
        .send({ email: "owner@example.com", password: "owner-pass" });
      expect(otherSource.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("blocks hosted runs against private network targets", async () => {
    vi.stubEnv("TEST_FACTORY_ENFORCE_HOSTED_TARGETS", "true");
    const response = await request(createApp(new RunStore())).post("/api/runs").send({
      deploymentUrl: "http://127.0.0.1:3000",
      smokePrompt: "Open the app and verify the dashboard loads.",
      agentMode: "demo",
      maxActions: 4
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Hosted runs cannot target localhost");
  });

  it("rejects invalid deployment URLs", async () => {
    const response = await request(createApp(new RunStore())).post("/api/runs").send({
      deploymentUrl: "https://",
      smokePrompt: "Open the app and verify the dashboard loads.",
      agentMode: "demo",
      maxActions: 4
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Enter a valid deployment URL or hostname.");
  });

  it("accepts bare hostnames and normalizes them to https URLs", async () => {
    const store = new RunStore();
    const response = await request(createApp(store)).post("/api/runs").send({
      deploymentUrl: "admin.asymmetric.al",
      smokePrompt: "Open the app and verify the dashboard loads.",
      agentMode: "demo",
      maxActions: 4
    });

    expect(response.status).toBe(202);
    expect(response.body.run.request.deploymentUrl).toBe("https://admin.asymmetric.al");
  });

  it("creates a demo run and streams a final report into the store", async () => {
    const store = new RunStore();
    const response = await request(createApp(store)).post("/api/runs").send({
      deploymentUrl: "https://preview.example.com",
      smokePrompt: "Open the app. Verify the dashboard loads.",
      agentMode: "demo",
      maxActions: 4
    });

    expect(response.status).toBe(202);
    const runId = response.body.run.id as string;
    const completed = await waitFor(() => store.getPublic(runId)?.status === "passed");
    expect(completed).toBe(true);
    expect(store.getPublic(runId)?.report?.summary).toContain("Demo smoke run passed");
  });

  it("fails Browser-mode runs loudly when Claude is not configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const store = new RunStore();
    const response = await request(createApp(store)).post("/api/runs").send({
      deploymentUrl: "https://preview.example.com",
      smokePrompt: "Open the app and verify the dashboard loads.",
      agentMode: "browser",
      maxActions: 4
    });

    expect(response.status).toBe(202);
    const runId = response.body.run.id as string;
    const run = store.getPublic(runId);
    expect(run?.status).toBe("failed");
    expect(run?.report?.errors.join("\n")).toContain("ANTHROPIC_API_KEY");
  });

  it("creates, updates, lists, and cascades project-owned reusable tests", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "admin.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      expect(createdProject.status).toBe(201);
      expect(createdProject.body.project.deploymentUrl).toBe("https://admin.example.com");
      const projectId = createdProject.body.project.id as string;

      const createdTest = await request(app)
        .post(`/api/projects/${projectId}/tests`)
        .send({
          title: "Dashboard smoke",
          description: "Read-only dashboard check",
          sourcePrompt: "Open the app and verify dashboard.",
          steps: [{ type: "assert", title: "Dashboard", detail: "Confirm dashboard heading is visible." }]
        });

      expect(createdTest.status).toBe(201);
      const testId = createdTest.body.test.id as string;

      const updated = await request(app).patch(`/api/tests/${testId}`).send({
        title: "Updated dashboard smoke"
      });
      expect(updated.status).toBe(200);
      expect(updated.body.test.title).toBe("Updated dashboard smoke");

      const listed = await request(app).get(`/api/projects/${projectId}/tests`);
      expect(listed.body.tests).toHaveLength(1);

      const deletedProject = await request(app).delete(`/api/projects/${projectId}`);
      expect(deletedProject.status).toBe(204);

      const deletedTest = await request(app).get(`/api/tests/${testId}`);
      expect(deletedTest.status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("plans reusable test steps with fallback when Claude is not configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Donor",
        deploymentUrl: "donor.example.com",
        defaultAgentMode: "browser",
        defaultMaxActions: 8
      });

      const planned = await request(app).post(`/api/projects/${createdProject.body.project.id}/tests/plan`).send({
        prompt: "Open the donor dashboard. Log in. Confirm Giving History appears."
      });

      expect(planned.status).toBe(200);
      expect(planned.body.source).toBe("fallback");
      expect(planned.body.steps.map((step: { title: string }) => step.title).join("\n")).toContain("Giving History");
    } finally {
      await cleanup();
    }
  });

  it("runs a saved reusable test with saved steps instead of replanning", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const runStore = new RunStore();
      const app = createApp(runStore, projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      const createdTest = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/tests`)
        .send({
          title: "Saved dashboard check",
          sourcePrompt: "This prompt should not be expanded during run creation.",
          steps: [
            { type: "act", title: "Open app shell", detail: "Open the application shell." },
            { type: "assert", title: "Confirm dashboard", detail: "Confirm the dashboard is visible." }
          ]
        });

      const response = await request(app).post(`/api/tests/${createdTest.body.test.id}/runs`).send({ agentMode: "demo", maxActions: 4 });

      expect(response.status).toBe(202);
      expect(response.body.run.request).toMatchObject({
        projectId: createdProject.body.project.id,
        testId: createdTest.body.test.id,
        testTitle: "Saved dashboard check"
      });
      expect(response.body.run.steps.map((step: { title: string }) => step.title)).toEqual(["Open app shell", "Confirm dashboard"]);

      const completed = await waitFor(() => runStore.getPublic(response.body.run.id)?.status === "passed");
      expect(completed).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("rejects saved login tests without run-time credentials", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      const createdTest = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/tests`)
        .send({
          title: "Login smoke",
          steps: [{ type: "login", title: "Log in", detail: "Log in with the provided QA credentials." }]
        });

      const response = await request(app).post(`/api/tests/${createdTest.body.test.id}/runs`).send({ agentMode: "demo", maxActions: 4 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Provide username and password");
    } finally {
      await cleanup();
    }
  });

  it("saves PR automation config with redacted Vercel secrets and verifies the project", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const vercelClient = new VercelClient(async (input) => {
        const url = String(input);
        if (url.includes("/v9/projects/")) return jsonResponse({ name: "admin" });
        return jsonResponse({});
      });
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      const createdTest = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/tests`)
        .send({
          title: "Dashboard smoke",
          steps: [{ type: "assert", title: "Dashboard", detail: "Confirm dashboard." }]
        });

      const patched = await request(app)
        .patch(`/api/projects/${createdProject.body.project.id}/pr-automation`)
        .send({
          enabled: true,
          githubOwner: "acme",
          githubRepo: "app",
          githubInstallationId: "123",
          selectedTestIds: [createdTest.body.test.id],
          previewWaitTimeoutSeconds: 0,
          vercelProjectId: "prj_123",
          vercelProjectName: "admin",
          vercelApiToken: "vercel-token",
          vercelBypassSecret: "bypass-secret"
        });

      expect(patched.status).toBe(200);
      expect(JSON.stringify(patched.body)).not.toContain("vercel-token");
      expect(JSON.stringify(patched.body)).not.toContain("bypass-secret");
      expect(patched.body.project.prAutomation).toMatchObject({
        enabled: true,
        vercelConnected: true,
        bypassConfigured: true,
        githubInstalled: true
      });

      const verified = await request(app).post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/verify`).send({});
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      expect(verified.body.prAutomation.lastVercelVerification).toMatchObject({
        ok: true,
        message: 'Verified Vercel project "admin".'
      });
    } finally {
      await cleanup();
    }
  });

  it("verifies and saves unsaved Vercel form values without leaking secrets", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      let verificationUrl = "";
      let authorization = "";
      const vercelClient = new VercelClient(async (input, init) => {
        verificationUrl = String(input);
        authorization = String(init?.headers ? (init.headers as Record<string, string>).Authorization : "");
        if (verificationUrl.includes("/v9/projects/")) return jsonResponse({ id: "prj_123", name: "admin" });
        return jsonResponse({});
      });
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const verified = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/verify`)
        .send({
          vercelProjectId: "prj_123",
          vercelProjectName: "typed-admin",
          vercelTeamId: "team_123",
          vercelTeamSlug: "acme",
          vercelApiToken: "vercel-token",
          vercelBypassSecret: "bypass-secret"
        });

      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      expect(verificationUrl).toContain("/v9/projects/prj_123");
      expect(verificationUrl).toContain("teamId=team_123");
      expect(verificationUrl).not.toContain("slug=acme");
      expect(authorization).toBe("Bearer vercel-token");
      expect(JSON.stringify(verified.body)).not.toContain("vercel-token");
      expect(JSON.stringify(verified.body)).not.toContain("bypass-secret");
      expect(verified.body.prAutomation).toMatchObject({
        vercelProjectId: "prj_123",
        vercelProjectName: "admin",
        vercelTeamId: "team_123",
        vercelTeamSlug: "",
        vercelConnected: true,
        bypassConfigured: true,
        lastVercelVerification: {
          ok: true,
          message: 'Verified Vercel project "admin".'
        }
      });
    } finally {
      await cleanup();
    }
  });

  it("connects Vercel from project-list discovery when direct project lookup misses", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const vercelClient = new VercelClient(async (input) => {
        const url = String(input);
        if (url.includes("/v9/projects/")) return jsonResponse({}, 404);
        if (url.includes("/v10/projects?") && url.includes("teamId=team_123")) {
          return jsonResponse({
            projects: [
              {
                id: "prj_123",
                name: "admin",
                link: { type: "github", org: "acme", repo: "app" }
              }
            ]
          });
        }
        return jsonResponse({ projects: [] });
      });
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const verified = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/verify`)
        .send({
          vercelProjectId: "mistyped-project-id",
          vercelProjectName: "admin",
          vercelTeamId: "team_123",
          vercelApiToken: "vercel-token"
        });

      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      expect(verified.body.prAutomation).toMatchObject({
        vercelProjectId: "prj_123",
        vercelProjectName: "admin",
        vercelTeamId: "team_123",
        vercelConnected: true,
        lastVercelVerification: {
          ok: true,
          message: 'Verified Vercel project "admin".'
        }
      });
      expect(JSON.stringify(verified.body)).not.toContain("vercel-token");
    } finally {
      await cleanup();
    }
  });

  it("lists Vercel projects for selection with unsaved token and team inputs", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const authorizations: string[] = [];
      const vercelClient = new VercelClient(async (input, init) => {
        const url = String(input);
        if (init?.headers) authorizations.push(String((init.headers as Record<string, string>).Authorization || ""));
        if (url.includes("/v10/projects?") && url.includes("teamId=team_123")) {
          return jsonResponse([
            { id: "prj_admin", name: "admin", link: { type: "github", org: "acme", repo: "app" } },
            { id: "prj_other", name: "other" }
          ]);
        }
        return jsonResponse([]);
      });
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const listed = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/projects`)
        .send({
          vercelTeamId: "team_123",
          vercelApiToken: "vercel-token"
        });

      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listed.body.projects).toEqual([
        expect.objectContaining({ id: "prj_admin", name: "admin", matchedRepo: true }),
        expect.objectContaining({ id: "prj_other", name: "other", matchedRepo: false })
      ]);
      expect(listed.body.project.prAutomation.vercelTeamId).toBe("team_123");
      const stored = await projectStore.getProject(createdProject.body.project.id);
      expect(await secretStore.getSecret(stored?.prAutomation.vercel.apiTokenSecretId)).toBe("vercel-token");
      expect(JSON.stringify(listed.body)).not.toContain("vercel-token");

      await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/projects`)
        .send({
          vercelTeamId: "team_123"
        });

      expect(authorizations.every((authorization) => authorization === "Bearer vercel-token")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("saves a valid Vercel API token even when project listing returns no projects", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const vercelClient = new VercelClient(async () => jsonResponse([]), emptyVercelCliRunner);
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const listed = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/projects`)
        .send({
          vercelTeamId: "team_123",
          vercelApiToken: "vercel-token"
        });

      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listed.body).toMatchObject({
        ok: true,
        message: "Vercel token and team are valid, but no projects were returned.",
        projects: [],
        project: {
          prAutomation: {
            vercelTeamId: "team_123"
          }
        }
      });
      const stored = await projectStore.getProject(createdProject.body.project.id);
      expect(await secretStore.getSecret(stored?.prAutomation.vercel.apiTokenSecretId)).toBe("vercel-token");
      expect(JSON.stringify(listed.body)).not.toContain("vercel-token");
    } finally {
      await cleanup();
    }
  });

  it("lists Vercel CLI projects when the saved REST token returns an empty project list", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const vercelClient = new VercelClient(
        async () => jsonResponse([]),
        async (args) => {
          if (args[0] === "teams") {
            return jsonCliResponse({
              teams: [{ id: "team_123", slug: "asymmetric-al", name: "Asymmetrical" }]
            });
          }
          return jsonCliResponse({
            contextName: "asymmetric-al",
            projects: [
              { id: "prj_admin", name: "admin", latestProductionUrl: "https://admin.asymmetric.al" },
              { id: "prj_donor", name: "donor", latestProductionUrl: "https://donor.asymmetric.al" }
            ]
          });
        }
      );
      const app = createApp(new RunStore(), projectStore, { secretStore, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const listed = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/projects`)
        .send({
          vercelTeamId: "team_123",
          vercelApiToken: "vercel-token"
        });

      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listed.body.projects).toEqual([
        expect.objectContaining({ id: "prj_admin", name: "admin", productionUrl: "https://admin.asymmetric.al", source: "cli", teamSlug: "asymmetric-al" }),
        expect.objectContaining({ id: "prj_donor", name: "donor", productionUrl: "https://donor.asymmetric.al", source: "cli", teamSlug: "asymmetric-al" })
      ]);
      const stored = await projectStore.getProject(createdProject.body.project.id);
      expect(await secretStore.getSecret(stored?.prAutomation.vercel.apiTokenSecretId)).toBe("vercel-token");
      expect(JSON.stringify(listed.body)).not.toContain("vercel-token");
    } finally {
      await cleanup();
    }
  });

  it("reports missing Vercel credentials on verify without leaking secrets", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const verified = await request(app).post(`/api/projects/${createdProject.body.project.id}/pr-automation/vercel/verify`).send({});

      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      expect(JSON.stringify(verified.body)).not.toContain("vercel-token");
      expect(verified.body.prAutomation).toMatchObject({
        vercelConnected: false,
        lastVercelVerification: {
          ok: false,
          message: "Vercel API token and project ID are required.",
          details: ["No Vercel API token was available to send."]
        }
      });
    } finally {
      await cleanup();
    }
  });

  it("starts GitHub App login and maps the setup callback to the selected project", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const githubClient = new GitHubAppClient(
        {
          appId: "1",
          privateKey: "test-key",
          webhookSecret: "webhook-secret",
          installUrl: "https://github.com/apps/qa-smoke/installations/new"
        },
        () =>
          ({
            apps: {
              listReposAccessibleToInstallation: vi.fn(async () => ({
                data: {
                  repositories: [{ owner: { login: "acme" }, name: "app" }]
                }
              }))
            }
          }) as never,
        async () => "token"
      );
      const app = createApp(new RunStore(), projectStore, { githubClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const login = await request(app).get(`/api/github/login?projectId=${createdProject.body.project.id}`);
      expect(login.status).toBe(302);
      expect(login.headers.location).toBe("https://github.com/apps/qa-smoke/installations/new");
      expect(login.headers["set-cookie"]?.[0]).toContain("qa_smoke_github_connect=");

      const setup = await request(app)
        .get("/api/github/setup?installation_id=123&setup_action=install")
        .set("Cookie", login.headers["set-cookie"]);

      expect(setup.status).toBe(302);
      expect(setup.headers.location).toContain("/integrations?");
      expect(setup.headers.location).toContain("githubConnected=1");
      const project = await projectStore.getProject(createdProject.body.project.id);
      expect(project?.prAutomation.github).toMatchObject({
        owner: "acme",
        repo: "app",
        installationId: "123"
      });
    } finally {
      await cleanup();
    }
  });

  it("maps a GitHub setup callback without the local login cookie when the installation matches one configured repo", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const githubClient = new GitHubAppClient(
        {
          appId: "1",
          privateKey: "test-key",
          webhookSecret: "webhook-secret",
          installUrl: "https://github.com/apps/qa-smoke/installations/new"
        },
        () =>
          ({
            apps: {
              listReposAccessibleToInstallation: vi.fn(async () => ({
                data: {
                  repositories: [{ owner: { login: "acme" }, name: "app" }]
                }
              }))
            }
          }) as never,
        async () => "token"
      );
      const app = createApp(new RunStore(), projectStore, { githubClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const setup = await request(app).get("/api/github/setup?installation_id=123&setup_action=update");

      expect(setup.status).toBe(302);
      expect(setup.headers.location).toContain(`/integrations?projectId=${createdProject.body.project.id}`);
      expect(setup.headers.location).toContain("githubConnected=1");
      const project = await projectStore.getProject(createdProject.body.project.id);
      expect(project?.prAutomation.github).toMatchObject({
        owner: "acme",
        repo: "app",
        installationId: "123"
      });
    } finally {
      await cleanup();
    }
  });

  it("serves a GitHub App manifest registration form for a selected project", async () => {
    const { store: projectStore, cleanup } = await tempProjectStore();
    try {
      const app = createApp(new RunStore(), projectStore);
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });

      const response = await request(app).get(`/api/github/manifest/new?projectId=${createdProject.body.project.id}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["set-cookie"]?.[0]).toContain("qa_smoke_github_connect=");
      expect(response.text).toContain("https://github.com/settings/apps/new");
      expect(response.text).toContain("api/github/webhook");
      expect(response.text).toContain("pull_request");
    } finally {
      await cleanup();
    }
  });

  it("loads encrypted GitHub App configuration into the default GitHub client", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      await saveEncryptedGitHubAppConfig(secretStore, {
        appId: "123",
        appSlug: "test-factory-app",
        privateKey: "-----BEGIN KEY-----\nprivate\n-----END KEY-----\n",
        webhookSecret: "webhook-secret"
      });

      const response = await request(createApp(new RunStore(), projectStore, { secretStore })).get("/api/health");

      expect(response.body).toMatchObject({
        githubAppConfigured: true,
        githubWebhookSecretConfigured: true,
        githubInstallFlowConfigured: true
      });
      expect(JSON.stringify(response.body)).not.toContain("webhook-secret");
      expect(JSON.stringify(response.body)).not.toContain("-----BEGIN KEY-----");
    } finally {
      await cleanup();
    }
  });

  it("accepts a signed GitHub PR webhook, resolves a Vercel preview, and runs the configured suite", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const runStore = new RunStore();
      const checks = { created: 0, updated: 0 };
      const comments = { created: "" };
      const githubClient = new GitHubAppClient(
        { appId: "1", privateKey: "test-key", webhookSecret: "webhook-secret" },
        () =>
          ({
            checks: {
              create: vi.fn(async () => {
                checks.created += 1;
                return { data: { id: 42, html_url: "https://github.com/checks/42" } };
              }),
              update: vi.fn(async () => {
                checks.updated += 1;
                return { data: {} };
              })
            },
            issues: {
              listComments: vi.fn(async () => ({ data: [] })),
              createComment: vi.fn(async ({ body }: { body: string }) => {
                comments.created = body;
                return { data: { id: 7, html_url: "https://github.com/acme/app/pull/5#issuecomment-7" } };
              }),
              updateComment: vi.fn()
            }
          }) as never,
        async () => "token"
      );
      const vercelClient = new VercelClient(async (input) => {
        const url = String(input);
        if (url.includes("/v6/deployments")) {
          return jsonResponse({
            deployments: [
              {
                uid: "dpl_1",
                url: "admin-git-feature-acme.vercel.app",
                readyState: "READY",
                target: "preview",
                createdAt: 1000,
                meta: { githubCommitSha: "abc123", githubCommitRef: "feature" }
              }
            ]
          });
        }
        return jsonResponse({});
      });
      const app = createApp(runStore, projectStore, { secretStore, githubClient, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      const createdTest = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/tests`)
        .send({
          title: "Dashboard smoke",
          sourcePrompt: "Open the app and verify dashboard.",
          steps: [{ type: "assert", title: "Dashboard", detail: "Confirm dashboard." }]
        });
      await request(app)
        .patch(`/api/projects/${createdProject.body.project.id}/pr-automation`)
        .send({
          enabled: true,
          githubOwner: "acme",
          githubRepo: "app",
          githubInstallationId: "123",
          selectedTestIds: [createdTest.body.test.id],
          previewWaitTimeoutSeconds: 0,
          vercelProjectId: "prj_123",
          vercelApiToken: "vercel-token"
        });

      const payload = {
        action: "opened",
        installation: { id: 123 },
        repository: { name: "app", full_name: "acme/app", owner: { login: "acme" } },
        pull_request: {
          number: 5,
          draft: false,
          head: { ref: "feature", sha: "abc123" }
        }
      };
      const body = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
      const response = await request(app)
        .post("/api/github/webhook")
        .set("x-github-event", "pull_request")
        .set("x-hub-signature-256", signature)
        .set("content-type", "application/json")
        .send(body);

      expect(response.status).toBe(202);
      expect(await waitFor(() => runStore.listPrRuns()[0]?.status === "passed")).toBe(true);
      expect(runStore.listPrRuns()[0]).toMatchObject({
        previewUrl: "https://admin-git-feature-acme.vercel.app",
        deploymentId: "dpl_1"
      });
      expect(runStore.list()).toHaveLength(1);
      expect(checks.created).toBe(1);
      expect(checks.updated).toBeGreaterThan(0);
      expect(comments.created).toContain("Test Factory passed");
      expect(comments.created).toContain("https://admin-git-feature-acme.vercel.app");
      expect(comments.created).not.toContain("vercel-token");
    } finally {
      await cleanup();
    }
  });

  it("keeps the PR run result when GitHub comment writeback is denied", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const runStore = new RunStore();
      const githubClient = new GitHubAppClient(
        { appId: "1", privateKey: "test-key", webhookSecret: "webhook-secret" },
        () =>
          ({
            checks: {
              create: vi.fn(async () => ({ data: { id: 42, html_url: "https://github.com/checks/42" } })),
              update: vi.fn(async () => ({ data: {} }))
            },
            issues: {
              listComments: vi.fn(async () => ({ data: [] })),
              createComment: vi.fn(async () => {
                throw Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
              }),
              updateComment: vi.fn()
            }
          }) as never,
        async () => "token"
      );
      const vercelClient = new VercelClient(async (input) => {
        const url = String(input);
        if (url.includes("/v6/deployments")) {
          return jsonResponse({
            deployments: [
              {
                uid: "dpl_1",
                url: "admin-git-feature-acme.vercel.app",
                readyState: "READY",
                target: "preview",
                createdAt: 1000,
                meta: { githubCommitSha: "abc123", githubCommitRef: "feature" }
              }
            ]
          });
        }
        return jsonResponse({});
      });
      const app = createApp(runStore, projectStore, { secretStore, githubClient, vercelClient });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      const createdTest = await request(app)
        .post(`/api/projects/${createdProject.body.project.id}/tests`)
        .send({
          title: "Dashboard smoke",
          sourcePrompt: "Open the app and verify dashboard.",
          steps: [{ type: "assert", title: "Dashboard", detail: "Confirm dashboard." }]
        });
      await request(app)
        .patch(`/api/projects/${createdProject.body.project.id}/pr-automation`)
        .send({
          enabled: true,
          githubOwner: "acme",
          githubRepo: "app",
          githubInstallationId: "123",
          selectedTestIds: [createdTest.body.test.id],
          previewWaitTimeoutSeconds: 0,
          vercelProjectId: "prj_123",
          vercelApiToken: "vercel-token"
        });

      const response = await sendPullRequestWebhook(app, {
        action: "opened",
        installation: { id: 123 },
        repository: { name: "app", full_name: "acme/app", owner: { login: "acme" } },
        pull_request: {
          number: 5,
          draft: false,
          head: { ref: "feature", sha: "abc123" }
        }
      });

      expect(response.status).toBe(202);
      expect(await waitFor(() => Boolean(runStore.listPrRuns()[0]?.githubWritebackError))).toBe(true);
      expect(runStore.listPrRuns()[0]).toMatchObject({
        status: "passed",
        githubWritebackError: expect.stringContaining("Could not post or update the GitHub PR comment.")
      });
    } finally {
      await cleanup();
    }
  });

  it("generates PR-scoped draft tests from a matching webhook even when no saved tests are selected", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const runStore = new RunStore();
      const recommender = vi.fn<PrTestRecommender>(async () => ({
        source: "fallback",
        summary: "Recommended dashboard coverage for this PR.",
        drafts: [
          {
            title: "Dashboard campaign metric",
            rationale: "The PR changes dashboard metric rendering.",
            priority: "high",
            impactedFiles: ["src/app/dashboard/page.tsx"],
            accessTags: [],
            runnable: true,
            sourcePrompt: "Open dashboard and verify the campaign metric.",
            steps: [{ id: "step-1", type: "assert", title: "Metric", detail: "Confirm the campaign metric is visible." }]
          }
        ]
      }));
      const app = createApp(runStore, projectStore, {
        secretStore,
        githubClient: githubClientForPrContext(),
        prTestRecommender: recommender
      });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      await request(app)
        .patch(`/api/projects/${createdProject.body.project.id}/pr-automation`)
        .send({
          enabled: true,
          githubOwner: "acme",
          githubRepo: "app",
          githubInstallationId: "123",
          selectedTestIds: [],
          previewWaitTimeoutSeconds: 0,
          vercelProjectId: "prj_123",
          vercelApiToken: "vercel-token"
        });

      const response = await sendPullRequestWebhook(app, {
        action: "opened",
        installation: { id: 123 },
        repository: { name: "app", full_name: "acme/app", owner: { login: "acme" } },
        pull_request: {
          number: 8,
          draft: false,
          head: { ref: "feature", sha: "head123" }
        }
      });

      expect(response.status).toBe(202);
      expect(await waitFor(() => runStore.listPrRuns()[0]?.recommendationStatus === "ready")).toBe(true);
      expect(runStore.listPrRuns()[0]).toMatchObject({
        status: "neutral",
        recommendationStatus: "ready"
      });
      expect(runStore.list()).toHaveLength(0);
      const draftResponse = await request(app).get(`/api/pr-runs/${runStore.listPrRuns()[0].id}/test-drafts`);
      expect(draftResponse.body.recommendationSet).toMatchObject({
        status: "ready",
        summary: "Recommended dashboard coverage for this PR."
      });
      expect(draftResponse.body.recommendationSet.drafts[0]).toMatchObject({
        title: "Dashboard campaign metric",
        priority: "high",
        runnable: true
      });
    } finally {
      await cleanup();
    }
  });

  it("regenerates, supersedes, promotes, and dismisses PR test drafts through the API", async () => {
    const { store: projectStore, secretStore, cleanup } = await tempStores();
    try {
      const runStore = new RunStore();
      const recommender = vi
        .fn<PrTestRecommender>()
        .mockResolvedValueOnce(recommendationResult("Initial dashboard draft"))
        .mockResolvedValueOnce(recommendationResult("Regenerated dashboard draft"));
      const app = createApp(runStore, projectStore, {
        secretStore,
        githubClient: githubClientForPrContext(),
        prTestRecommender: recommender
      });
      const createdProject = await request(app).post("/api/projects").send({
        name: "Admin",
        deploymentUrl: "preview.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      });
      await request(app)
        .patch(`/api/projects/${createdProject.body.project.id}/pr-automation`)
        .send({
          enabled: true,
          githubOwner: "acme",
          githubRepo: "app",
          githubInstallationId: "123",
          selectedTestIds: [],
          previewWaitTimeoutSeconds: 0,
          vercelProjectId: "prj_123",
          vercelApiToken: "vercel-token"
        });
      await sendPullRequestWebhook(app, {
        action: "opened",
        installation: { id: 123 },
        repository: { name: "app", full_name: "acme/app", owner: { login: "acme" } },
        pull_request: {
          number: 9,
          draft: false,
          head: { ref: "feature", sha: "head123" }
        }
      });
      expect(await waitFor(() => runStore.listPrRuns()[0]?.recommendationStatus === "ready")).toBe(true);
      const prRun = runStore.listPrRuns()[0];
      const firstSet = await projectStore.getActivePrTestRecommendationSetForRun(prRun);
      expect(firstSet?.drafts[0].title).toBe("Initial dashboard draft");

      const regenerated = await request(app).post(`/api/pr-runs/${prRun.id}/test-drafts/generate`).send({});

      expect(regenerated.status).toBe(202);
      expect(regenerated.body.recommendationSet.drafts[0].title).toBe("Regenerated dashboard draft");
      expect(await projectStore.getPrTestRecommendationSet(firstSet?.id || "")).toMatchObject({ status: "superseded" });

      const draftId = regenerated.body.recommendationSet.drafts[0].id as string;
      const promoted = await request(app).post(`/api/pr-test-drafts/${draftId}/promote`).send({});

      expect(promoted.status).toBe(201);
      expect(promoted.body.test).toMatchObject({
        title: "Regenerated dashboard draft",
        sourcePrompt: "Open dashboard and verify the regenerated flow."
      });
      const project = await projectStore.getProject(createdProject.body.project.id);
      expect(project?.prAutomation.selectedTestIds).toEqual([]);
      expect((await projectStore.listTests(createdProject.body.project.id)).map((test) => test.title)).toContain("Regenerated dashboard draft");

      const dismissed = await request(app).post(`/api/pr-test-drafts/${draftId}/dismiss`).send({});

      expect(dismissed.status).toBe(200);
      expect(dismissed.body.recommendationSet.drafts[0]).toMatchObject({
        id: draftId,
        status: "dismissed"
      });
    } finally {
      await cleanup();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function tempProjectStore(): Promise<{ store: ProjectStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-smoke-api-project-store-"));
  return {
    store: new ProjectStore(path.join(dir, "data.json")),
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

async function tempStores(): Promise<{ store: ProjectStore; secretStore: SecretStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-smoke-api-stores-"));
  return {
    store: new ProjectStore(path.join(dir, "data.json")),
    secretStore: new SecretStore(path.join(dir, "secrets.json"), path.join(dir, "secrets.key")),
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function decodeSessionCookiePayload(cookie: string): Record<string, unknown> {
  const value = decodeURIComponent(cookie.split("=")[1] || "");
  const [payload] = value.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function emptyVercelCliRunner(): Promise<{ stdout: string; stderr: string }> {
  return jsonCliResponse({ teams: [], projects: [] });
}

function jsonCliResponse(body: unknown): { stdout: string; stderr: string } {
  return { stdout: `Fetching Vercel data\n${JSON.stringify(body)}`, stderr: "" };
}

async function sendPullRequestWebhook(app: ReturnType<typeof createApp>, payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
  return request(app)
    .post("/api/github/webhook")
    .set("x-github-event", "pull_request")
    .set("x-hub-signature-256", signature)
    .set("content-type", "application/json")
    .send(body);
}

function githubClientForPrContext(): GitHubAppClient {
  return new GitHubAppClient(
    { appId: "1", privateKey: "test-key", webhookSecret: "webhook-secret" },
    () =>
      ({
        checks: {
          create: vi.fn(async () => ({ data: { id: 42, html_url: "https://github.com/checks/42" } })),
          update: vi.fn(async () => ({ data: {} }))
        },
        issues: {
          listComments: vi.fn(async () => ({ data: [] })),
          createComment: vi.fn(async () => ({ data: { id: 7, html_url: "https://github.com/acme/app/pull/5#issuecomment-7" } })),
          updateComment: vi.fn()
        },
        pulls: {
          get: vi.fn(async () => ({
            data: {
              title: "Improve dashboard metrics",
              body: "Adds campaign metrics to the dashboard.",
              html_url: "https://github.com/acme/app/pull/9",
              base: { ref: "main", sha: "base123" },
              head: { ref: "feature", sha: "head123" }
            }
          })),
          listFiles: vi.fn()
        },
        paginate: vi.fn(async () => [
          {
            filename: "src/app/dashboard/page.tsx",
            status: "modified",
            additions: 20,
            deletions: 3,
            patch: "@@ dashboard metric patch"
          }
        ]),
        repos: {
          getContent: vi.fn(async ({ path }: { path: string }) => ({
            data: {
              type: "file",
              content: Buffer.from(`content for ${path}`).toString("base64"),
              encoding: "base64"
            }
          }))
        }
      }) as never,
    async () => "token"
  );
}

function recommendationResult(title: string) {
  return {
    source: "fallback" as const,
    summary: `Recommended ${title}.`,
    drafts: [
      {
        title,
        rationale: "The PR changes dashboard metric rendering.",
        priority: "medium" as const,
        impactedFiles: ["src/app/dashboard/page.tsx"],
        accessTags: [],
        runnable: true,
        sourcePrompt: title.startsWith("Regenerated")
          ? "Open dashboard and verify the regenerated flow."
          : "Open dashboard and verify the initial flow.",
        steps: [{ id: "step-1", type: "assert" as const, title: "Metric", detail: "Confirm the dashboard metric is visible." }]
      }
    ]
  };
}
