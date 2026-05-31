export interface RepoContextFile {
  path: string;
  content: string;
}

export interface RepoContext {
  source: "none" | "github";
  repoUrl: string;
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  files: RepoContextFile[];
  warnings: string[];
  summary: string;
}

interface GitHubRepoMetadata {
  default_branch?: string;
  description?: string | null;
  full_name?: string;
}

interface GitHubTreeItem {
  path?: string;
  type?: string;
  size?: number;
}

const MAX_CONTEXT_FILES = 12;
const MAX_FILE_CHARS = 2200;
const MAX_TOTAL_CHARS = 14000;

export async function buildRepoContext(githubRepo: string): Promise<RepoContext> {
  const parsed = parseGitHubRepoUrl(githubRepo);
  if (!parsed) {
    return {
      source: "none",
      repoUrl: githubRepo,
      files: [],
      warnings: githubRepo.trim() ? [`Could not parse GitHub repo URL: ${githubRepo}`] : [],
      summary: githubRepo.trim() ? "No repo context included; GitHub URL could not be parsed." : "No repo context included; no GitHub repo URL was provided."
    };
  }

  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const warnings: string[] = [];
  try {
    const metadata = await fetchJson<GitHubRepoMetadata>(base);
    const defaultBranch = metadata.default_branch || "main";
    const tree = await fetchJson<{ tree?: GitHubTreeItem[] }>(`${base}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`);
    const candidates = selectContextFiles(tree.tree || []);
    const files: RepoContextFile[] = [];
    let totalChars = 0;

    for (const item of candidates) {
      if (!item.path || totalChars >= MAX_TOTAL_CHARS) break;
      try {
        const raw = await fetchText(rawGitHubUrl(parsed.owner, parsed.repo, defaultBranch, item.path));
        const remaining = MAX_TOTAL_CHARS - totalChars;
        const content = raw.slice(0, Math.min(MAX_FILE_CHARS, remaining));
        if (!content.trim()) continue;
        files.push({ path: item.path, content });
        totalChars += content.length;
      } catch (error) {
        warnings.push(`Could not fetch repo file ${item.path}: ${formatFetchError(error)}`);
      }
    }

    return {
      source: "github",
      repoUrl: parsed.url,
      owner: parsed.owner,
      repo: parsed.repo,
      defaultBranch,
      files,
      warnings,
      summary: `Included ${files.length} public GitHub repo file${files.length === 1 ? "" : "s"} from ${parsed.owner}/${parsed.repo}.`
    };
  } catch (error) {
    return {
      source: "github",
      repoUrl: parsed.url,
      owner: parsed.owner,
      repo: parsed.repo,
      files: [],
      warnings: [`Could not fetch public GitHub repo context for ${parsed.owner}/${parsed.repo}: ${formatFetchError(error)}`],
      summary: `No repo files included from ${parsed.owner}/${parsed.repo}.`
    };
  }
}

export function parseGitHubRepoUrl(value: string): { owner: string; repo: string; url: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  if (ssh) {
    return {
      owner: ssh[1],
      repo: stripGitSuffix(ssh[2]),
      url: `https://github.com/${ssh[1]}/${stripGitSuffix(ssh[2])}`
    };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return undefined;
    return {
      owner,
      repo: stripGitSuffix(repo),
      url: `https://github.com/${owner}/${stripGitSuffix(repo)}`
    };
  } catch {
    return undefined;
  }
}

function selectContextFiles(tree: GitHubTreeItem[]): GitHubTreeItem[] {
  return tree
    .filter((item) => item.type === "blob" && item.path && isLikelyTextContextFile(item.path) && (item.size || 0) <= 120_000)
    .sort((a, b) => filePriority(a.path || "") - filePriority(b.path || ""))
    .slice(0, MAX_CONTEXT_FILES);
}

function isLikelyTextContextFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(node_modules|dist|build|coverage|\.next|\.git|public\/assets)\//.test(lower)) return false;
  return (
    /(^|\/)readme(\.[a-z0-9]+)?$/i.test(path) ||
    /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|tsconfig\.json)$/i.test(path) ||
    /(^|\/)(app|pages|routes|src\/app|src\/pages|src\/routes)\//i.test(path) ||
    /\.(tsx?|jsx?|mdx?|json)$/i.test(path)
  );
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  if (/(^|\/)readme(\.[a-z0-9]+)?$/.test(lower)) return 0;
  if (/(^|\/)package\.json$/.test(lower)) return 1;
  if (/(^|\/)(app|pages|routes|src\/app|src\/pages|src\/routes)\//.test(lower)) return 2;
  if (/(^|\/)(next|vite)\.config\./.test(lower)) return 3;
  if (/\.(tsx?|jsx?)$/.test(lower)) return 4;
  return 10;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "test-factory"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "test-factory"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function rawGitHubUrl(owner: string, repo: string, branch: string, filePath: string): string {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function formatFetchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
