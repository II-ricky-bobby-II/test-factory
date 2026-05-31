import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRepoContext, parseGitHubRepoUrl } from "../src/server/repoContext";

describe("parseGitHubRepoUrl", () => {
  it("parses https and ssh GitHub repo URLs", () => {
    expect(parseGitHubRepoUrl("https://github.com/acme/app")).toMatchObject({
      owner: "acme",
      repo: "app",
      url: "https://github.com/acme/app"
    });
    expect(parseGitHubRepoUrl("git@github.com:acme/app.git")).toMatchObject({
      owner: "acme",
      repo: "app",
      url: "https://github.com/acme/app"
    });
  });
});

describe("buildRepoContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches public GitHub metadata, file tree, and capped file snippets", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/app")) {
        return jsonResponse({ default_branch: "main", full_name: "acme/app" });
      }
      if (url.includes("/git/trees/main")) {
        return jsonResponse({
          tree: [
            { path: "README.md", type: "blob", size: 20 },
            { path: "package.json", type: "blob", size: 40 },
            { path: "node_modules/ignored.js", type: "blob", size: 20 }
          ]
        });
      }
      if (url.includes("/README.md")) return textResponse("Project readme");
      if (url.includes("/package.json")) return textResponse('{"name":"app"}');
      return textResponse("", 404);
    }));

    const context = await buildRepoContext("https://github.com/acme/app");

    expect(context.summary).toBe("Included 2 public GitHub repo files from acme/app.");
    expect(context.files.map((file) => file.path)).toEqual(["README.md", "package.json"]);
    expect(context.warnings).toEqual([]);
  });

  it("continues without files when public GitHub fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "rate limited" }, 403)));

    const context = await buildRepoContext("https://github.com/acme/app");

    expect(context.files).toEqual([]);
    expect(context.warnings.join("\n")).toContain("HTTP 403");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as Response;
}
