import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubAppConfig } from "./githubApp.js";

export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  description: string;
  public: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
  request_oauth_on_install: boolean;
  setup_on_update: boolean;
}

export interface GitHubManifestConversion {
  id: number | string;
  slug: string;
  pem: string;
  webhook_secret: string;
  html_url?: string;
}

export function buildGitHubAppManifest(input: { projectName: string; baseUrl: string }): GitHubAppManifest {
  const baseUrl = withoutTrailingSlash(input.baseUrl);
  return {
    name: githubAppName(input.projectName),
    url: `${baseUrl}/integrations`,
    hook_attributes: {
      url: `${baseUrl}/api/github/webhook`,
      active: true
    },
    redirect_url: `${baseUrl}/api/github/manifest/callback`,
    callback_urls: [`${baseUrl}/api/github/setup`],
    setup_url: `${baseUrl}/api/github/setup`,
    description: "Runs Test Factory saved tests against Vercel PR previews and reports results back to GitHub.",
    public: false,
    default_permissions: {
      checks: "write",
      contents: "read",
      issues: "write",
      pull_requests: "read"
    },
    default_events: ["pull_request"],
    request_oauth_on_install: false,
    setup_on_update: true
  };
}

export function githubManifestActionUrl(organization?: string): string {
  const trimmed = organization?.trim();
  if (trimmed) return `https://github.com/organizations/${encodeURIComponent(trimmed)}/settings/apps/new`;
  return "https://github.com/settings/apps/new";
}

export function renderGitHubManifestForm(input: { actionUrl: string; state: string; manifest: GitHubAppManifest }): string {
  const action = `${input.actionUrl}?state=${encodeURIComponent(input.state)}`;
  const manifest = JSON.stringify(input.manifest);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Register Test Factory GitHub App</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef3f8; color: #172033; }
      main { width: min(520px, calc(100vw - 32px)); padding: 24px; border: 1px solid #cbd6e6; border-radius: 8px; background: #fff; box-shadow: 0 18px 60px rgba(22, 32, 51, 0.12); }
      h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.2; }
      p { margin: 0 0 18px; color: #5f6f86; line-height: 1.45; }
      button { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid #18243a; border-radius: 8px; padding: 0 14px; background: #18243a; color: #fff; font-weight: 800; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Register Test Factory GitHub App</h1>
      <p>Redirecting to GitHub. Continue manually if the redirect does not start.</p>
      <form action="${escapeHtml(action)}" method="post">
        <input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
        <button type="submit">Continue to GitHub</button>
      </form>
    </main>
    <script>document.forms[0].submit();</script>
  </body>
</html>`;
}

export async function convertGitHubAppManifest(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GitHubManifestConversion> {
  const response = await fetchImpl(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "test-factory"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "GitHub rejected the manifest conversion.";
    throw new Error(`GitHub App manifest conversion failed (${response.status}): ${message}`);
  }
  assertManifestConversion(payload);
  return payload;
}

export function gitHubAppConfigFromManifest(conversion: GitHubManifestConversion): GitHubAppConfig {
  return {
    appId: String(conversion.id),
    appSlug: conversion.slug,
    privateKey: conversion.pem,
    webhookSecret: conversion.webhook_secret,
    publicUrl: process.env.QA_SMOKE_PUBLIC_URL
  };
}

export function applyGitHubAppEnv(config: GitHubAppConfig): void {
  if (config.appId) process.env.GITHUB_APP_ID = config.appId;
  if (config.appSlug) process.env.GITHUB_APP_SLUG = config.appSlug;
  if (config.privateKey) process.env.GITHUB_APP_PRIVATE_KEY = escapeEnvValue(config.privateKey);
  if (config.webhookSecret) process.env.GITHUB_WEBHOOK_SECRET = config.webhookSecret;
}

export async function persistGitHubAppEnv(config: GitHubAppConfig, envPath = path.resolve(process.cwd(), ".env")): Promise<void> {
  const updates: Record<string, string | undefined> = {
    GITHUB_APP_ID: config.appId,
    GITHUB_APP_SLUG: config.appSlug,
    GITHUB_APP_PRIVATE_KEY: config.privateKey ? escapeEnvValue(config.privateKey) : undefined,
    GITHUB_WEBHOOK_SECRET: config.webhookSecret
  };
  const existing = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const lines = existing ? existing.replace(/\r\n/g, "\n").split("\n") : [];
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in updates)) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${updates[key] || ""}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) nextLines.push(`${key}=${value || ""}`);
  }

  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, trimTrailingBlankLines(nextLines).join("\n") + "\n", { mode: 0o600 });
  await chmod(envPath, 0o600).catch(() => undefined);
}

function githubAppName(projectName: string): string {
  const suffix = projectName.replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim() || "Project";
  return `Test Factory ${suffix}`.slice(0, 64);
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function escapeEnvValue(value: string): string {
  return value.replace(/\r?\n/g, "\\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assertManifestConversion(payload: unknown): asserts payload is GitHubManifestConversion {
  if (!payload || typeof payload !== "object") throw new Error("GitHub returned an invalid manifest conversion response.");
  const conversion = payload as Partial<GitHubManifestConversion>;
  if (!conversion.id || !conversion.slug || !conversion.pem || !conversion.webhook_secret) {
    throw new Error("GitHub returned an incomplete manifest conversion response.");
  }
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  return next;
}
