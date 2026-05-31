import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyProblemsForReport, executeQaRun, formatRunError } from "../src/server/browserAgent";
import type { AgentAction, ClaudeActionDecision } from "../src/server/claudeAgent";
import { RunStore } from "../src/server/runStore";
import type { RunRequest, SmokeStep } from "../src/server/types";

const claudeMocks = vi.hoisted(() => ({
  chooseClaudeAction: vi.fn()
}));

vi.mock("../src/server/claudeAgent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/claudeAgent")>();
  return {
    ...actual,
    chooseClaudeAction: claudeMocks.chooseClaudeAction
  };
});

describe("formatRunError", () => {
  it("explains how to fix a missing Playwright browser", () => {
    const message = formatRunError(
      new Error("browserType.launch: Executable doesn't exist at /Users/example/chrome-headless-shell")
    );

    expect(message).toContain("Playwright Chromium is not installed");
    expect(message).toContain("npm run install:browsers");
  });

  it("redacts Playwright fill call logs before showing them in reports", () => {
    const message = formatRunError(
      new Error('\u001b[2m - fill("admin@givehope.test")\u001b[22m waiting for element to be editable')
    );

    expect(message).not.toContain("\u001b");
    expect(message).not.toContain("admin@givehope.test");
    expect(message).toContain('fill("[redacted]")');
  });

  it("summarizes overlay click interception instead of showing raw Playwright call logs", () => {
    const message = formatRunError(
      new Error(
        'locator.click: Timeout 8000ms exceeded. Call log: - waiting for locator(\'[data-qa-smoke-observed-index="26"]\') - <div data-slot="dialog-overlay"></div> intercepts pointer events'
      )
    );

    expect(message).toContain("blocked by another visible element");
    expect(message).not.toContain("locator.click");
    expect(message).not.toContain("<div");
  });
});

describe("classifyProblemsForReport", () => {
  it("downgrades third-party Sentry telemetry aborts to warnings", () => {
    const classified = classifyProblemsForReport(
      [
        {
          type: "requestfailed",
          message:
            "POST https://o4511371503403008.ingest.us.sentry.io/api/4511371510022144/envelope/?sentry_version=7 net::ERR_ABORTED"
        }
      ],
      [],
      "https://admin.asymmetric.al"
    );

    expect(classified.fatalProblems).toEqual([]);
    expect(classified.warningProblems).toHaveLength(1);
  });

  it("keeps same-origin request failures fatal", () => {
    const classified = classifyProblemsForReport(
      [
        {
          type: "requestfailed",
          message: "POST https://admin.asymmetric.al/api/session net::ERR_FAILED"
        }
      ],
      [],
      "https://admin.asymmetric.al"
    );

    expect(classified.fatalProblems.map((problem) => problem.message).join("\n")).toContain("/api/session");
    expect(classified.warningProblems).toEqual([]);
  });
});

describe("executeQaRun", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    claudeMocks.chooseClaudeAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Claude actions to navigate, log in, click the menu, and assert the page is healthy", async () => {
    const target = await startTargetServer();
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "fillCredential", elementIndex: 0, credential: "username", reason: "Fill the username field." },
        { action: "fillCredential", elementIndex: 1, credential: "password", reason: "Fill the password field." },
        { action: "click", elementIndex: 2, reason: "Submit the login form." },
        { action: "done", reason: "The dashboard is visible." },
        { action: "click", elementIndex: 0, reason: "Open the visible menu." },
        { action: "done", reason: "The menu is open." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), baseSteps());

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("passed");
      expect(completed?.events.some((event) => /Claude selected click/.test(event.message))).toBe(true);
      expect(completed?.events.some((event) => /Claude action completed: Clicked button/.test(event.message))).toBe(true);
      expect(JSON.stringify(completed?.events)).not.toContain("password1");
      expect(JSON.stringify(completed?.events)).not.toContain("admin@givehope.test");
    } finally {
      await target.close();
    }
  }, 20000);

  it("rejects fillCredential on non-fillable elements and asks Claude to retry", async () => {
    const target = await startTargetServer({ leadingLink: true });
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "fillCredential", elementIndex: 0, credential: "username", reason: "Mistakenly use the home link." },
        { action: "fillCredential", elementIndex: 1, credential: "username", reason: "Use the email field." },
        { action: "fillCredential", elementIndex: 2, credential: "password", reason: "Use the password field." },
        { action: "click", elementIndex: 3, reason: "Submit the login form." },
        { action: "done", reason: "The dashboard is visible." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), [
        { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
        { id: "step-2", title: "Log in", detail: "Log in with the provided QA credentials.", status: "pending" },
        { id: "step-3", title: "Healthy dashboard", detail: "Confirm no visible error banners or broken UI.", status: "pending" }
      ]);

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("passed");
      expect(completed?.events.some((event) => /Rejected Claude action/.test(event.message))).toBe(true);
      expect(completed?.events.map((event) => event.message).join("\n")).toContain("is not fillable");
      expect(completed?.report?.errors.join("\n") || "").not.toContain("locator.fill");
    } finally {
      await target.close();
    }
  }, 20000);

  it("rejects clicks blocked by an open modal overlay and asks Claude to retry", async () => {
    const target = await startOverlayServer();
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "click", elementIndex: 0, reason: "Mistakenly click the covered New Mission Task button." },
        { action: "click", elementIndex: 1, reason: "Click the visible dialog button instead." },
        { action: "done", reason: "The dialog action completed." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(
        { ...baseRequest(target.url), credentials: undefined },
        [
          { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
          { id: "step-2", title: "Use dialog", detail: "Click the active dialog control.", status: "pending" },
          { id: "step-3", title: "Healthy dialog", detail: "Confirm no visible error banners or broken UI.", status: "pending" }
        ]
      );

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("passed");
      expect(completed?.events.some((event) => /Rejected Claude action/.test(event.message))).toBe(true);
      expect(completed?.events.map((event) => event.message).join("\n")).toContain("blocked by another element");
      expect(completed?.report?.errors.join("\n") || "").not.toContain("locator.click");
    } finally {
      await target.close();
    }
  }, 20000);

  it("does not fail no-error checks for ordinary dashboard labels that contain error or failed", async () => {
    const target = await startTargetServer({
      dashboardContent: `
        <section>
          <h2>Operations glossary</h2>
          <p>Failed contribution review is a normal report label.</p>
          <p>Error budget is a saved finance view, not a runtime banner.</p>
        </section>`
    });
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "fillCredential", elementIndex: 0, credential: "username", reason: "Fill the username field." },
        { action: "fillCredential", elementIndex: 1, credential: "password", reason: "Fill the password field." },
        { action: "click", elementIndex: 2, reason: "Submit the login form." },
        { action: "done", reason: "The dashboard is visible." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), healthCheckSteps());

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("passed");
      expect(completed?.report?.errors).toEqual([]);
    } finally {
      await target.close();
    }
  }, 20000);

  it("fails no-error checks when an actual visible problem surface appears", async () => {
    const target = await startTargetServer({
      dashboardContent: '<div role="alert">Failed to load contributions. Try again.</div>'
    });
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "fillCredential", elementIndex: 0, credential: "username", reason: "Fill the username field." },
        { action: "fillCredential", elementIndex: 1, credential: "password", reason: "Fill the password field." },
        { action: "click", elementIndex: 2, reason: "Submit the login form." },
        { action: "done", reason: "The dashboard is visible." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), healthCheckSteps());

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("Failed to load contributions");
      expect(completed?.report?.fixPrompt?.source).toBe("fallback");
      expect(completed?.report?.fixPrompt?.text).toContain("Fix this QA smoke failure end to end.");
      expect(completed?.steps.some((step) => step.status === "failed")).toBe(true);
    } finally {
      await target.close();
    }
  }, 20000);

  it("fails no-error checks when plain body text reports invalid credentials", async () => {
    const target = await startStaticServer("<main><h1>Sign in</h1><p>Invalid login credentials</p></main>");
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "assertNoVisibleProblem", reason: "Check for visible problem surfaces." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), [
        { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
        { id: "step-2", title: "Healthy sign-in", detail: "Confirm no visible error banners or broken UI.", status: "pending" }
      ]);

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("Invalid login credentials");
    } finally {
      await target.close();
    }
  }, 20000);

  it("stops immediately when a login click exposes an invalid credential message", async () => {
    const target = await startTargetServer({ loginCompletes: false, failedLoginMessage: "Invalid login credentials" });
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "fillCredential", elementIndex: 0, credential: "username", reason: "Fill the username field." },
        { action: "fillCredential", elementIndex: 1, credential: "password", reason: "Fill the password field." },
        { action: "click", elementIndex: 2, reason: "Submit the login form." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), [
        { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
        { id: "step-2", title: "Submit login", detail: "Log in with the provided QA credentials.", status: "pending" }
      ]);

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.steps[1].status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("Invalid login credentials");
    } finally {
      await target.close();
    }
  }, 20000);

  it("fails loudly when Claude action selection fails instead of using a local heuristic fallback", async () => {
    const target = await startTargetServer();
    try {
      claudeMocks.chooseClaudeAction.mockRejectedValueOnce(new Error("Claude API unavailable"));
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), baseSteps());

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("Claude API unavailable");
      expect(completed?.events.some((event) => /Clicked matching control/.test(event.message))).toBe(false);
    } finally {
      await target.close();
    }
  }, 20000);

  it("fails when Claude chooses an element index that is not in the current observation", async () => {
    const target = await startTargetServer();
    try {
      queueClaudeActions([{ action: "click", elementIndex: 99, reason: "Click a missing control." }]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), [baseSteps()[0]]);

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("Claude chose missing element index 99");
    } finally {
      await target.close();
    }
  }, 20000);

  it("does not let Claude satisfy a positive step with visible problem text", async () => {
    const target = await startStaticServer("<main><h1>Sign in</h1><p>Invalid login credentials</p></main>");
    try {
      queueClaudeActions([
        { action: "navigate", url: "deployment", reason: "Open the target app." },
        { action: "assertText", expectedText: "Invalid login credentials", reason: "This proves the dashboard did not load." }
      ]);
      const store = new RunStore();
      const run = store.create(baseRequest(target.url), [
        { id: "step-1", title: "Open app", detail: "Navigate to the deployment and verify the error message is displayed.", status: "pending" },
        { id: "step-2", title: "Verify dashboard", detail: "Confirm Mission Control dashboard loads.", status: "pending" }
      ]);

      await executeQaRun(run, store);

      const completed = store.get(run.id);
      expect(completed?.status).toBe("failed");
      expect(completed?.steps[1].status).toBe("failed");
      expect(completed?.report?.errors.join("\n")).toContain("positive step with problem text");
    } finally {
      await target.close();
    }
  }, 20000);

  it("sends Vercel protection bypass headers when a bypass secret is provided", async () => {
    const target = await startHeaderRecordingServer();
    try {
      queueClaudeActions([{ action: "navigate", url: "deployment", reason: "Open the protected preview." }]);
      const store = new RunStore();
      const run = store.create(
        { ...baseRequest(target.url), credentials: undefined, maxActions: 2 },
        [{ id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" }]
      );

      await executeQaRun(run, store, { vercelProtectionBypassSecret: "bypass-secret" });

      expect(store.get(run.id)?.status).toBe("passed");
      expect(target.headers["x-vercel-protection-bypass"]).toBe("bypass-secret");
      expect(target.headers["x-vercel-set-bypass-cookie"]).toBe("true");
      expect(JSON.stringify(store.getPublic(run.id))).not.toContain("bypass-secret");
    } finally {
      await target.close();
    }
  });
});

function queueClaudeActions(actions: AgentAction[]): void {
  const queued = [...actions];
  claudeMocks.chooseClaudeAction.mockImplementation(async () => {
    const action = queued.shift();
    if (!action) throw new Error("No queued Claude action.");
    return {
      action,
      model: "claude-sonnet-4-20250514",
      tokenUsage: { input_tokens: 10, output_tokens: 5 }
    } satisfies ClaudeActionDecision;
  });
}

function baseRequest(deploymentUrl: string): RunRequest {
  return {
    githubRepo: "",
    deploymentUrl,
    credentials: { username: "admin@givehope.test", password: "password1" },
    smokePrompt: "Log in, click through the menu, and confirm the dashboard is healthy.",
    agentMode: "browser",
    maxActions: 8
  };
}

function baseSteps(): SmokeStep[] {
  return [
    { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
    { id: "step-2", title: "Log in", detail: "Log in with the provided QA credentials.", status: "pending" },
    { id: "step-3", title: "Open menu", detail: "Click through the menu.", status: "pending" },
    { id: "step-4", title: "Healthy dashboard", detail: "Confirm no visible error banners or broken UI.", status: "pending" }
  ];
}

function healthCheckSteps(): SmokeStep[] {
  const steps = baseSteps();
  return [steps[0], steps[1], steps[3]];
}

async function startTargetServer(
  options: { dashboardContent?: string; loginCompletes?: boolean; failedLoginMessage?: string; leadingLink?: boolean } = {}
): Promise<{ url: string; close: () => Promise<void> }> {
  const loginCompletes = options.loginCompletes !== false;
  const dashboardContent = options.dashboardContent || "";
  const failedLoginMessage = options.failedLoginMessage || "";
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html>
      <html>
        <head><title>QA target</title></head>
        <body>
          ${options.leadingLink ? '<a href="/">Home</a>' : ""}
          <main id="login">
            <h1>Admin sign in</h1>
            <label>Email <input name="email" type="email" autocomplete="username"></label>
            <label>Password <input name="password" type="password" autocomplete="current-password"></label>
            <button type="button" id="login-button">Log in</button>
            <p id="login-error" role="alert" hidden>${failedLoginMessage}</p>
          </main>
          <main id="app" hidden>
            <h1>Admin dashboard</h1>
            <button type="button" id="menu-button">Menu</button>
            <nav id="menu" hidden>
              <a href="#dashboard">Dashboard</a>
              <a href="#reports">Reports</a>
            </nav>
            ${dashboardContent}
          </main>
          <script>
            document.querySelector("#login-button").addEventListener("click", () => {
              if (${JSON.stringify(loginCompletes)}) {
                document.querySelector("#login").hidden = true;
                document.querySelector("#app").hidden = false;
              } else {
                document.querySelector("#login-error").hidden = false;
              }
            });
            document.querySelector("#menu-button").addEventListener("click", () => {
              document.querySelector("#menu").hidden = false;
            });
          </script>
        </body>
      </html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start target server.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startStaticServer(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><title>Static target</title></head><body>${body}</body></html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start target server.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startHeaderRecordingServer(): Promise<{ url: string; headers: Record<string, string | undefined>; close: () => Promise<void> }> {
  const headers: Record<string, string | undefined> = {};
  const server = createServer((request, response) => {
    headers["x-vercel-protection-bypass"] = request.headers["x-vercel-protection-bypass"] as string | undefined;
    headers["x-vercel-set-bypass-cookie"] = request.headers["x-vercel-set-bypass-cookie"] as string | undefined;
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><html><head><title>Protected</title></head><body><h1>Ready</h1></body></html>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start target server.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    headers,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function startOverlayServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html>
      <html>
        <head>
          <title>Overlay target</title>
          <style>
            body { font-family: sans-serif; margin: 40px; }
            #new-task { position: absolute; top: 120px; left: 120px; }
            [data-slot="dialog-overlay"] { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 10; }
            [role="dialog"] { position: fixed; top: 90px; left: 90px; z-index: 20; background: white; padding: 24px; border: 1px solid #ccc; }
          </style>
        </head>
        <body>
          <button id="new-task" type="button">New Mission Task</button>
          <div data-state="open" data-slot="dialog-overlay" aria-hidden="true"></div>
          <section role="dialog" aria-label="Task details">
            <h1>Task details</h1>
            <button id="dialog-action" type="button">Continue in dialog</button>
            <p id="status">Waiting</p>
          </section>
          <script>
            document.querySelector("#dialog-action").addEventListener("click", () => {
              document.querySelector("#status").textContent = "Modal action complete";
            });
          </script>
        </body>
      </html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start target server.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
