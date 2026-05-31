import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseClaudeAction } from "../src/server/claudeAgent";

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

describe("chooseClaudeAction", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514");
    anthropicMocks.create.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("instructs Claude not to use assertText for URL or element metadata checks", async () => {
    anthropicMocks.create.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ action: "done", reason: "URL is already correct in the observation." }) }],
      usage: { input_tokens: 10, output_tokens: 4 }
    });

    const decision = await chooseClaudeAction(
      {
        deploymentUrl: "https://admin.asymmetric.al",
        stepTitle: "Confirm no unexpected redirects",
        stepDetail: "Verify the URL remains at https://admin.asymmetric.al and no automatic redirects occurred.",
        credentialsAvailable: { username: false, password: false },
        actionNumber: 1,
        maxActions: 8,
        priorActions: []
      },
      {
        url: "https://admin.asymmetric.al/",
        title: "Admin",
        visibleText: "Sign in Email Password",
        elements: [],
        recentProblems: [],
        screenshotAvailable: true
      }
    );

    expect(decision.action.action).toBe("done");
    const request = anthropicMocks.create.mock.calls[0][0];
    expect(request.system).toContain("Use assertText only for literal text visible in browser.visibleText.");
    expect(request.system).toContain("For URL, title, input type, placeholder, aria label, or element-list checks");
  });
});
