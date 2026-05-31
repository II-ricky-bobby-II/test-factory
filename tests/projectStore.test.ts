import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStore, toPublicProject } from "../src/server/projectStore";
import { projectCreateSchema, testCreateSchema } from "../src/server/types";

const cleanupPaths: string[] = [];

describe("ProjectStore", () => {
  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("creates, loads, updates, and deletes projects and tests from a JSON file", async () => {
    const { store, filePath } = await tempStore();
    const project = await store.createProject(
      projectCreateSchema.parse({
        name: "Admin",
        deploymentUrl: "admin.example.com",
        githubRepo: "https://github.com/acme/app",
        defaultAgentMode: "demo",
        defaultMaxActions: 4
      })
    );
    const test = await store.createTest(
      project.id,
      testCreateSchema.parse({
        title: "Dashboard smoke",
        description: "Read-only dashboard check",
        sourcePrompt: "Open the app and verify the dashboard loads.",
        steps: [{ type: "assert", title: "Dashboard", detail: "Confirm the dashboard heading is visible." }]
      })
    );

    expect(project.deploymentUrl).toBe("https://admin.example.com");
    expect(test?.steps[0]).toMatchObject({ type: "assert", title: "Dashboard" });

    const reloaded = new ProjectStore(filePath);
    expect(await reloaded.listProjects()).toHaveLength(1);
    expect(await reloaded.listTests(project.id)).toHaveLength(1);

    const updated = await reloaded.updateTest(test!.id, {
      title: "Updated smoke",
      steps: [{ ...test!.steps[0], detail: "Confirm the dashboard card is visible." }]
    });
    expect(updated?.title).toBe("Updated smoke");
    expect(updated?.steps[0].id).toBe(test?.steps[0].id);

    expect(await reloaded.deleteProject(project.id)).toBe(true);
    expect(await reloaded.listProjects()).toEqual([]);
    expect(await reloaded.getTest(test!.id)).toBeUndefined();
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ version: 3, projects: [], tests: [], recommendationSets: [] });
  });

  it("migrates v1 project data and redacts automation secrets from public projects", async () => {
    const { store, filePath } = await tempStore();
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: "project-1",
            name: "Admin",
            deploymentUrl: "https://admin.example.com",
            githubRepo: "https://github.com/acme/app",
            defaultAgentMode: "demo",
            defaultMaxActions: 4,
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:00:00.000Z"
          }
        ],
        tests: []
      }),
      "utf8"
    );

    const migrated = await store.getProject("project-1");
    expect(migrated?.prAutomation).toMatchObject({
      enabled: false,
      selectedTestIds: [],
      previewWaitTimeoutSeconds: 120
    });

    const updated = await store.updatePrAutomation("project-1", {
      githubOwner: "acme",
      githubRepo: "app",
      githubInstallationId: "123",
      vercelProjectId: "prj_123",
      vercelApiTokenSecretId: "secret-token",
      vercelBypassSecretId: "secret-bypass"
    });
    const publicProject = toPublicProject(updated!);

    expect(publicProject.prAutomation).toMatchObject({
      githubInstalled: true,
      vercelConnected: true,
      bypassConfigured: true
    });
    expect(JSON.stringify(publicProject)).not.toContain("secret-token");
    expect(JSON.stringify(publicProject)).not.toContain("secret-bypass");
  });

  it("validates normalized project URLs and reusable test step limits", () => {
    expect(projectCreateSchema.parse({ name: "Local", deploymentUrl: "localhost:3000" }).deploymentUrl).toBe("http://localhost:3000");

    const tooManySteps = Array.from({ length: 9 }, (_value, index) => ({
      type: "act",
      title: `Step ${index + 1}`,
      detail: "Do a read-only browser action."
    }));

    expect(() =>
      testCreateSchema.parse({
        title: "Too much",
        steps: tooManySteps
      })
    ).toThrow(/up to 8 steps/);
  });
});

async function tempStore(): Promise<{ store: ProjectStore; filePath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-smoke-project-store-"));
  cleanupPaths.push(dir);
  const filePath = path.join(dir, "data.json");
  return { store: new ProjectStore(filePath), filePath };
}
