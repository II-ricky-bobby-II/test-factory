import type { RunFormState, SavedRunProfile } from "./types";

const STORAGE_KEY = "qa-smoke.saved-profiles.v1";

export function loadProfiles(storage: Storage = window.localStorage): SavedRunProfile[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedRunProfile).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveProfile(form: RunFormState, profiles: SavedRunProfile[], storage: Storage = window.localStorage): SavedRunProfile[] {
  const now = new Date().toISOString();
  const name = form.profileName.trim() || deriveProfileName(form);
  const existing = profiles.find((profile) => profile.id === nameToId(name) || profile.profileName.toLowerCase() === name.toLowerCase());
  const saved: SavedRunProfile = {
    ...form,
    password: "",
    profileName: name,
    id: existing?.id || nameToId(name),
    updatedAt: now
  };
  const next = [saved, ...profiles.filter((profile) => profile.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  persistProfiles(next, storage);
  return next;
}

export function deleteProfile(id: string, profiles: SavedRunProfile[], storage: Storage = window.localStorage): SavedRunProfile[] {
  const next = profiles.filter((profile) => profile.id !== id);
  persistProfiles(next, storage);
  return next;
}

export function formFromProfile(profile: SavedRunProfile): RunFormState {
  const { id: _id, updatedAt: _updatedAt, ...form } = profile;
  return { ...form, password: "" };
}

function persistProfiles(profiles: SavedRunProfile[], storage: Storage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function deriveProfileName(form: RunFormState): string {
  const source = form.deploymentUrl || form.githubRepo || "Untitled smoke profile";
  return source.replace(/^https?:\/\//i, "").replace(/\/$/, "") || "Untitled smoke profile";
}

function nameToId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `profile-${Date.now()}`;
}

function isSavedRunProfile(value: unknown): value is SavedRunProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedRunProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.profileName === "string" &&
    typeof candidate.githubRepo === "string" &&
    typeof candidate.deploymentUrl === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.password === "string" &&
    typeof candidate.smokePrompt === "string" &&
    (candidate.agentMode === "browser" || candidate.agentMode === "demo") &&
    typeof candidate.maxActions === "number"
  );
}
