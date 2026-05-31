import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  checkConclusionForReports,
  GitHubAppClient,
  renderStickyComment,
  stickyCommentMarker
} from "../src/server/githubApp";
import type { PrAutomationRun, RunReport } from "../src/server/types";

describe("GitHubAppClient", () => {
  it("verifies GitHub webhook signatures with the configured secret", () => {
    const body = Buffer.from(JSON.stringify({ action: "opened" }));
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    const client = new GitHubAppClient({ webhookSecret: "secret" });

    expect(client.verifyWebhookSignature(body, signature)).toBe(true);
    expect(client.verifyWebhookSignature(body, "sha256=bad")).toBe(false);
  });

  it("reports missing configuration without exposing secret values", () => {
    const client = new GitHubAppClient({
      appId: "1",
      privateKey: "private-key",
      webhookSecret: "webhook-secret",
      appSlug: "qa-smoke",
      publicUrl: "https://qa-smoke.example.com"
    });

    expect(client.integrationStatus()).toEqual({
      githubAppConfigured: true,
      githubWebhookSecretConfigured: true,
      githubInstallFlowConfigured: true,
      publicUrlConfigured: true,
      publicUrl: "https://qa-smoke.example.com",
      githubInstallUrl: "https://github.com/apps/qa-smoke/installations/new",
      githubMissingConfig: {
        appId: false,
        privateKey: false,
        webhookSecret: false,
        installUrl: false,
        publicUrl: false
      }
    });
    expect(JSON.stringify(client.integrationStatus())).not.toContain("private-key");
    expect(JSON.stringify(client.integrationStatus())).not.toContain("webhook-secret");
  });

  it("uses installation tokens for check runs and sticky comments", async () => {
    const tokens: Array<{ type: string; installationId?: string }> = [];
    const calls = { createCheck: "", updateCheck: "", comment: "" };
    const client = new GitHubAppClient(
      { appId: "1", privateKey: "private-key", webhookSecret: "secret" },
      (token) =>
        ({
          checks: {
            create: vi.fn(async (input: { head_sha: string }) => {
              calls.createCheck = `${token}:${input.head_sha}`;
              return { data: { id: 99, html_url: "https://github.com/checks/99" } };
            }),
            update: vi.fn(async (input: { conclusion: string }) => {
              calls.updateCheck = `${token}:${input.conclusion}`;
              return { data: {} };
            })
          },
          issues: {
            listComments: vi.fn(async () => ({ data: [] })),
            createComment: vi.fn(async (input: { body: string }) => {
              calls.comment = `${token}:${input.body}`;
              return { data: { id: 123, html_url: "https://github.com/comment/123" } };
            })
          }
        }) as never,
      async (type, installationId) => {
        tokens.push({ type, installationId });
        return `${type}-${installationId || "app"}-token`;
      }
    );

    await client.createQueuedCheck({
      owner: "acme",
      repo: "app",
      installationId: "42",
      headSha: "abc123",
      summary: "Queued"
    });
    await client.updateCheck({
      owner: "acme",
      repo: "app",
      installationId: "42",
      checkRunId: "99",
      status: "completed",
      conclusion: "success",
      title: "Passed",
      summary: "Done"
    });
    await client.upsertStickyComment({
      owner: "acme",
      repo: "app",
      installationId: "42",
      issueNumber: 5,
      marker: "<!-- marker -->",
      body: "<!-- marker -->\nDone"
    });

    expect(tokens).toEqual([
      { type: "installation", installationId: "42" },
      { type: "installation", installationId: "42" },
      { type: "installation", installationId: "42" }
    ]);
    expect(calls.createCheck).toBe("installation-42-token:abc123");
    expect(calls.updateCheck).toBe("installation-42-token:success");
    expect(calls.comment).toContain("installation-42-token:");
  });

  it("fetches PR metadata, changed files, truncated patches, and repo files with installation auth", async () => {
    const tokens: Array<{ type: string; installationId?: string }> = [];
    const longPatch = `${"x".repeat(1800)}truncated`;
    const client = new GitHubAppClient(
      { appId: "1", privateKey: "private-key", webhookSecret: "secret" },
      (token) =>
        ({
          pulls: {
            get: vi.fn(async () => ({
              data: {
                title: "Improve dashboard",
                body: "Adds campaign metrics.",
                html_url: "https://github.com/acme/app/pull/5",
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
              patch: longPatch
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
      async (type, installationId) => {
        tokens.push({ type, installationId });
        return `${type}-${installationId || "app"}-token`;
      }
    );

    const context = await client.getPullRequestContext({
      owner: "acme",
      repo: "app",
      installationId: "42",
      prNumber: 5
    });

    expect(tokens).toEqual([{ type: "installation", installationId: "42" }]);
    expect(context).toMatchObject({
      title: "Improve dashboard",
      baseSha: "base123",
      headSha: "head123"
    });
    expect(context.changedFiles[0]).toMatchObject({
      path: "src/app/dashboard/page.tsx",
      patchTruncated: true
    });
    expect(context.changedFiles[0].patch?.length).toBeLessThan(longPatch.length);
    expect(context.repoFiles[0]).toMatchObject({
      path: "src/app/dashboard/page.tsx",
      content: "content for src/app/dashboard/page.tsx"
    });
  });

  it("maps reports to check conclusions and renders a secret-free sticky comment", () => {
    const passed: RunReport = { outcome: "passed", summary: "ok", errors: [] };
    const failed: RunReport = { outcome: "failed", summary: "bad", errors: ["Visible error"], fixPrompt: undefined };
    const prRun: PrAutomationRun = {
      id: "pr-run-1",
      projectId: "project-1",
      githubOwner: "acme",
      githubRepo: "app",
      prNumber: 5,
      headSha: "abc123",
      branch: "feature",
      status: "failed",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      testIds: ["test-1"],
      runIds: ["run-1"],
      previewUrl: "https://preview.example.com"
    };

    expect(checkConclusionForReports([passed])).toBe("success");
    expect(checkConclusionForReports([passed, failed])).toBe("failure");
    expect(checkConclusionForReports([])).toBe("neutral");

    const body = renderStickyComment({
      prRun,
      projectName: "Admin",
      reports: [failed],
      appUrl: "https://qa-smoke.example.com"
    });
    expect(body).toContain(stickyCommentMarker("project-1"));
    expect(body).toContain("Test Factory failed");
    expect(body).toContain("https://preview.example.com");
    expect(body).not.toContain("x-vercel-protection-bypass");
  });
});
