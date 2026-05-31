import { describe, expect, it } from "vitest";
import { RunStore } from "../src/server/runStore";

describe("RunStore", () => {
  it("redacts credentials from public run payloads", () => {
    const store = new RunStore();
    const run = store.create(
      {
        githubRepo: "https://github.com/acme/app",
        deploymentUrl: "https://preview.example.com",
        smokePrompt: "Open the app and verify dashboard.",
        agentMode: "demo",
        maxActions: 4,
        credentials: { username: "qa@example.com", password: "secret" }
      },
      [{ id: "step-1", title: "Open", detail: "Open app", status: "pending" }]
    );

    const publicRun = store.getPublic(run.id);

    expect(publicRun?.request.hasCredentials).toBe(true);
    expect(JSON.stringify(publicRun)).not.toContain("secret");
  });

  it("notifies subscribers when events are added", () => {
    const store = new RunStore();
    const run = store.create(
      {
        githubRepo: "",
        deploymentUrl: "https://preview.example.com",
        smokePrompt: "Open the app and verify dashboard.",
        agentMode: "demo",
        maxActions: 4
      },
      []
    );

    const messages: string[] = [];
    const unsubscribe = store.subscribe(run.id, (event) => messages.push(event.message));
    store.addLog(run.id, "info", "hello");
    unsubscribe();
    store.addLog(run.id, "info", "ignored");

    expect(messages).toEqual(["hello"]);
  });
});
