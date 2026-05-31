import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGitHubAppManifest,
  convertGitHubAppManifest,
  githubManifestActionUrl,
  persistGitHubAppEnv,
  renderGitHubManifestForm
} from "../src/server/githubManifest";

describe("GitHub App manifest flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the manifest GitHub needs for PR preview automation", () => {
    const manifest = buildGitHubAppManifest({
      projectName: "Admin",
      baseUrl: "https://qa-smoke.example.com/"
    });

    expect(manifest).toMatchObject({
      name: "Test Factory Admin",
      url: "https://qa-smoke.example.com/integrations",
      hook_attributes: {
        url: "https://qa-smoke.example.com/api/github/webhook",
        active: true
      },
      redirect_url: "https://qa-smoke.example.com/api/github/manifest/callback",
      setup_url: "https://qa-smoke.example.com/api/github/setup",
      public: false,
      default_permissions: {
        checks: "write",
        contents: "read",
        issues: "write",
        pull_requests: "read"
      },
      default_events: ["pull_request"]
    });
  });

  it("renders a POST form for the GitHub manifest endpoint", () => {
    const manifest = buildGitHubAppManifest({
      projectName: "Admin",
      baseUrl: "https://qa-smoke.example.com"
    });
    const html = renderGitHubManifestForm({
      actionUrl: githubManifestActionUrl(),
      state: "state-123",
      manifest
    });

    expect(html).toContain('action="https://github.com/settings/apps/new?state=state-123"');
    expect(html).toContain('name="manifest"');
    expect(html).toContain("pull_request");
    expect(html).toContain("document.forms[0].submit()");
  });

  it("converts a manifest code and persists generated credentials to .env", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 123,
        slug: "qa-smoke-admin",
        pem: "-----BEGIN KEY-----\nprivate\n-----END KEY-----\n",
        webhook_secret: "webhook-secret"
      })
    );
    const converted = await convertGitHubAppManifest("code-123", fetchMock as typeof fetch);

    expect(converted.slug).toBe("qa-smoke-admin");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app-manifests/code-123/conversions",
      expect.objectContaining({ method: "POST" })
    );

    const dir = await mkdtemp(path.join(os.tmpdir(), "qa-smoke-github-manifest-"));
    try {
      const envPath = path.join(dir, ".env");
      await persistGitHubAppEnv(
        {
          appId: String(converted.id),
          appSlug: converted.slug,
          privateKey: converted.pem,
          webhookSecret: converted.webhook_secret
        },
        envPath
      );

      const env = await readFile(envPath, "utf8");
      expect(env).toContain("GITHUB_APP_ID=123");
      expect(env).toContain("GITHUB_APP_SLUG=qa-smoke-admin");
      expect(env).toContain("GITHUB_APP_PRIVATE_KEY=-----BEGIN KEY-----\\nprivate\\n-----END KEY-----\\n");
      expect(env).toContain("GITHUB_WEBHOOK_SECRET=webhook-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}
