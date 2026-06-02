import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/src/App";
import type {
  IntegrationStatus,
  PrAutomationRun,
  PrTestRecommendationSet,
  Project,
  PublicQaRun,
  ReusableTestStep,
  TestDefinition
} from "../src/client/src/types";

describe("App", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new MapStorage()
    });
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    document.documentElement.removeAttribute("style");
    window.history.replaceState(null, "", "/app");
    installDefaultFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders the Test Factory public homepage at the root route", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    expect(screen.getByRole("heading", { name: "Test Factory" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Test Factory.*logo/i })).toHaveLength(2);
    expect(screen.getByText(/AI-assisted smoke checks for preview deployments/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Test Factory product preview")).toHaveTextContent("Smoke Test - Checkout");
    expect(screen.getByLabelText("Example run metrics")).toHaveTextContent("87");
    expect(screen.getByLabelText("Example run log")).toHaveTextContent("Payment button missing expected label");
    expect(screen.getByRole("heading", { name: /browser QA operator/i })).toBeInTheDocument();
    expect(screen.getByText(/GitHub App PR automation/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Homepage footer")).toHaveTextContent("Private beta");
    expect(screen.getByLabelText("Homepage footer")).toHaveTextContent("Contact details pending");
    expect(screen.queryByLabelText("QA prompt")).not.toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Login");
    expect(links[0]).toHaveAttribute("href", "/login");
  });

  it("switches the public product preview tabs", async () => {
    window.history.replaceState(null, "", "/");
    const user = userEvent.setup();

    render(<App />);

    const runTab = screen.getByRole("tab", { name: "Run 042" });
    const reportTab = screen.getByRole("tab", { name: "Report" });
    const logsTab = screen.getByRole("tab", { name: "Logs" });

    expect(runTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Smoke Test - Checkout")).toBeInTheDocument();

    await user.click(reportTab);

    expect(reportTab).toHaveAttribute("aria-selected", "true");
    expect(runTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Report Needs Review")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed test rows")).toHaveTextContent("/checkout/payment");
    expect(screen.getByText(/Do not ship until checkout CTA is confirmed/i)).toBeInTheDocument();

    await user.click(logsTab);

    expect(logsTab).toHaveAttribute("aria-selected", "true");
    expect(reportTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Terminal Receipt")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent execution log")).toHaveTextContent("GitHub check updated");
    expect(screen.getByLabelText("Log environment metadata")).toHaveTextContent("Claude browser agent");
  });

  it("shows owner login at /login and enters the app after sign-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    window.history.replaceState(null, "", "/login");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return jsonResponse({ authEnabled: true, configured: true, authenticated: false });
      }
      if (url === "/api/auth/login" && init?.method === "POST") {
        return jsonResponse({ authEnabled: true, configured: true, authenticated: true });
      }
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.type(await screen.findByLabelText("Owner password"), "owner-pass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/app"));
    expect(await screen.findByRole("button", { name: /dashboard/i })).toHaveClass("active");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
  });

  it("renders the smoke run setup controls", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Test Factory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /runs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /visuals/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reports/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current project")).toHaveTextContent("No project selected");
    expect(screen.getByRole("heading", { name: /run a smoke check/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Settings name")).toBeInTheDocument();
    expect(screen.getByLabelText("Saved settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Deployment URL")).toBeInTheDocument();
    expect(screen.getByLabelText("QA prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run smoke check/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Run health")).toHaveTextContent("Latest run");
    expect(screen.getByLabelText("Run health")).toHaveTextContent("Warnings");
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
  });

  it("keeps the Test Factory visual tokens out of generic blue SaaS styling", () => {
    const css = readFileSync("src/client/src/styles.css", "utf8");

    expect(css).toContain("--color-charcoal: #181818");
    expect(css).toContain("--color-paper: #dad4ce");
    expect(css).toContain("--color-brand-red: #c2442d");
    expect(css).toContain("--color-brand-green: #0e5a3e");
    expect(css).toContain("linear-gradient(var(--line-soft) 1px, transparent 1px)");
    expect(css).not.toMatch(/#2563eb|#60a5fa|generic SaaS/i);
  });

  it("does not expose the legacy public brand in frontend source", () => {
    const legacyName = ["QA", "Farm"].join(" ");
    const frontendSource = [
      readFileSync("src/client/index.html", "utf8"),
      readFileSync("src/client/src/App.tsx", "utf8"),
      readFileSync("src/client/src/styles.css", "utf8")
    ].join("\n");

    expect(frontendSource).not.toContain(legacyName);
    expect(frontendSource).not.toContain("qa-farm");
  });

  it("defaults first-run theme preference to light", async () => {
    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(window.localStorage.getItem("qa-smoke.theme.v1")).toBe("light");
  });

  it("persists an explicit dark theme preference", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /dark/i }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(window.localStorage.getItem("qa-smoke.theme.v1")).toBe("dark");
  });

  it("resolves an explicit system theme from prefers-color-scheme", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => mockMediaQueryList(true)));
    window.localStorage.setItem("qa-smoke.theme.v1", "system");

    render(<App />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });

  it("automatically loads saved settings when selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Settings name"), "Admin smoke");
    await user.type(screen.getByLabelText("GitHub repo"), "https://github.com/Asymmetric-al/core");
    await user.type(screen.getByLabelText("Deployment URL"), "admin.asymmetric.al");
    await user.type(screen.getByLabelText("Username"), "admin@givehope.test");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(screen.getByText('Saved "Admin smoke".')).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Deployment URL"));
    expect(screen.getByLabelText("Saved settings")).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Saved settings"), "admin-smoke");

    expect(screen.getByLabelText("Deployment URL")).toHaveValue("admin.asymmetric.al");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^load$/i })).not.toBeInTheDocument();
  });

  it("shows a copyable fix-it prompt on failed reports", async () => {
    const user = userEvent.setup();
    const failedRun = failedRunPayload();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") return jsonResponse({ projects: [] });
        if (url === "/api/runs" && init?.method === "POST") return jsonResponse({ run: failedRun });
        if (url === "/api/runs/run-1") return jsonResponse({ run: failedRun });
        return jsonResponse({ run: failedRun });
      })
    );

    render(<App />);

    await user.type(screen.getByLabelText("Deployment URL"), "preview.example.com");
    await user.click(screen.getByRole("button", { name: /run smoke check/i }));

    const prompt = await screen.findByLabelText("Fix-it prompt");
    expect((prompt as HTMLTextAreaElement).value).toContain("Fix the failing dashboard loader");
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.getByTitle("Open repository")).toHaveAttribute("href", "https://github.com/acme/app");
  });

  it("creates a project, generates and saves a reusable test, then starts a saved run", async () => {
    const user = userEvent.setup();
    const run = savedRunPayload();
    const project = projectPayload({ githubRepo: "" });
    const plannedSteps: ReusableTestStep[] = [
      { id: "step-1", type: "act", title: "Open dashboard", detail: "Open the dashboard." },
      { id: "step-2", type: "assert", title: "Confirm dashboard", detail: "Confirm dashboard heading is visible." }
    ];
    let projects: Project[] = [];
    let tests: TestDefinition[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects });
      if (url === "/api/projects" && method === "POST") {
        projects = [project];
        return jsonResponse({ project }, 201);
      }
      if (url === "/api/projects/project-1/tests" && method === "GET") return jsonResponse({ tests });
      if (url === "/api/projects/project-1/tests/plan" && method === "POST") {
        return jsonResponse({ source: "fallback", steps: plannedSteps });
      }
      if (url === "/api/projects/project-1/tests" && method === "POST") {
        tests = [
          {
            id: "test-1",
            projectId: "project-1",
            title: "Dashboard smoke",
            description: "",
            sourcePrompt: "Open dashboard and confirm dashboard heading.",
            steps: plannedSteps,
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:00:00.000Z"
          }
        ];
        return jsonResponse({ test: tests[0] }, 201);
      }
      if (url === "/api/tests/test-1/runs" && method === "POST") return jsonResponse({ run }, 202);
      if (url === "/api/runs/run-saved") return jsonResponse({ run });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /runs/i }));

    await user.type(screen.getByLabelText("Project name"), "Admin");
    await user.type(screen.getByLabelText("Project URL"), "admin.example.com");
    await user.click(screen.getByRole("button", { name: /create project/i }));

    expect(await screen.findByText('Created "Admin".')).toBeInTheDocument();
    expect(screen.getByLabelText("Current project")).toHaveTextContent("Admin");

    await user.type(screen.getByLabelText("Test title"), "Dashboard smoke");
    await user.clear(screen.getByLabelText("Source prompt"));
    await user.type(screen.getByLabelText("Source prompt"), "Open dashboard and confirm dashboard heading.");
    await user.click(screen.getByRole("button", { name: /generate steps/i }));

    expect(await screen.findByDisplayValue("Open dashboard")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create test/i }));
    expect(await screen.findByText('Created "Dashboard smoke".')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /run saved test/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tests/test-1/runs", expect.objectContaining({ method: "POST" })));
    expect(screen.getByRole("button", { name: /dashboard/i })).toHaveClass("active");
  });

  it("configures PR preview automation and reruns a recent PR check", async () => {
    const user = userEvent.setup();
    const project = projectPayload();
    const tests: TestDefinition[] = [
      {
        id: "test-1",
        projectId: "project-1",
        title: "Dashboard smoke",
        description: "",
        sourcePrompt: "Open dashboard and confirm heading.",
        steps: [{ id: "step-1", type: "assert", title: "Dashboard", detail: "Confirm dashboard." }],
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z"
      }
    ];
    const prRun: PrAutomationRun = {
      id: "pr-run-1",
      projectId: "project-1",
      githubOwner: "acme",
      githubRepo: "app",
      prNumber: 7,
      headSha: "abc123",
      branch: "feature",
      status: "passed",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:01.000Z",
      testIds: ["test-1"],
      runIds: ["run-1"],
      previewUrl: "https://preview.example.com",
      githubWritebackError: "Could not post or update the GitHub PR comment. HTTP 403: Resource not accessible by integration"
    };
    let savedPayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/integrations/status") {
        return jsonResponse(integrationStatusPayload({
          githubAppConfigured: true,
          githubWebhookSecretConfigured: true,
          githubInstallFlowConfigured: true,
          publicUrlConfigured: true,
          publicUrl: "https://qa-smoke.example.com",
          githubInstallUrl: "https://github.com/apps/qa-smoke/installations/new",
          githubSetupUrl: "https://qa-smoke.example.com/api/github/setup",
          githubWebhookUrl: "https://qa-smoke.example.com/api/github/webhook",
          githubMissingConfig: {
            appId: false,
            privateKey: false,
            webhookSecret: false,
            installUrl: false,
            publicUrl: false
          }
        }));
      }
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
      if (url === "/api/projects/project-1/tests") return jsonResponse({ tests });
      if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [prRun] });
      if (url === "/api/projects/project-1/pr-automation" && method === "PATCH") {
        savedPayload = JSON.parse(String(init?.body));
        return jsonResponse({
          project: {
            ...project,
            prAutomation: {
              ...project.prAutomation,
              ...savedPayload,
              githubInstalled: true,
              vercelConnected: true,
              bypassConfigured: true,
              vercelApiToken: undefined,
              vercelBypassSecret: undefined
            }
          }
        });
      }
      if (url === "/api/pr-runs/pr-run-1/rerun" && method === "POST") {
        return jsonResponse({ prRun: { ...prRun, id: "pr-run-2", status: "queued" } }, 202);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /admin pr previews/i })).toBeInTheDocument();
    expect(screen.getByText(/could not post or update the github pr comment/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Owner"), "acme");
    await user.type(screen.getByLabelText("Repo"), "app");
    await user.type(screen.getByLabelText("Project ID"), "prj_123");
    await user.type(screen.getByLabelText("Vercel API token"), "vercel-token");
    await user.type(screen.getByLabelText("Automation bypass secret"), "bypass-secret");
    await user.click(screen.getByLabelText(/run test factory automatically/i));
    await user.click(screen.getByLabelText(/dashboard smoke/i));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(savedPayload).toMatchObject({ enabled: true, selectedTestIds: ["test-1"] }));
    expect(savedPayload?.vercelApiToken).toBe("vercel-token");

    await user.click(screen.getByRole("button", { name: /^rerun$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/pr-runs/pr-run-1/rerun", expect.objectContaining({ method: "POST" })));
  });

  it("shows PR-aware draft tests, regenerates them, and promotes one without selecting it for automation", async () => {
    const user = userEvent.setup();
    const project = projectPayload({
      prAutomation: {
        ...projectPayload().prAutomation,
        enabled: true,
        githubOwner: "acme",
        githubRepo: "app",
        githubInstallationId: "123",
        githubInstalled: true,
        vercelProjectId: "prj_123",
        vercelConnected: true
      }
    });
    const prRun: PrAutomationRun = {
      id: "pr-run-1",
      projectId: "project-1",
      githubOwner: "acme",
      githubRepo: "app",
      prNumber: 12,
      headSha: "abc123",
      branch: "feature",
      status: "neutral",
      recommendationSetId: "set-1",
      recommendationStatus: "ready",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:01.000Z",
      testIds: [],
      runIds: []
    };
    let tests: TestDefinition[] = [];
    let activeSet = recommendationSetPayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
      if (url === "/api/projects/project-1/tests") return jsonResponse({ tests });
      if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [prRun] });
      if (url === "/api/pr-runs/pr-run-1/test-drafts" && method === "GET") return jsonResponse({ recommendationSet: activeSet });
      if (url === "/api/pr-runs/pr-run-1/test-drafts/generate" && method === "POST") {
        activeSet = recommendationSetPayload({
          id: "set-2",
          summary: "Regenerated PR-aware draft tests.",
          drafts: [
            {
              ...recommendationSetPayload().drafts[0],
              id: "draft-3",
              recommendationSetId: "set-2",
              title: "Regenerated campaign metric flow",
              priority: "medium"
            }
          ]
        });
        return jsonResponse({ recommendationSet: activeSet }, 202);
      }
      if (url === "/api/pr-test-drafts/draft-3/promote" && method === "POST") {
        const test: TestDefinition = {
          id: "test-promoted",
          projectId: "project-1",
          title: "Regenerated campaign metric flow",
          description: "Campaign metric rationale",
          sourcePrompt: "Open dashboard and verify the regenerated campaign metric.",
          steps: activeSet.drafts[0].steps,
          createdAt: "2026-05-27T00:00:02.000Z",
          updatedAt: "2026-05-27T00:00:02.000Z"
        };
        tests = [test];
        activeSet = {
          ...activeSet,
          drafts: [{ ...activeSet.drafts[0], status: "promoted", promotedTestId: test.id }]
        };
        return jsonResponse({ test, recommendationSet: activeSet }, 201);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByText("Review campaign metric flow")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getAllByText("Runnable").length).toBeGreaterThan(0);
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Privileged")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /regenerate drafts/i }));
    expect(await screen.findByText("Regenerated campaign metric flow")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/pr-runs/pr-run-1/test-drafts/generate", expect.objectContaining({ method: "POST" }));

    await user.click(screen.getByRole("button", { name: /^save test$/i }));
    expect(await screen.findByText('Saved "Regenerated campaign metric flow" to reusable tests.')).toBeInTheDocument();
    expect(screen.getByLabelText(/regenerated campaign metric flow/i)).not.toBeChecked();
  });

  it("sends current Vercel form values when verifying", async () => {
    const user = userEvent.setup();
    const project = projectPayload();
    let verifyPayload: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
      if (url === "/api/projects/project-1/tests") return jsonResponse({ tests: [] });
      if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [] });
      if (url === "/api/projects/project-1/pr-automation/vercel/verify" && method === "POST") {
        verifyPayload = JSON.parse(String(init?.body));
        return jsonResponse({
          project: {
            ...project,
            prAutomation: {
              ...project.prAutomation,
              ...verifyPayload,
              vercelApiToken: undefined,
              vercelBypassSecret: undefined,
              vercelConnected: true,
              bypassConfigured: true,
              lastVercelVerification: {
                ok: true,
                message: 'Verified Vercel project "admin".',
                at: "2026-05-28T00:00:00.000Z"
              }
            }
          }
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /admin pr previews/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Project ID"), "prj_123");
    await user.type(screen.getByLabelText("Project name"), "admin");
    await user.type(screen.getByLabelText("Team ID"), "team_123");
    await user.type(screen.getByLabelText("Team slug"), "acme");
    await user.type(screen.getByLabelText("Vercel API token"), "vercel-token");
    await user.type(screen.getByLabelText("Automation bypass secret"), "bypass-secret");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() =>
      expect(verifyPayload).toMatchObject({
        vercelProjectId: "prj_123",
        vercelProjectName: "admin",
        vercelTeamId: "team_123",
        vercelTeamSlug: "acme",
        vercelApiToken: "vercel-token",
        vercelBypassSecret: "bypass-secret"
      })
    );
  });

  it("keeps typed Vercel values visible after failed verification", async () => {
    const user = userEvent.setup();
    const project = projectPayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
      if (url === "/api/projects/project-1/tests") return jsonResponse({ tests: [] });
      if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [] });
      if (url === "/api/projects/project-1/pr-automation/vercel/verify" && method === "POST") {
        return jsonResponse({
          project: {
            ...project,
            prAutomation: {
              ...project.prAutomation,
              lastVercelVerification: {
                ok: false,
                message: "Vercel API token and project ID are required.",
                at: "2026-05-28T00:00:00.000Z"
              }
            }
          }
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /admin pr previews/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Project ID"), "prj_123");
    await user.type(screen.getByLabelText("Project name"), "admin");
    await user.type(screen.getByLabelText("Team ID"), "team_123");
    await user.type(screen.getByLabelText("Team slug"), "acme");
    await user.type(screen.getByLabelText("Vercel API token"), "vercel-token");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));

    expect(await screen.findByText("Vercel API token and project ID are required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Project ID")).toHaveValue("prj_123");
    expect(screen.getByLabelText("Project name")).toHaveValue("admin");
    expect(screen.getByLabelText("Team ID")).toHaveValue("team_123");
    expect(screen.getByLabelText("Team slug")).toHaveValue("acme");
    expect(screen.getByLabelText("Vercel API token")).toHaveValue("vercel-token");
  });

  it("lists Vercel projects and fills the selected project", async () => {
    const user = userEvent.setup();
    const project = projectPayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
      if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
      if (url === "/api/projects/project-1/tests") return jsonResponse({ tests: [] });
      if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [] });
      if (url === "/api/projects/project-1/pr-automation/vercel/projects" && method === "POST") {
        return jsonResponse({
          ok: true,
          message: "Found 2 accessible Vercel projects.",
          diagnostics: ["GET /v10/projects scoped by teamId -> HTTP 200"],
          projects: [
            { id: "prj_admin", name: "admin", productionUrl: "https://admin.asymmetric.al", teamId: "team_123", teamSlug: "asymmetric-al", source: "cli", matchedRepo: true },
            { id: "prj_other", name: "other", productionUrl: "https://other.asymmetric.al", teamId: "team_123", teamSlug: "asymmetric-al", source: "cli", matchedRepo: false }
          ],
          project: {
            ...project,
            prAutomation: {
              ...project.prAutomation,
              vercelConnected: true
            }
          }
        });
      }
      if (url === "/api/projects/project-1/pr-automation" && method === "PATCH") {
        const body = JSON.parse(String(init?.body || "{}"));
        return jsonResponse({
          project: {
            ...project,
            prAutomation: {
              ...project.prAutomation,
              vercelProjectId: body.vercelProjectId,
              vercelProjectName: body.vercelProjectName,
              vercelTeamId: body.vercelTeamId,
              vercelTeamSlug: body.vercelTeamSlug,
              vercelConnected: true
            }
          }
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /admin pr previews/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Team ID"), "team_123");
    await user.type(screen.getByLabelText("Vercel API token"), "vercel-token");
    await user.click(screen.getByRole("button", { name: /list projects/i }));

    await waitFor(() => expect(screen.getAllByText("Found 2 accessible Vercel projects.").length).toBeGreaterThan(0));
    expect(screen.getByText("Vercel token is saved.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /prj_admin/i }));

    await waitFor(() => expect(screen.getByLabelText("Project ID")).toHaveValue("prj_admin"));
    expect(screen.getByLabelText("Project name")).toHaveValue("admin");
    expect(screen.getByLabelText("Team slug")).toHaveValue("asymmetric-al");
    expect(screen.getByText('Connected Vercel project "admin".')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/pr-automation/vercel/projects",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("vercel-token") })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/pr-automation",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining("prj_admin") })
    );
  });

  it("keeps GitHub setup usable when GitHub App env is missing", async () => {
    const user = userEvent.setup();
    const project = projectPayload();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (url === "/api/integrations/status") return jsonResponse(integrationStatusPayload());
        if (url === "/api/projects" && method === "GET") return jsonResponse({ projects: [project] });
        if (url === "/api/projects/project-1/tests") return jsonResponse({ tests: [] });
        if (url === "/api/pr-runs?projectId=project-1") return jsonResponse({ prRuns: [] });
        return jsonResponse({});
      })
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: /^settings$/i }));

    const setupLink = await screen.findByRole("link", { name: /create github app/i });
    expect(setupLink).toHaveAttribute("href", "/api/github/manifest/new?projectId=project-1");
    expect(screen.getByText("GitHub setup is incomplete.")).toBeInTheDocument();
    expect(screen.getByLabelText("Missing GitHub configuration")).toHaveTextContent("GITHUB_APP_ID");
    expect(screen.queryByRole("button", { name: /connect github/i })).not.toBeInTheDocument();
  });
});

class MapStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {}

  addEventListener(): void {}

  close(): void {}
}

function installDefaultFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      return jsonResponse({});
    })
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function mockMediaQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as unknown as MediaQueryList;
}

function failedRunPayload(): PublicQaRun {
  return {
    id: "run-1",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:01.000Z",
    status: "failed",
    request: {
      githubRepo: "https://github.com/acme/app",
      deploymentUrl: "https://preview.example.com",
      smokePrompt: "Open the app and verify the dashboard loads.",
      agentMode: "browser",
      maxActions: 8,
      hasCredentials: false
    },
    steps: [{ id: "step-1", title: "Healthy dashboard", detail: "Confirm dashboard loads.", status: "failed" }],
    events: [],
    report: {
      outcome: "failed",
      summary: "Smoke run failed before completing the prompted flow.",
      errors: ["Visible UI shows a problem state."],
      repairBrief: "Use the generated prompt for the repo agent.",
      fixPrompt: {
        text: "Fix the failing dashboard loader, add regression coverage, and run the focused verification.",
        source: "claude",
        model: "claude-sonnet-4-20250514",
        repoUrl: "https://github.com/acme/app",
        repoContextSummary: "Included 2 public GitHub repo files from acme/app.",
        warnings: []
      }
    }
  };
}

function savedRunPayload(): PublicQaRun {
  return {
    id: "run-saved",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    status: "queued",
    request: {
      githubRepo: "",
      deploymentUrl: "https://admin.example.com",
      smokePrompt: "Open dashboard and confirm dashboard heading.",
      agentMode: "demo",
      maxActions: 4,
      projectId: "project-1",
      testId: "test-1",
      testTitle: "Dashboard smoke",
      hasCredentials: false
    },
    steps: [
      { id: "step-1", title: "Open dashboard", detail: "Open the dashboard.", status: "pending" },
      { id: "step-2", title: "Confirm dashboard", detail: "Confirm dashboard heading is visible.", status: "pending" }
    ],
    events: []
  };
}

function integrationStatusPayload(overrides: Partial<IntegrationStatus> = {}): IntegrationStatus {
  return {
    githubAppConfigured: false,
    githubWebhookSecretConfigured: false,
    githubInstallFlowConfigured: false,
    publicUrlConfigured: false,
    publicUrl: "",
    githubInstallUrl: "",
    githubSetupUrl: "http://localhost:4317/api/github/setup",
    githubWebhookUrl: "http://localhost:4317/api/github/webhook",
    githubManifestFlowSupported: true,
    githubMissingConfig: {
      appId: true,
      privateKey: true,
      webhookSecret: true,
      installUrl: true,
      publicUrl: true
    },
    vercelManualConnection: true,
    ...overrides
  };
}

function recommendationSetPayload(overrides: Partial<PrTestRecommendationSet> = {}): PrTestRecommendationSet {
  return {
    id: "set-1",
    projectId: "project-1",
    githubOwner: "acme",
    githubRepo: "app",
    prNumber: 12,
    prTitle: "Improve campaign metrics",
    prUrl: "https://github.com/acme/app/pull/12",
    branch: "feature",
    baseSha: "base123",
    headSha: "abc123",
    status: "ready",
    summary: "Generated PR-aware draft tests.",
    changedFiles: ["src/app/dashboard/page.tsx", "src/app/admin/billing/page.tsx"],
    source: "claude",
    model: "claude-sonnet-4-20250514",
    drafts: [
      {
        id: "draft-1",
        recommendationSetId: "set-1",
        projectId: "project-1",
        title: "Review campaign metric flow",
        rationale: "The PR changes the dashboard campaign metric.",
        priority: "high",
        impactedFiles: ["src/app/dashboard/page.tsx"],
        accessTags: [],
        runnable: true,
        sourcePrompt: "Open dashboard and verify the campaign metric.",
        steps: [{ id: "step-1", type: "assert", title: "Metric", detail: "Confirm campaign metric is visible." }],
        status: "draft",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z"
      },
      {
        id: "draft-2",
        recommendationSetId: "set-1",
        projectId: "project-1",
        title: "Admin billing settings flow",
        rationale: "The PR changes billing-role behavior.",
        priority: "critical",
        impactedFiles: ["src/app/admin/billing/page.tsx"],
        accessTags: ["privileged", "billing"],
        runnable: true,
        manualReason: "Requires privileged billing credentials.",
        sourcePrompt: "Sign in as a billing admin and verify settings.",
        steps: [{ id: "step-1", type: "login", title: "Sign in", detail: "Sign in as a billing admin." }],
        status: "draft",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z"
      }
    ],
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...overrides
  };
}

function projectPayload(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Admin",
    deploymentUrl: "https://admin.example.com",
    githubRepo: "https://github.com/acme/app",
    defaultAgentMode: "demo",
    defaultMaxActions: 4,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    prAutomation: {
      enabled: false,
      githubOwner: "",
      githubRepo: "",
      githubInstallationId: "",
      githubInstalled: false,
      selectedTestIds: [],
      previewWaitTimeoutSeconds: 120,
      vercelProjectId: "",
      vercelProjectName: "",
      vercelTeamId: "",
      vercelTeamSlug: "",
      vercelConnected: false,
      bypassConfigured: false
    },
    ...overrides
  };
}
