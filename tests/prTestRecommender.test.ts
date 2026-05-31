import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recommendPrTestDrafts } from "../src/server/prTestRecommender";
import type { GitHubPullRequestContext } from "../src/server/githubApp";

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

describe("recommendPrTestDrafts", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    anthropicMocks.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses Claude JSON into reusable-test-compatible drafts and tags auth flows without forcing manual", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "Covers dashboard and billing settings changed by the PR.",
            drafts: [
              {
                title: "Dashboard loads new campaign metric",
                rationale: "The dashboard card was changed.",
                priority: "p1",
                impactedFiles: ["src/app/dashboard/page.tsx"],
                runnable: true,
                steps: [
                  { type: "act", title: "Open dashboard", detail: "Open the PR preview dashboard." },
                  { type: "assert", title: "Confirm metric", detail: "Verify the new campaign metric appears." }
                ]
              },
              {
                title: "Admin billing role can save invoice settings",
                rationale: "Billing settings now branch by account role.",
                priority: "critical",
                impactedFiles: ["src/app/admin/billing/page.tsx"],
                runnable: true,
                steps: [
                  { type: "login", title: "Log in", detail: "Sign in as a billing admin." },
                  { type: "assert", title: "Confirm settings", detail: "Verify invoice settings can be reviewed." }
                ]
              }
            ]
          })
        }
      ],
      usage: { input_tokens: 80, output_tokens: 45 }
    });

    const result = await recommendPrTestDrafts(request());

    expect(result.source).toBe("claude");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.tokenUsage).toEqual({ input_tokens: 80, output_tokens: 45 });
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toMatchObject({
      title: "Dashboard loads new campaign metric",
      priority: "high",
      runnable: true
    });
    expect(result.drafts[0].sourcePrompt).toContain("PR #12");
    expect(result.drafts[1]).toMatchObject({
      priority: "critical",
      runnable: true,
      accessTags: ["auth", "privileged", "billing"]
    });
    expect(result.drafts[1].manualReason).toBeUndefined();
  });

  it("fails loudly when Claude returns malformed JSON", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "not-json" }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    await expect(recommendPrTestDrafts(request())).rejects.toThrow(/Claude PR test recommendation failed/);
  });

  it("uses deterministic fallback recommendations when Claude is not configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const result = await recommendPrTestDrafts(request());

    expect(result.source).toBe("fallback");
    expect(result.warning).toContain("ANTHROPIC_API_KEY");
    expect(result.drafts[0].title).toMatch(/dashboard/i);
    expect(anthropicMocks.create).not.toHaveBeenCalled();
  });
});

function request() {
  return {
    projectName: "Admin",
    projectDeploymentUrl: "https://admin.example.com",
    githubRepo: "https://github.com/acme/app",
    pr: prContext()
  };
}

function prContext(): GitHubPullRequestContext {
  return {
    owner: "acme",
    repo: "app",
    prNumber: 12,
    title: "Add campaign metric",
    body: "Updates the admin dashboard and billing settings.",
    htmlUrl: "https://github.com/acme/app/pull/12",
    baseRef: "main",
    baseSha: "base123",
    headRef: "feature",
    headSha: "head123",
    changedFiles: [
      {
        path: "src/app/dashboard/page.tsx",
        status: "modified",
        additions: 20,
        deletions: 4,
        patch: "@@ dashboard",
        patchTruncated: false
      },
      {
        path: "src/app/admin/billing/page.tsx",
        status: "modified",
        additions: 12,
        deletions: 2,
        patch: "@@ billing",
        patchTruncated: false
      }
    ],
    repoFiles: [{ path: "src/app/dashboard/page.tsx", content: "export default function Dashboard() {}", truncated: false }],
    warnings: []
  };
}
