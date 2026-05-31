import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretStore } from "../src/server/secretStore";

const cleanupPaths: string[] = [];

describe("SecretStore", () => {
  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("encrypts, updates, reads, and deletes local secrets without storing plaintext", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qa-smoke-secret-store-"));
    cleanupPaths.push(dir);
    const storePath = path.join(dir, "secrets.json");
    const keyPath = path.join(dir, "secrets.key");
    const store = new SecretStore(storePath, keyPath);

    const id = await store.setSecret("vercel-token");
    expect(await store.getSecret(id)).toBe("vercel-token");
    expect(await readFile(storePath, "utf8")).not.toContain("vercel-token");

    const sameId = await store.setSecret("new-token", id);
    expect(sameId).toBe(id);
    expect(await store.getSecret(id)).toBe("new-token");

    await store.deleteSecret(id);
    expect(await store.getSecret(id)).toBeUndefined();
  });
});
