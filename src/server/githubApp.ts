import { createHmac, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { PrAutomationRun, RunReport } from "./types.js";

export type GitHubCheckConclusion = "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";

export interface GitHubAppConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  publicUrl?: string;
  appSlug?: string;
  installUrl?: string;
}

export interface GitHubMissingConfig {
  appId: boolean;
  privateKey: boolean;
  webhookSecret: boolean;
  installUrl: boolean;
  publicUrl: boolean;
}

export interface GitHubIntegrationConfigStatus {
  githubAppConfigured: boolean;
  githubWebhookSecretConfigured: boolean;
  githubInstallFlowConfigured: boolean;
  publicUrlConfigured: boolean;
  publicUrl: string;
  githubInstallUrl: string;
  githubMissingConfig: GitHubMissingConfig;
}

export interface CreateCheckInput {
  owner: string;
  repo: string;
  installationId: string;
  headSha: string;
  summary: string;
  detailsUrl?: string;
}

export interface UpdateCheckInput {
  owner: string;
  repo: string;
  installationId: string;
  checkRunId: string;
  status?: "queued" | "in_progress" | "completed";
  conclusion?: GitHubCheckConclusion;
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface StickyCommentInput {
  owner: string;
  repo: string;
  installationId: string;
  issueNumber: number;
  marker: string;
  body: string;
}

export interface GitHubChangedFileContext {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  patchTruncated: boolean;
}

export interface GitHubRepoFileContext {
  path: string;
  content: string;
  truncated: boolean;
}

export interface GitHubPullRequestContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  htmlUrl?: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  changedFiles: GitHubChangedFileContext[];
  repoFiles: GitHubRepoFileContext[];
  warnings: string[];
}

export interface GetPullRequestContextInput {
  owner: string;
  repo: string;
  installationId: string;
  prNumber: number;
  headSha?: string;
}

const MAX_CHANGED_FILES = 60;
const MAX_PATCH_CHARS = 1600;
const MAX_REPO_CONTEXT_FILES = 18;
const MAX_REPO_CONTEXT_FILE_CHARS = 3600;
const MAX_REPO_CONTEXT_TOTAL_CHARS = 24000;

export class GitHubAppClient {
  constructor(
    private config: GitHubAppConfig = githubConfigFromEnv(),
    private readonly octokitFactory: (token: string) => Octokit = (token) => new Octokit({ auth: token }),
    private readonly tokenProvider?: (type: "app" | "installation", installationId?: string) => Promise<string>
  ) {}

  updateConfig(config: GitHubAppConfig): void {
    this.config = { ...this.config, ...config };
  }

  isConfigured(): boolean {
    return Boolean(this.config.appId && this.config.privateKey && this.config.webhookSecret);
  }

  hasWebhookSecret(): boolean {
    return Boolean(this.config.webhookSecret);
  }

  isInstallFlowConfigured(): boolean {
    return Boolean(this.config.installUrl || this.config.appSlug);
  }

  isPublicUrlConfigured(): boolean {
    return Boolean(this.config.publicUrl);
  }

  publicUrl(): string {
    return this.config.publicUrl || "";
  }

  installationUrl(): string | undefined {
    if (this.config.installUrl) return this.config.installUrl;
    if (this.config.appSlug) return `https://github.com/apps/${encodeURIComponent(this.config.appSlug)}/installations/new`;
    return undefined;
  }

  missingConfig(): GitHubMissingConfig {
    return {
      appId: !this.config.appId,
      privateKey: !this.config.privateKey,
      webhookSecret: !this.config.webhookSecret,
      installUrl: !this.isInstallFlowConfigured(),
      publicUrl: !this.isPublicUrlConfigured()
    };
  }

  integrationStatus(): GitHubIntegrationConfigStatus {
    return {
      githubAppConfigured: this.isConfigured(),
      githubWebhookSecretConfigured: this.hasWebhookSecret(),
      githubInstallFlowConfigured: this.isInstallFlowConfigured(),
      publicUrlConfigured: this.isPublicUrlConfigured(),
      publicUrl: this.publicUrl(),
      githubInstallUrl: this.installationUrl() || "",
      githubMissingConfig: this.missingConfig()
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | string[] | undefined): boolean {
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!this.config.webhookSecret || !signature?.startsWith("sha256=")) return false;
    const digest = `sha256=${createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex")}`;
    const expected = Buffer.from(digest);
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async syncRepositoryInstallation(owner: string, repo: string): Promise<{ installationId: string; message: string }> {
    const octokit = await this.appOctokit();
    const response = await octokit.apps.getRepoInstallation({ owner, repo });
    return {
      installationId: String(response.data.id),
      message: `GitHub App installation ${response.data.id} can access ${owner}/${repo}.`
    };
  }

  async resolveInstallationRepository(
    installationId: string,
    preferred?: { owner: string; repo: string }
  ): Promise<{ owner: string; repo: string; message: string }> {
    const octokit = await this.installationOctokit(installationId);
    const response = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
    const repositories = response.data.repositories.map((repo) => ({
      owner: repo.owner.login,
      repo: repo.name
    }));
    const selected =
      (preferred &&
        repositories.find(
          (repo) => repo.owner.toLowerCase() === preferred.owner.toLowerCase() && repo.repo.toLowerCase() === preferred.repo.toLowerCase()
        )) ||
      repositories[0];
    if (!selected) {
      throw new Error("GitHub App installation has no accessible repositories.");
    }
    if (
      preferred &&
      (selected.owner.toLowerCase() !== preferred.owner.toLowerCase() || selected.repo.toLowerCase() !== preferred.repo.toLowerCase())
    ) {
      throw new Error(`GitHub App installation cannot access ${preferred.owner}/${preferred.repo}.`);
    }
    return {
      ...selected,
      message: `Connected GitHub App installation ${installationId} for ${selected.owner}/${selected.repo}.`
    };
  }

  async createQueuedCheck(input: CreateCheckInput): Promise<{ id: string; htmlUrl?: string }> {
    const octokit = await this.installationOctokit(input.installationId);
    const response = await octokit.checks.create({
      owner: input.owner,
      repo: input.repo,
      name: "Test Factory",
      head_sha: input.headSha,
      status: "queued",
      details_url: input.detailsUrl,
      output: {
        title: "Test Factory queued",
        summary: input.summary
      }
    });
    return { id: String(response.data.id), htmlUrl: response.data.html_url || undefined };
  }

  async updateCheck(input: UpdateCheckInput): Promise<void> {
    const octokit = await this.installationOctokit(input.installationId);
    await octokit.checks.update({
      owner: input.owner,
      repo: input.repo,
      check_run_id: Number(input.checkRunId),
      status: input.status,
      conclusion: input.conclusion,
      completed_at: input.status === "completed" ? new Date().toISOString() : undefined,
      details_url: input.detailsUrl,
      output: {
        title: input.title,
        summary: input.summary
      }
    });
  }

  async upsertStickyComment(input: StickyCommentInput): Promise<{ id: string; htmlUrl?: string }> {
    const octokit = await this.installationOctokit(input.installationId);
    const comments = await octokit.issues.listComments({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      per_page: 100
    });
    const existing = comments.data.find((comment) => comment.body?.includes(input.marker));
    if (existing) {
      const updated = await octokit.issues.updateComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: existing.id,
        body: input.body
      });
      return { id: String(updated.data.id), htmlUrl: updated.data.html_url || undefined };
    }
    const created = await octokit.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issueNumber,
      body: input.body
    });
    return { id: String(created.data.id), htmlUrl: created.data.html_url || undefined };
  }

  async getPullRequestContext(input: GetPullRequestContextInput): Promise<GitHubPullRequestContext> {
    const octokit = await this.installationOctokit(input.installationId);
    const pr = await octokit.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber
    });
    const fileResponses = await octokit.paginate(octokit.pulls.listFiles, {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      per_page: 100
    });
    const files = fileResponses.slice(0, MAX_CHANGED_FILES).map((file) => normalizeChangedFile(file as ChangedFileResponse));
    const warnings: string[] = [];
    if (fileResponses.length > MAX_CHANGED_FILES) {
      warnings.push(`Changed file context was capped at ${MAX_CHANGED_FILES} of ${fileResponses.length} files.`);
    }

    const headSha = String(pr.data.head?.sha || input.headSha || "");
    const repoFiles = await this.fetchRelevantRepoFiles(octokit, input.owner, input.repo, headSha, files, warnings);

    return {
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      title: pr.data.title || "",
      body: pr.data.body || "",
      htmlUrl: pr.data.html_url || undefined,
      baseRef: pr.data.base?.ref || "",
      baseSha: pr.data.base?.sha || "",
      headRef: pr.data.head?.ref || "",
      headSha,
      changedFiles: files,
      repoFiles,
      warnings
    };
  }

  private async fetchRelevantRepoFiles(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref: string,
    changedFiles: GitHubChangedFileContext[],
    warnings: string[]
  ): Promise<GitHubRepoFileContext[]> {
    if (!ref) return [];
    const candidates = selectRelevantRepoFilePaths(changedFiles);
    const repoFiles: GitHubRepoFileContext[] = [];
    let totalChars = 0;
    for (const filePath of candidates) {
      if (repoFiles.length >= MAX_REPO_CONTEXT_FILES || totalChars >= MAX_REPO_CONTEXT_TOTAL_CHARS) break;
      try {
        const response = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref
        });
        const data = response.data as RepositoryContentResponse;
        if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") continue;
        const raw = Buffer.from(data.content, (data.encoding || "base64") as BufferEncoding).toString("utf8");
        const remaining = MAX_REPO_CONTEXT_TOTAL_CHARS - totalChars;
        const content = raw.slice(0, Math.min(MAX_REPO_CONTEXT_FILE_CHARS, remaining));
        if (!content.trim()) continue;
        repoFiles.push({ path: filePath, content, truncated: raw.length > content.length });
        totalChars += content.length;
      } catch (error) {
        warnings.push(`Could not fetch changed repo file ${filePath}: ${formatGitHubContextError(error)}`);
      }
    }
    return repoFiles;
  }

  private async appOctokit(): Promise<Octokit> {
    if (this.tokenProvider) {
      return this.octokitFactory(await this.tokenProvider("app"));
    }
    const auth = createAppAuth({
      appId: this.requiredAppId(),
      privateKey: normalizePrivateKey(this.requiredPrivateKey())
    });
    const result = (await auth({ type: "app" })) as { token: string };
    return this.octokitFactory(result.token);
  }

  private async installationOctokit(installationId: string): Promise<Octokit> {
    if (this.tokenProvider) {
      return this.octokitFactory(await this.tokenProvider("installation", installationId));
    }
    const auth = createAppAuth({
      appId: this.requiredAppId(),
      privateKey: normalizePrivateKey(this.requiredPrivateKey())
    });
    const result = (await auth({ type: "installation", installationId: Number(installationId) })) as { token: string };
    return this.octokitFactory(result.token);
  }

  private requiredAppId(): string {
    if (!this.config.appId) throw new Error("GitHub App ID is required.");
    return this.config.appId;
  }

  private requiredPrivateKey(): string {
    if (!this.config.privateKey) throw new Error("GitHub App private key is required.");
    return this.config.privateKey;
  }
}

interface ChangedFileResponse {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

type RepositoryContentResponse =
  | {
      type?: string;
      content?: string;
      encoding?: string;
    }
  | Array<unknown>;

function normalizeChangedFile(file: ChangedFileResponse): GitHubChangedFileContext {
  const rawPatch = file.patch || "";
  const patch = rawPatch ? rawPatch.slice(0, MAX_PATCH_CHARS) : undefined;
  return {
    path: file.filename || "",
    status: file.status || "",
    additions: Number(file.additions || 0),
    deletions: Number(file.deletions || 0),
    patch,
    patchTruncated: rawPatch.length > MAX_PATCH_CHARS
  };
}

function selectRelevantRepoFilePaths(changedFiles: GitHubChangedFileContext[]): string[] {
  const direct = changedFiles
    .filter((file) => file.status !== "removed")
    .map((file) => file.path)
    .filter(isLikelyTextRepoFile)
    .sort((a, b) => filePriority(a) - filePriority(b));
  return dedupe([
    ...direct,
    "README.md",
    "package.json",
    "src/App.tsx",
    "app/page.tsx",
    "pages/index.tsx"
  ]).slice(0, MAX_REPO_CONTEXT_FILES);
}

function isLikelyTextRepoFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!filePath || /(^|\/)(node_modules|dist|build|coverage|\.next|\.git|public\/assets)\//.test(lower)) return false;
  return /\.(tsx?|jsx?|mdx?|css|scss|json|ya?ml|md)$/i.test(filePath);
}

function filePriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  if (/(^|\/)(app|pages|routes|src\/app|src\/pages|src\/routes)\//.test(lower)) return 0;
  if (/\.(tsx?|jsx?)$/.test(lower)) return 1;
  if (/(^|\/)package\.json$/.test(lower)) return 2;
  if (/(^|\/)readme(\.[a-z0-9]+)?$/.test(lower)) return 3;
  return 8;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function formatGitHubContextError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "status" in error) return `HTTP ${(error as { status: unknown }).status}`;
  return String(error);
}

export function githubConfigFromEnv(): GitHubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    publicUrl: process.env.QA_SMOKE_PUBLIC_URL,
    appSlug: process.env.GITHUB_APP_SLUG,
    installUrl: process.env.GITHUB_APP_INSTALL_URL
  };
}

export function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export function checkConclusionForReports(reports: Array<RunReport | undefined>): GitHubCheckConclusion {
  if (reports.length === 0) return "neutral";
  if (reports.some((report) => !report || report.outcome === "failed")) return "failure";
  return "success";
}

export function stickyCommentMarker(projectId: string): string {
  return `<!-- qa-smoke-pr-preview:${projectId} -->`;
}

export function renderStickyComment(input: {
  prRun: PrAutomationRun;
  projectName: string;
  previewUrl?: string;
  appUrl?: string;
  reports: Array<RunReport | undefined>;
}): string {
  const marker = stickyCommentMarker(input.prRun.projectId);
  const status = input.prRun.status === "passed" ? "passed" : input.prRun.status === "failed" ? "failed" : input.prRun.status;
  const runList = input.prRun.runIds.length > 0 ? input.prRun.runIds.map((id) => `- Run \`${id}\``).join("\n") : "- No Test Factory runs were created.";
  const failures = input.reports
    .filter((report): report is RunReport => Boolean(report?.errors.length))
    .flatMap((report) => report.errors.slice(0, 3))
    .slice(0, 6);
  const failureBlock = failures.length > 0 ? ["", "Failures:", ...failures.map((failure) => `- ${failure}`)].join("\n") : "";
  const fixPromptSummary = input.reports.find((report) => report?.fixPrompt)?.fixPrompt?.text.split(/\r?\n/).find(Boolean);

  return [
    marker,
    `## Test Factory ${status}`,
    "",
    `Project: **${input.projectName}**`,
    `Preview: ${input.previewUrl || input.prRun.previewUrl || "not resolved"}`,
    `Head SHA: \`${input.prRun.headSha}\``,
    input.appUrl ? `Test Factory: ${input.appUrl}` : undefined,
    "",
    "Runs:",
    runList,
    failureBlock,
    fixPromptSummary ? ["", `Fix prompt summary: ${fixPromptSummary}`].join("\n") : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
