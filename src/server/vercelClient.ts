import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VercelProjectCredentials {
  apiToken: string;
  projectId: string;
  projectName?: string;
  githubRepo?: string;
  teamId?: string;
  teamSlug?: string;
}

export interface VercelDeployment {
  id: string;
  url: string;
  state: string;
  target?: string;
  branch?: string;
  sha?: string;
  createdAt: number;
  inspectorUrl?: string;
}

export interface PreviewResolutionInput extends VercelProjectCredentials {
  headSha: string;
  branch: string;
}

export interface PreviewResolution {
  deployment: VercelDeployment;
  matchedBy: "sha" | "branch";
}

export interface VercelProjectVerification {
  ok: boolean;
  message: string;
  diagnostics?: string[];
  project?: {
    id: string;
    name: string;
  };
  scope?: {
    projectId: string;
    teamId?: string;
    teamSlug?: string;
  };
}

export interface VercelProjectSummary {
  id: string;
  name: string;
  accountId?: string;
  repoUrl?: string;
  productionUrl?: string;
  teamId?: string;
  teamSlug?: string;
  source?: "api" | "cli";
  updatedAt?: number;
  createdAt?: number;
  matchedRepo: boolean;
}

export interface VercelProjectListResult {
  ok: boolean;
  message: string;
  diagnostics: string[];
  projects: VercelProjectSummary[];
  scope?: {
    teamId?: string;
    teamSlug?: string;
  };
}

interface RawVercelDeployment {
  uid?: string;
  id?: string;
  url?: string | null;
  state?: string;
  readyState?: string;
  target?: string | null;
  created?: number;
  createdAt?: number;
  inspectorUrl?: string;
  meta?: Record<string, unknown>;
}

interface RawVercelProject {
  accountId?: string;
  updatedAt?: number;
  createdAt?: number;
  id?: string;
  name?: string;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
  } | null;
  gitRepository?: {
    type?: string;
    org?: string;
    owner?: string;
    repo?: string;
    url?: string;
    repoUrl?: string;
  } | null;
}

type ProjectListInput = Pick<VercelProjectCredentials, "apiToken" | "teamId" | "teamSlug" | "githubRepo" | "projectId" | "projectName">;
type VercelCliRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

interface RawVercelCliProject {
  id?: string;
  name?: string;
  latestProductionUrl?: string;
  updatedAt?: number;
  createdAt?: number;
}

interface RawVercelCliTeam {
  id?: string;
  slug?: string;
  name?: string;
  current?: boolean;
}

interface VercelCliScope {
  teamId?: string;
  teamSlug?: string;
}

export class VercelClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly cliRunner: VercelCliRunner = defaultVercelCliRunner
  ) {}

  async verifyProject(credentials: VercelProjectCredentials): Promise<VercelProjectVerification> {
    const apiToken = normalizeApiToken(credentials.apiToken);
    const projectCandidates = uniqueNonEmpty([credentials.projectId, credentials.projectName]);
    if (!apiToken || projectCandidates.length === 0) {
      return { ok: false, message: "Vercel API token and project ID are required.", diagnostics: ["No Vercel API token was available to send."] };
    }
    const normalizedCredentials = { ...credentials, apiToken };

    let lastFailure: VercelProjectVerification | undefined;
    const diagnostics: string[] = [];
    for (const projectId of projectCandidates) {
      for (const scope of verificationScopes(normalizedCredentials)) {
        const response = await this.fetchImpl(this.apiUrl(`/v9/projects/${encodeURIComponent(projectId)}`, scope), {
          headers: this.headers(apiToken)
        });
        diagnostics.push(`GET /v9/projects/${redactProjectCandidate(projectId)}${scopeLabel(scope)} -> HTTP ${response.status}`);
        if (response.ok) {
          const body = (await response.json().catch(() => ({}))) as { id?: string; name?: string };
          return {
            ok: true,
            message: body.name ? `Verified Vercel project "${body.name}".` : "Verified Vercel project.",
            diagnostics,
            project:
              body.id || body.name
                ? {
                    id: body.id || projectId,
                    name: body.name || ""
                  }
                : undefined,
            scope: {
              projectId,
              teamId: scope.teamId,
              teamSlug: scope.teamSlug
            }
          };
        }
        lastFailure = { ok: false, message: vercelVerificationErrorMessage(response.status), diagnostics: [...diagnostics] };
        if (response.status === 401) return lastFailure;
      }
    }

    const discovered = await this.discoverProject(normalizedCredentials, diagnostics);
    if (discovered.ok || discovered.message !== "Vercel project verification failed.") return discovered;

    return lastFailure || { ok: false, message: "Vercel project verification failed." };
  }

  async resolvePreview(input: PreviewResolutionInput): Promise<PreviewResolution | undefined> {
    const bySha = await this.listDeployments({
      apiToken: input.apiToken,
      projectId: input.projectId,
      teamId: input.teamId,
      teamSlug: input.teamSlug,
      sha: input.headSha
    });
    const shaMatch = newestReadyPreview(bySha);
    if (shaMatch) return { deployment: shaMatch, matchedBy: "sha" };

    const byBranch = await this.listDeployments({
      apiToken: input.apiToken,
      projectId: input.projectId,
      teamId: input.teamId,
      teamSlug: input.teamSlug,
      branch: input.branch
    });
    const branchMatch = newestReadyPreview(byBranch);
    return branchMatch ? { deployment: branchMatch, matchedBy: "branch" } : undefined;
  }

  async listDeployments(
    input: VercelProjectCredentials & { sha?: string; branch?: string; limit?: number }
  ): Promise<VercelDeployment[]> {
    const params = new URLSearchParams({
      projectId: input.projectId,
      limit: String(input.limit || 20),
      state: "READY"
    });
    if (input.sha) params.set("sha", input.sha);
    if (input.branch) params.set("branch", input.branch);
    if (input.teamId) params.set("teamId", input.teamId);
    if (input.teamSlug) params.set("slug", input.teamSlug);

    const response = await this.fetchImpl(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      headers: this.headers(input.apiToken)
    });
    if (!response.ok) {
      throw new Error(`Vercel deployment lookup failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as { deployments?: RawVercelDeployment[] };
    return (body.deployments || []).map(normalizeDeployment).filter((deployment): deployment is VercelDeployment => Boolean(deployment));
  }

  async listProjects(input: Partial<ProjectListInput> & Pick<VercelProjectCredentials, "apiToken">): Promise<VercelProjectListResult> {
    const apiToken = normalizeApiToken(input.apiToken);
    if (!apiToken) {
      const cliOnly = await this.listProjectsFromCli(input, ["No Vercel API token was available; trying local Vercel CLI project discovery."]);
      if (cliOnly.projects.length) return cliOnly;
      return { ok: false, message: "Vercel API token is required to list projects.", diagnostics: cliOnly.diagnostics, projects: [] };
    }

    const expectedRepo = normalizeRepoUrl(input.githubRepo);
    const diagnostics: string[] = [];
    const projectsById = new Map<string, VercelProjectSummary>();
    let lastMessage = "Could not list Vercel projects.";
    let sawAccessibleScope = false;
    let acceptedScope: Pick<VercelProjectCredentials, "teamId" | "teamSlug"> | undefined;
    for (const scope of verificationScopes({ apiToken, projectId: "", teamId: input.teamId, teamSlug: input.teamSlug })) {
      for (const request of projectListRequests(input, scope)) {
        const response = await this.fetchImpl(request.url, {
          headers: this.headers(apiToken)
        });
        if (!response.ok) {
          diagnostics.push(`${request.label}${scopeLabel(scope)}${request.filterLabel} -> HTTP ${response.status}`);
          lastMessage = vercelVerificationErrorMessage(response.status);
          if (response.status === 401) return { ok: false, message: lastMessage, diagnostics, projects: [] };
          continue;
        }
        sawAccessibleScope = true;
        acceptedScope ||= scope;
        const rawProjects = normalizeProjectsPayload(await response.json().catch(() => []));
        diagnostics.push(`${request.label}${scopeLabel(scope)}${request.filterLabel} -> HTTP ${response.status} (${rawProjects.length} project${rawProjects.length === 1 ? "" : "s"})`);
        for (const rawProject of rawProjects) {
          const project = toProjectSummary(rawProject, expectedRepo);
          if (project) projectsById.set(project.id, project);
        }
      }
    }

    const cliFallback =
      projectsById.size === 0
        ? await this.listProjectsFromCli(input, diagnostics)
        : { ok: true, message: "", diagnostics, projects: [] };
    for (const project of cliFallback.projects) {
      if (!projectsById.has(project.id)) projectsById.set(project.id, project);
    }
    if (!sawAccessibleScope && cliFallback.projects.length === 0) {
      return { ok: false, message: lastMessage, diagnostics, projects: [] };
    }

    const projects = [...projectsById.values()].sort((a, b) => {
      if (a.matchedRepo !== b.matchedRepo) return a.matchedRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return {
      ok: true,
      message: projects.length ? `Found ${projects.length} accessible Vercel project${projects.length === 1 ? "" : "s"}.` : "Vercel token and team are valid, but no projects were returned.",
      diagnostics: cliFallback.diagnostics,
      projects,
      scope: acceptedScope
    };
  }

  private apiUrl(pathname: string, credentials: Pick<VercelProjectCredentials, "teamId" | "teamSlug">): string {
    const params = new URLSearchParams();
    if (credentials.teamId) params.set("teamId", credentials.teamId);
    if (credentials.teamSlug) params.set("slug", credentials.teamSlug);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return `https://api.vercel.com${pathname}${suffix}`;
  }

  private headers(apiToken: string): HeadersInit {
    return {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json"
    };
  }

  private async discoverProject(credentials: VercelProjectCredentials, diagnostics: string[]): Promise<VercelProjectVerification> {
    const expected = {
      ids: uniqueNonEmpty([credentials.projectId]),
      names: uniqueNonEmpty([credentials.projectName, credentials.projectId]),
      githubRepo: normalizeRepoUrl(credentials.githubRepo)
    };
    let sawAccessibleScope = false;
    let lastFailure: VercelProjectVerification = { ok: false, message: "Vercel project verification failed." };
    for (const scope of verificationScopes(credentials)) {
      for (const request of projectListRequests(credentials, scope)) {
        const response = await this.fetchImpl(request.url, {
          headers: this.headers(credentials.apiToken)
        });
        if (!response.ok) {
          diagnostics.push(`${request.label}${scopeLabel(scope)}${request.filterLabel} -> HTTP ${response.status}`);
          lastFailure = { ok: false, message: vercelVerificationErrorMessage(response.status), diagnostics: [...diagnostics] };
          if (response.status === 401) return lastFailure;
          continue;
        }
        sawAccessibleScope = true;
        const rawProjects = normalizeProjectsPayload(await response.json().catch(() => []));
        diagnostics.push(`${request.label}${scopeLabel(scope)}${request.filterLabel} -> HTTP ${response.status} (${rawProjects.length} project${rawProjects.length === 1 ? "" : "s"})`);
        const match = findMatchingProject(rawProjects, expected);
        if (match) {
          return {
            ok: true,
            message: match.name ? `Verified Vercel project "${match.name}".` : "Verified Vercel project.",
            diagnostics: [...diagnostics, `Matched project "${match.name || match.id || "unknown"}" from accessible project list.`],
            project: {
              id: match.id || credentials.projectId,
              name: match.name || ""
            },
            scope: {
              projectId: match.id || match.name || credentials.projectId,
              teamId: scope.teamId,
              teamSlug: scope.teamSlug
            }
          };
        }
      }
    }
    if (sawAccessibleScope) {
      return {
        ok: false,
        message: "Vercel token and team are valid, but no accessible project matched this project ID, project name, or GitHub repo.",
        diagnostics
      };
    }
    return lastFailure;
  }

  private async listProjectsFromCli(input: Partial<ProjectListInput>, diagnostics: string[]): Promise<VercelProjectListResult> {
    const expectedRepo = normalizeRepoUrl(input.githubRepo);
    const projectsById = new Map<string, VercelProjectSummary>();
    const cliDiagnostics = [...diagnostics];
    let scopes: VercelCliScope[];
    try {
      scopes = await this.cliScopes(input, cliDiagnostics);
    } catch (error) {
      cliDiagnostics.push(`Vercel CLI project discovery unavailable: ${errorMessage(error)}`);
      return { ok: true, message: "Vercel token and team are valid, but no projects were returned.", diagnostics: cliDiagnostics, projects: [] };
    }

    for (const scope of scopes) {
      const args = ["project", "list", "-F", "json", "--non-interactive"];
      if (scope.teamSlug || scope.teamId) args.push("--scope", scope.teamSlug || scope.teamId || "");
      try {
        const { stdout } = await this.cliRunner(args);
        const payload = parseCliJson(stdout) as { projects?: RawVercelCliProject[]; contextName?: string };
        const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
        const teamSlug = scope.teamSlug || payload.contextName;
        cliDiagnostics.push(`vercel ${args.join(" ")} -> ${rawProjects.length} project${rawProjects.length === 1 ? "" : "s"}`);
        for (const rawProject of rawProjects) {
          const project = toCliProjectSummary(rawProject, expectedRepo, { teamId: scope.teamId, teamSlug });
          if (project) projectsById.set(project.id, project);
        }
      } catch (error) {
        cliDiagnostics.push(`vercel ${args.join(" ")} -> ${errorMessage(error)}`);
      }
    }

    const projects = [...projectsById.values()].sort((a, b) => {
      if (a.matchedRepo !== b.matchedRepo) return a.matchedRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return {
      ok: true,
      message: projects.length
        ? `Found ${projects.length} accessible Vercel project${projects.length === 1 ? "" : "s"}.`
        : "Vercel token and team are valid, but no projects were returned.",
      diagnostics: cliDiagnostics,
      projects,
      scope: projects[0] ? { teamId: projects[0].teamId, teamSlug: projects[0].teamSlug } : undefined
    };
  }

  private async cliScopes(input: Partial<ProjectListInput>, diagnostics: string[]): Promise<VercelCliScope[]> {
    const teams = await this.listCliTeams(diagnostics);
    if (input.teamSlug) {
      const team = teams.find((candidate) => candidate.slug === input.teamSlug);
      return [{ teamId: team?.id || input.teamId, teamSlug: input.teamSlug }];
    }
    if (input.teamId) {
      const team = teams.find((candidate) => candidate.id === input.teamId);
      return [{ teamId: input.teamId, teamSlug: team?.slug }];
    }
    const teamScopes = teams.map((team) => ({ teamId: team.id, teamSlug: team.slug })).filter((scope) => scope.teamId || scope.teamSlug);
    return teamScopes.length ? teamScopes : [{}];
  }

  private async listCliTeams(diagnostics: string[]): Promise<RawVercelCliTeam[]> {
    try {
      const { stdout } = await this.cliRunner(["teams", "ls", "-F", "json", "--non-interactive"]);
      const payload = parseCliJson(stdout) as { teams?: RawVercelCliTeam[] };
      const teams = Array.isArray(payload.teams) ? payload.teams : [];
      diagnostics.push(`vercel teams ls -F json --non-interactive -> ${teams.length} team${teams.length === 1 ? "" : "s"}`);
      return teams;
    } catch (error) {
      diagnostics.push(`vercel teams ls -F json --non-interactive -> ${errorMessage(error)}`);
      return [];
    }
  }
}

function verificationScopes(credentials: VercelProjectCredentials): Array<Pick<VercelProjectCredentials, "teamId" | "teamSlug">> {
  const scopes: Array<Pick<VercelProjectCredentials, "teamId" | "teamSlug">> = [];
  if (credentials.teamId) scopes.push({ teamId: credentials.teamId });
  if (credentials.teamSlug) scopes.push({ teamSlug: credentials.teamSlug });
  if (credentials.teamId && credentials.teamSlug) scopes.push({ teamId: credentials.teamId, teamSlug: credentials.teamSlug });
  scopes.push({});
  return scopes;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function scopeLabel(scope: Pick<VercelProjectCredentials, "teamId" | "teamSlug">): string {
  if (scope.teamId && scope.teamSlug) return " scoped by teamId and slug";
  if (scope.teamId) return " scoped by teamId";
  if (scope.teamSlug) return " scoped by slug";
  return " without team scope";
}

function redactProjectCandidate(projectId: string): string {
  if (projectId.startsWith("prj_")) return `${projectId.slice(0, 8)}...`;
  return projectId;
}

function repoFilters(repoUrl: string | undefined): Array<string | undefined> {
  const canonical = canonicalRepoUrl(repoUrl);
  const normalized = normalizeRepoUrl(repoUrl);
  return [...new Set([canonical, normalized, undefined].filter((value): value is string | undefined => value !== ""))];
}

function projectListRequests(
  input: Partial<ProjectListInput>,
  scope: Pick<VercelProjectCredentials, "teamId" | "teamSlug">
): Array<{ url: string; label: string; filterLabel: string }> {
  const endpoints = [
    { pathname: "/v10/projects", label: "GET /v10/projects" },
    { pathname: "/v9/projects", label: "GET /v9/projects" }
  ];
  const variants = projectListQueryVariants(input);
  const requests: Array<{ url: string; label: string; filterLabel: string }> = [];
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    for (const variant of variants) {
      const params = new URLSearchParams({ limit: "100" });
      if (scope.teamId) params.set("teamId", scope.teamId);
      if (scope.teamSlug) params.set("slug", scope.teamSlug);
      if (variant.repoUrl) params.set("repoUrl", variant.repoUrl);
      if (variant.search) params.set("search", variant.search);
      const url = `https://api.vercel.com${endpoint.pathname}?${params.toString()}`;
      if (seen.has(url)) continue;
      seen.add(url);
      requests.push({ url, label: endpoint.label, filterLabel: variant.label });
    }
  }
  return requests;
}

function projectListQueryVariants(input: Partial<ProjectListInput>): Array<{ repoUrl?: string; search?: string; label: string }> {
  const variants: Array<{ repoUrl?: string; search?: string; label: string }> = [{ label: "" }];
  for (const repoUrl of repoFilters(input.githubRepo).filter((value): value is string => Boolean(value))) {
    variants.push({ repoUrl, label: " with repoUrl" });
  }
  for (const search of uniqueNonEmpty([input.projectName, input.projectId]).filter((value) => !value.startsWith("prj_"))) {
    variants.push({ search, label: " with search" });
  }
  return variants;
}

function findMatchingProject(
  projects: RawVercelProject[],
  expected: { ids: string[]; names: string[]; githubRepo?: string }
): RawVercelProject | undefined {
  const ids = new Set(expected.ids.map((value) => value.toLowerCase()));
  const names = new Set(expected.names.map((value) => value.toLowerCase()));
  return projects.find((project) => {
    if (project.id && ids.has(project.id.toLowerCase())) return true;
    if (project.name && names.has(project.name.toLowerCase())) return true;
    if (expected.githubRepo && normalizeProjectRepo(project) === expected.githubRepo) return true;
    return false;
  });
}

function normalizeProjectsPayload(payload: unknown): RawVercelProject[] {
  if (Array.isArray(payload)) return payload.filter(isRawProject);
  if (payload && typeof payload === "object" && Array.isArray((payload as { projects?: unknown }).projects)) {
    return ((payload as { projects: unknown[] }).projects).filter(isRawProject);
  }
  return [];
}

function isRawProject(value: unknown): value is RawVercelProject {
  return Boolean(value && typeof value === "object" && ("id" in value || "name" in value));
}

function toProjectSummary(raw: RawVercelProject, expectedRepo?: string): VercelProjectSummary | undefined {
  if (!raw.id || !raw.name) return undefined;
  const repoUrl = normalizeProjectRepo(raw);
  return {
    id: raw.id,
    name: raw.name,
    accountId: raw.accountId,
    repoUrl,
    source: "api",
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    matchedRepo: Boolean(expectedRepo && repoUrl === expectedRepo)
  };
}

function toCliProjectSummary(raw: RawVercelCliProject, expectedRepo: string | undefined, scope: VercelCliScope): VercelProjectSummary | undefined {
  if (!raw.id || !raw.name) return undefined;
  return {
    id: raw.id,
    name: raw.name,
    productionUrl: raw.latestProductionUrl,
    teamId: scope.teamId,
    teamSlug: scope.teamSlug,
    source: "cli",
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    matchedRepo: Boolean(expectedRepo && raw.latestProductionUrl && normalizeRepoUrl(raw.latestProductionUrl) === expectedRepo)
  };
}

function normalizeRepoUrl(value: string | undefined): string | undefined {
  return canonicalRepoUrl(value)?.toLowerCase();
}

function canonicalRepoUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  return trimmed;
}

function normalizeRepoLink(link: RawVercelProject["link"]): string | undefined {
  if (!link || link.type !== "github" || !link.org || !link.repo) return undefined;
  return normalizeRepoUrl(`https://github.com/${link.org}/${link.repo}`);
}

function normalizeProjectRepo(project: RawVercelProject): string | undefined {
  const linkRepo = normalizeRepoLink(project.link);
  if (linkRepo) return linkRepo;
  const repository = project.gitRepository;
  if (!repository) return undefined;
  if (repository.repoUrl) return normalizeRepoUrl(repository.repoUrl);
  if (repository.url) return normalizeRepoUrl(repository.url);
  const owner = repository.org || repository.owner;
  if (repository.type === "github" && owner && repository.repo) return normalizeRepoUrl(`https://github.com/${owner}/${repository.repo}`);
  return undefined;
}

function normalizeApiToken(value: string | undefined): string {
  return value?.trim().replace(/^Bearer\s+/i, "").trim() || "";
}

function vercelVerificationErrorMessage(status: number): string {
  if (status === 401) return "Vercel API token was rejected. Check that the token is correct and still active.";
  if (status === 403) return "Vercel project is not accessible with this token, team ID, or team slug.";
  if (status === 404) return "Vercel project was not found for this token, team ID, or team slug.";
  return `Vercel project verification failed with HTTP ${status}.`;
}

export function newestReadyPreview(deployments: VercelDeployment[]): VercelDeployment | undefined {
  return deployments
    .filter((deployment) => deployment.url && deployment.state === "READY" && deployment.target !== "production")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

function normalizeDeployment(raw: RawVercelDeployment): VercelDeployment | undefined {
  const url = raw.url || "";
  const id = raw.uid || raw.id || "";
  const state = raw.readyState || raw.state || "";
  if (!url || !id) return undefined;
  const meta = raw.meta || {};
  return {
    id,
    url: toHttpsUrl(url),
    state,
    target: raw.target || undefined,
    branch: stringMeta(meta, ["githubCommitRef", "gitlabCommitRef", "bitbucketCommitRef"]),
    sha: stringMeta(meta, ["githubCommitSha", "gitlabCommitSha", "bitbucketCommitSha"]),
    createdAt: raw.createdAt || raw.created || 0,
    inspectorUrl: raw.inspectorUrl
  };
}

function toHttpsUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function stringMeta(meta: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function defaultVercelCliRunner(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("vercel", args, {
    timeout: 15000,
    env: {
      ...process.env,
      CI: "1",
      NO_COLOR: "1",
      VERCEL_NO_UPDATE_NOTIFIER: "1"
    },
    maxBuffer: 1024 * 1024
  });
}

function parseCliJson(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Vercel CLI did not return JSON.");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
