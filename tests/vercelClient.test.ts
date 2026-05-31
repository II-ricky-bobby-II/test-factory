import { describe, expect, it, vi } from "vitest";
import { newestReadyPreview, VercelClient } from "../src/server/vercelClient";

describe("VercelClient", () => {
  it("resolves previews by SHA before falling back to branch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("sha=abc123")) {
        return jsonResponse({
          deployments: [
            {
              uid: "dpl_sha",
              url: "sha-preview.vercel.app",
              readyState: "READY",
              target: "preview",
              createdAt: 2000
            }
          ]
        });
      }
      return jsonResponse({
        deployments: [
          {
            uid: "dpl_branch",
            url: "branch-preview.vercel.app",
            readyState: "READY",
            target: "preview",
            createdAt: 3000
          }
        ]
      });
    });

    const client = new VercelClient(fetchMock);
    const resolved = await client.resolvePreview({
      apiToken: "token",
      projectId: "prj_123",
      headSha: "abc123",
      branch: "feature"
    });

    expect(resolved).toMatchObject({
      matchedBy: "sha",
      deployment: { id: "dpl_sha", url: "https://sha-preview.vercel.app" }
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("sha=abc123"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("branch=feature"), expect.anything());
  });

  it("falls back to branch and ignores production or non-ready deployments", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("sha=abc123")) return jsonResponse({ deployments: [] });
      return jsonResponse({
        deployments: [
          {
            uid: "dpl_prod",
            url: "prod.vercel.app",
            readyState: "READY",
            target: "production",
            createdAt: 5000
          },
          {
            uid: "dpl_building",
            url: "building.vercel.app",
            readyState: "BUILDING",
            target: "preview",
            createdAt: 4000
          },
          {
            uid: "dpl_ready",
            url: "branch.vercel.app",
            readyState: "READY",
            target: "preview",
            createdAt: 3000
          }
        ]
      });
    });

    const client = new VercelClient(fetchMock);
    const resolved = await client.resolvePreview({
      apiToken: "token",
      projectId: "prj_123",
      headSha: "abc123",
      branch: "feature"
    });

    expect(resolved).toMatchObject({
      matchedBy: "branch",
      deployment: { id: "dpl_ready", url: "https://branch.vercel.app" }
    });
  });

  it("chooses the newest READY preview deployment", () => {
    expect(
      newestReadyPreview([
        { id: "old", url: "https://old.vercel.app", state: "READY", target: "preview", createdAt: 10 },
        { id: "prod", url: "https://prod.vercel.app", state: "READY", target: "production", createdAt: 30 },
        { id: "new", url: "https://new.vercel.app", state: "READY", target: "preview", createdAt: 20 }
      ])
    ).toMatchObject({ id: "new" });
  });

  it("verifies projects by retrying independent team scopes and project name", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/v9/projects/admin?slug=acme")) return jsonResponse({ id: "prj_123", name: "admin" });
      return jsonResponse({}, 404);
    });

    const client = new VercelClient(fetchMock);
    const result = await client.verifyProject({
      apiToken: "token",
      projectId: "wrong-project-id",
      projectName: "admin",
      teamId: "wrong-team-id",
      teamSlug: "acme"
    });

    expect(result).toMatchObject({
      ok: true,
      project: { id: "prj_123", name: "admin" },
      scope: { projectId: "admin", teamSlug: "acme" }
    });
    expect(urls).toEqual([
      "https://api.vercel.com/v9/projects/wrong-project-id?teamId=wrong-team-id",
      "https://api.vercel.com/v9/projects/wrong-project-id?slug=acme",
      "https://api.vercel.com/v9/projects/wrong-project-id?teamId=wrong-team-id&slug=acme",
      "https://api.vercel.com/v9/projects/wrong-project-id",
      "https://api.vercel.com/v9/projects/admin?teamId=wrong-team-id",
      "https://api.vercel.com/v9/projects/admin?slug=acme"
    ]);
  });

  it("discovers an accessible project from the project list when direct lookup fails", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/v9/projects/")) return jsonResponse({}, 404);
      if (url.includes("/v10/projects?") && url.includes("teamId=team_123")) {
        return jsonResponse([
          {
            id: "prj_123",
            name: "admin",
            link: { type: "github", org: "Asymmetric-al", repo: "core" }
          }
        ]);
      }
      return jsonResponse({ projects: [] });
    });

    const client = new VercelClient(fetchMock);
    const result = await client.verifyProject({
      apiToken: "token",
      projectId: "mistyped-project-id",
      projectName: "admin",
      githubRepo: "https://github.com/Asymmetric-al/core",
      teamId: "team_123"
    });

    expect(result).toMatchObject({
      ok: true,
      project: { id: "prj_123", name: "admin" },
      scope: { projectId: "prj_123", teamId: "team_123" }
    });
    expect(urls.some((url) => url.startsWith("https://api.vercel.com/v10/projects?"))).toBe(true);
  });

  it("lists selectable projects from Vercel's documented array response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v10/projects?") && url.includes("teamId=team_123")) {
        return jsonResponse([
          { id: "prj_admin", name: "admin", link: { type: "github", org: "Asymmetric-al", repo: "core" } },
          { id: "prj_donor", name: "donor" }
        ]);
      }
      return jsonResponse([]);
    });

    const client = new VercelClient(fetchMock);
    const result = await client.listProjects({
      apiToken: "token",
      teamId: "team_123",
      githubRepo: "https://github.com/Asymmetric-al/core"
    });

    expect(result).toMatchObject({
      ok: true,
      projects: [
        { id: "prj_admin", name: "admin", matchedRepo: true },
        { id: "prj_donor", name: "donor", matchedRepo: false }
      ]
    });
  });

  it("lists projects from search-filtered and legacy project-list fallbacks", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/v10/projects?")) return jsonResponse([]);
      if (url.includes("/v9/projects?") && url.includes("search=admin")) {
        return jsonResponse({ projects: [{ id: "prj_admin", name: "admin" }] });
      }
      return jsonResponse({ projects: [] });
    });

    const client = new VercelClient(fetchMock);
    const result = await client.listProjects({
      apiToken: "token",
      projectName: "admin",
      teamId: "team_123"
    });

    expect(result).toMatchObject({
      ok: true,
      message: "Found 1 accessible Vercel project.",
      projects: [{ id: "prj_admin", name: "admin" }]
    });
    expect(urls.some((url) => url.startsWith("https://api.vercel.com/v9/projects?") && url.includes("search=admin"))).toBe(true);
    expect(result.diagnostics).toContain("GET /v9/projects scoped by teamId with search -> HTTP 200 (1 project)");
  });

  it("reports list failures when every project-list scope is rejected", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "Forbidden" } }, 403));

    const client = new VercelClient(fetchMock, emptyCliRunner);
    const result = await client.listProjects({
      apiToken: "token",
      teamId: "team_123"
    });

    expect(result).toMatchObject({
      ok: false,
      message: "Vercel project is not accessible with this token, team ID, or team slug.",
      projects: []
    });
  });

  it("falls back to the authenticated Vercel CLI when REST project lists are empty", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ projects: [] }));
    const cliRunner = vi.fn(async (args: string[]) => {
      if (args[0] === "teams") {
        return jsonCliResponse({
          teams: [{ id: "team_123", slug: "asymmetric-al", name: "Asymmetrical" }]
        });
      }
      return jsonCliResponse({
        contextName: "asymmetric-al",
        projects: [
          {
            id: "prj_admin",
            name: "admin",
            latestProductionUrl: "https://admin.asymmetric.al",
            updatedAt: 100
          },
          {
            id: "prj_donor",
            name: "donor",
            latestProductionUrl: "https://donor.asymmetric.al",
            updatedAt: 90
          }
        ]
      });
    });

    const client = new VercelClient(fetchMock, cliRunner);
    const result = await client.listProjects({
      apiToken: "token",
      teamId: "team_123"
    });

    expect(result).toMatchObject({
      ok: true,
      message: "Found 2 accessible Vercel projects.",
      projects: [
        { id: "prj_admin", name: "admin", productionUrl: "https://admin.asymmetric.al", teamId: "team_123", teamSlug: "asymmetric-al", source: "cli" },
        { id: "prj_donor", name: "donor", productionUrl: "https://donor.asymmetric.al", teamId: "team_123", teamSlug: "asymmetric-al", source: "cli" }
      ]
    });
    expect(cliRunner).toHaveBeenCalledWith(["teams", "ls", "-F", "json", "--non-interactive"]);
    expect(cliRunner).toHaveBeenCalledWith(["project", "list", "-F", "json", "--non-interactive", "--scope", "asymmetric-al"]);
    expect(result.diagnostics).toContain("vercel project list -F json --non-interactive --scope asymmetric-al -> 2 projects");
  });

  it("normalizes pasted bearer tokens and keeps original-case repoUrl filters", async () => {
    const calls: Array<{ url: string; authorization: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
      calls.push({ url, authorization });
      if (url.includes("/v9/projects/")) return jsonResponse({}, 404);
      if (url.includes("repoUrl=https%3A%2F%2Fgithub.com%2FAsymmetric-al%2Fcore")) {
        return jsonResponse({
          projects: [{ id: "prj_123", name: "admin", link: { type: "github", org: "Asymmetric-al", repo: "core" } }]
        });
      }
      return jsonResponse({ projects: [] });
    });

    const client = new VercelClient(fetchMock);
    const result = await client.verifyProject({
      apiToken: "Bearer token",
      projectId: "missing",
      projectName: "admin",
      githubRepo: "https://github.com/Asymmetric-al/core",
      teamId: "team_123"
    });

    expect(result.ok).toBe(true);
    expect(calls.every((call) => call.authorization === "Bearer token")).toBe(true);
    expect(calls.some((call) => call.url.includes("repoUrl=https%3A%2F%2Fgithub.com%2FAsymmetric-al%2Fcore"))).toBe(true);
  });

  it("reports a valid token and team separately from a project mismatch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v9/projects/")) return jsonResponse({}, 404);
      if (url.includes("/v10/projects?")) return jsonResponse({ projects: [{ id: "prj_other", name: "other" }] });
      return jsonResponse({});
    });

    const client = new VercelClient(fetchMock);
    const result = await client.verifyProject({
      apiToken: "token",
      projectId: "missing",
      projectName: "admin",
      teamId: "team_123"
    });

    expect(result).toMatchObject({
      ok: false,
      message: "Vercel token and team are valid, but no accessible project matched this project ID, project name, or GitHub repo."
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

async function emptyCliRunner(): Promise<{ stdout: string; stderr: string }> {
  return jsonCliResponse({ projects: [], teams: [] });
}

function jsonCliResponse(body: unknown): { stdout: string; stderr: string } {
  return { stdout: `Fetching Vercel data\n${JSON.stringify(body)}`, stderr: "" };
}
