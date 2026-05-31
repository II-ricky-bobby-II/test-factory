import { describe, expect, it } from "vitest";
import { deleteProfile, formFromProfile, loadProfiles, saveProfile } from "../src/client/src/profiles";
import type { RunFormState } from "../src/client/src/types";

const form: RunFormState = {
  profileName: "Admin smoke",
  githubRepo: "https://github.com/Asymmetric-al/core",
  deploymentUrl: "admin.asymmetric.al",
  username: "admin@givehope.test",
  password: "password1",
  smokePrompt: "Log in and click around the menu.",
  agentMode: "browser",
  maxActions: 8
};

describe("saved profiles", () => {
  it("saves, loads, and deletes run profiles", () => {
    const storage = new MapStorage();
    const saved = saveProfile(form, [], storage);

    expect(saved).toHaveLength(1);
    expect(loadProfiles(storage)[0]).toMatchObject({
      profileName: "Admin smoke",
      password: ""
    });
    expect(formFromProfile(saved[0])).toMatchObject({ ...form, password: "" });

    const afterDelete = deleteProfile(saved[0].id, saved, storage);
    expect(afterDelete).toEqual([]);
    expect(loadProfiles(storage)).toEqual([]);
  });

  it("updates an existing profile with the same name", () => {
    const storage = new MapStorage();
    const saved = saveProfile(form, [], storage);
    const updated = saveProfile({ ...form, deploymentUrl: "donor.asymmetric.al" }, saved, storage);

    expect(updated).toHaveLength(1);
    expect(updated[0].deploymentUrl).toBe("donor.asymmetric.al");
  });
});

class MapStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
