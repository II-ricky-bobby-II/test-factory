import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planClaudeSmokeSteps } from "../src/server/stepPlanner";
import type { RepoContext } from "../src/server/repoContext";
import type { RunRequest } from "../src/server/types";

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

describe("planClaudeSmokeSteps", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    anthropicMocks.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Claude's returned steps exactly without synthetic local steps", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            steps: [
              { title: "Open admin", detail: "Navigate to the admin deployment URL." },
              { title: "Check dashboard", detail: "Confirm the Mission Control dashboard is visible." }
            ]
          })
        }
      ],
      usage: { input_tokens: 20, output_tokens: 10 }
    });

    const plan = await planClaudeSmokeSteps(baseRequest(), repoContext());

    expect(plan.steps.map((step) => step.detail)).toEqual([
      "Navigate to the admin deployment URL.",
      "Confirm the Mission Control dashboard is visible."
    ]);
    expect(plan.diagnostics).toMatchObject({
      model: "claude-sonnet-4-20250514",
      repoContextFileCount: 1,
      tokenUsage: { input_tokens: 20, output_tokens: 10 }
    });
    expect(JSON.stringify(anthropicMocks.create.mock.calls[0])).not.toContain("secret-password");
  });

  it("fails loudly when Claude returns invalid planning JSON", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    await expect(planClaudeSmokeSteps(baseRequest(), repoContext())).rejects.toThrow(/Claude planning failed/);
  });

  it("accepts Claude JSON wrapped in a markdown code fence", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '```json\n{"steps":[{"title":"Open","detail":"Navigate to the deployment."}]}\n```'
        }
      ],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    const plan = await planClaudeSmokeSteps(baseRequest(), repoContext());

    expect(plan.steps.map((step) => step.detail)).toEqual(["Navigate to the deployment."]);
  });

  it("accepts common alternate Claude step field names", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            testSteps: [
              {
                name: "Open admin",
                instruction: "Navigate to the admin deployment URL."
              },
              {
                summary: "Verify dashboard",
                description: "Confirm the dashboard heading is visible."
              }
            ]
          })
        }
      ],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    const plan = await planClaudeSmokeSteps(baseRequest(), repoContext());

    expect(plan.steps.map((step) => step.detail)).toEqual([
      "Navigate to the admin deployment URL.",
      "Confirm the dashboard heading is visible."
    ]);
  });

  it("fails loudly when Claude is not configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    await expect(planClaudeSmokeSteps(baseRequest(), repoContext())).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(anthropicMocks.create).not.toHaveBeenCalled();
  });
});

function baseRequest(): RunRequest {
  return {
    githubRepo: "https://github.com/acme/app",
    deploymentUrl: "https://admin.example.com",
    credentials: { username: "qa@example.com", password: "secret-password" },
    smokePrompt: "Verify admin dashboard loads.",
    agentMode: "browser",
    maxActions: 8
  };
}

function repoContext(): RepoContext {
  return {
    source: "github",
    repoUrl: "https://github.com/acme/app",
    owner: "acme",
    repo: "app",
    defaultBranch: "main",
    files: [{ path: "README.md", content: "Admin dashboard app." }],
    warnings: [],
    summary: "Included 1 public GitHub repo file from acme/app."
  };
}
