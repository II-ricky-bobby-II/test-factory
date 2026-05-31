import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFailureFixReport } from "../src/server/fixPrompt";
import type { RepoContext } from "../src/server/repoContext";
import { RunStore } from "../src/server/runStore";
import type { QaRun, RunReport, RunRequest, SmokeStep } from "../src/server/types";

const anthropicMocks = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: function Anthropic() {
    return {
      messages: {
        create: anthropicMocks.create
      }
    };
  }
}));

describe("createFailureFixReport", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    anthropicMocks.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks Claude for a repo-aware fix-it prompt with redacted failure evidence", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            repairBrief: "Fix the dashboard data loader and cover the failed empty-state path.",
            fixPrompt:
              "You are the repo agent. Reproduce the failed dashboard load, inspect src/app/dashboard.tsx, fix the loader, add coverage, and run the focused test suite."
          })
        }
      ],
      usage: { input_tokens: 44, output_tokens: 22 }
    });

    const run = failedRun();
    const report = await createFailureFixReport({
      run,
      report: failedReport(),
      repoContext: repoContext(),
      failureCause: "Visible UI shows a problem state.",
      observedProblems: ["visible-ui: Failed to load contributions. Try again."]
    });

    expect(report.repairBrief).toContain("dashboard data loader");
    expect(report.fixPrompt).toMatchObject({
      source: "claude",
      model: "claude-sonnet-4-20250514",
      tokenUsage: { input_tokens: 44, output_tokens: 22 }
    });
    expect(report.fixPrompt?.text).toContain("inspect src/app/dashboard.tsx");

    const request = anthropicMocks.create.mock.calls[0][0];
    const payload = request.messages[0].content as string;
    expect(payload).toContain("src/app/dashboard.tsx");
    expect(payload).toContain("Failed to load contributions");
    expect(payload).not.toContain("qa@example.com");
    expect(payload).not.toContain("password1");
  });

  it("returns an actionable fallback prompt when Claude repair analysis is unavailable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const report = await createFailureFixReport({
      run: failedRun(),
      report: failedReport(),
      repoContext: repoContext()
    });

    expect(anthropicMocks.create).not.toHaveBeenCalled();
    expect(report.fixPrompt?.source).toBe("fallback");
    expect(report.fixPrompt?.text).toContain("Fix this QA smoke failure end to end.");
    expect(report.fixPrompt?.text).toContain("Failure packet:");
    expect(report.fixPrompt?.text).not.toContain("password1");
  });

  it("falls back and records a warning when Claude returns an invalid prompt", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ repairBrief: "Too short", fixPrompt: "short" }) }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    const report = await createFailureFixReport({
      run: failedRun(),
      report: failedReport(),
      repoContext: repoContext()
    });

    expect(report.fixPrompt?.source).toBe("fallback");
    expect(report.fixPrompt?.warnings.join("\n")).toContain("Claude fix prompt generation failed");
  });
});

function failedRun(): QaRun {
  const store = new RunStore();
  const run = store.create(baseRequest(), baseSteps());
  store.setStatus(run.id, "running", "Starting Claude-driven browser agent with claude-sonnet-4-20250514.");
  store.setStep(run.id, "step-1", "passed", "Open app completed.");
  store.setStep(run.id, "step-2", "running", "Confirm no visible error banners or broken UI.");
  store.addLog(run.id, "info", "Claude selected assertNoVisibleProblem: Check for visible problem surfaces.", {
    model: "claude-sonnet-4-20250514",
    action: "assertNoVisibleProblem",
    tokenUsage: { input_tokens: 10, output_tokens: 5 }
  });
  store.setStep(run.id, "step-2", "failed", "Visible UI shows a problem state: Failed to load contributions. Try again.");
  return run;
}

function baseRequest(): RunRequest {
  return {
    githubRepo: "https://github.com/acme/app",
    deploymentUrl: "https://preview.example.com",
    credentials: { username: "qa@example.com", password: "password1" },
    smokePrompt: "Open the app and verify the dashboard loads without visible errors.",
    agentMode: "browser",
    maxActions: 8
  };
}

function baseSteps(): SmokeStep[] {
  return [
    { id: "step-1", title: "Open app", detail: "Navigate to the deployment URL.", status: "pending" },
    { id: "step-2", title: "Healthy dashboard", detail: "Confirm no visible error banners or broken UI.", status: "pending" }
  ];
}

function failedReport(): RunReport {
  return {
    outcome: "failed",
    summary: "Smoke run failed before completing the prompted flow.",
    errors: ["Visible UI shows a problem state: Failed to load contributions. Try again."],
    repairBrief: "Inspect the failed Claude action, browser screenshot, event log, redirect, or credential state."
  };
}

function repoContext(): RepoContext {
  return {
    source: "github",
    repoUrl: "https://github.com/acme/app",
    owner: "acme",
    repo: "app",
    defaultBranch: "main",
    files: [
      {
        path: "src/app/dashboard.tsx",
        content: "export function Dashboard() { return <ContributionList />; }"
      },
      {
        path: "src/app/contributions.ts",
        content: "export async function loadContributions() { return fetch('/api/contributions'); }"
      }
    ],
    warnings: [],
    summary: "Included 2 public GitHub repo files from acme/app."
  };
}
