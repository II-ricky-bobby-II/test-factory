import Anthropic from "@anthropic-ai/sdk";
import { ClaudeIntegrationError, safeClaudeErrorMessage } from "./claudeErrors.js";
import { parseClaudeJson } from "./claudeJson.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import type { GitHubPullRequestContext } from "./githubApp.js";
import type { PrTestDraftAccessTag, PrTestDraftPriority, PrTestRecommendationSource, ReusableTestStep } from "./types.js";

const MAX_DRAFTS = 30;
const MAX_STEPS_PER_DRAFT = 8;

export interface PrTestRecommendationRequest {
  projectName: string;
  projectDeploymentUrl: string;
  githubRepo: string;
  previewUrl?: string;
  pr: GitHubPullRequestContext;
}

export interface RecommendedPrTestDraft {
  title: string;
  rationale: string;
  priority: PrTestDraftPriority;
  impactedFiles: string[];
  accessTags: PrTestDraftAccessTag[];
  runnable: boolean;
  manualReason?: string;
  sourcePrompt: string;
  steps: ReusableTestStep[];
}

export interface PrTestRecommendationResult {
  source: PrTestRecommendationSource;
  summary: string;
  drafts: RecommendedPrTestDraft[];
  model?: string;
  tokenUsage?: Record<string, number>;
  warning?: string;
}

export type PrTestRecommender = (request: PrTestRecommendationRequest) => Promise<PrTestRecommendationResult>;

export async function recommendPrTestDrafts(request: PrTestRecommendationRequest): Promise<PrTestRecommendationResult> {
  if (!isClaudeConfigured()) {
    return fallbackRecommendations(request, "Claude recommendations need ANTHROPIC_API_KEY; generated local draft suggestions instead.");
  }

  const model = getClaudeModel();
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 6000,
      system: [
        "You are a senior QA engineer designing PR-specific user-flow tests.",
        "Use the repository context, pull request metadata, changed files, and patches to infer all materially impacted user-facing flows.",
        "Return exhaustive but practical draft tests, capped at 30.",
        "Drafts must be app-reviewable, reusable-test-compatible, and safe for browser QA.",
        "Use accessTags to mark auth, credentials, privileged, billing, or payment requirements.",
        "Do not mark a draft manual only because it involves auth, admin, billing, credentials, or privileged access.",
        "Set runnable false only when the flow is genuinely not automatable from browser-observable steps.",
        "Do not include hidden chain-of-thought. Return JSON only."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            project: {
              name: request.projectName,
              deploymentUrl: request.projectDeploymentUrl,
              githubRepo: request.githubRepo,
              previewUrl: request.previewUrl
            },
            pullRequest: {
              number: request.pr.prNumber,
              title: request.pr.title,
              body: request.pr.body,
              url: request.pr.htmlUrl,
              baseRef: request.pr.baseRef,
              baseSha: request.pr.baseSha,
              headRef: request.pr.headRef,
              headSha: request.pr.headSha
            },
            changedFiles: request.pr.changedFiles.map((file) => ({
              path: file.path,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              patch: file.patch,
              patchTruncated: file.patchTruncated
            })),
            repoFiles: request.pr.repoFiles.map((file) => ({
              path: file.path,
              content: file.content,
              truncated: file.truncated
            })),
            warnings: request.pr.warnings,
            requiredShape: {
              summary: "One short sentence summarizing why these drafts cover the PR.",
              drafts: [
                {
                  title: "User-facing flow title",
                  rationale: "Why this PR needs the test",
                  priority: "critical | high | medium | low",
                  impactedFiles: ["src/path.tsx"],
                  accessTags: ["auth | credentials | privileged | billing | payment"],
                  runnable: true,
                  manualReason: "Required only when runnable is false for a non-access-control reason",
                  sourcePrompt: "Prompt Test Factory should use if promoted as a reusable test",
                  steps: [
                    {
                      type: "act | assert | login | screenshot",
                      title: "Short step title",
                      detail: "Specific browser-observable instruction"
                    }
                  ]
                }
              ]
            }
          })
        }
      ]
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    const parsed = parseRecommendationJson(parseClaudeJson(text), request);
    return {
      source: "claude",
      model,
      tokenUsage: normalizeUsage(response.usage),
      ...parsed
    };
  } catch (error) {
    if (error instanceof ClaudeIntegrationError) throw error;
    throw new ClaudeIntegrationError(`Claude PR test recommendation failed: ${safeClaudeErrorMessage(error)}`);
  }
}

function parseRecommendationJson(value: unknown, request: PrTestRecommendationRequest): Pick<PrTestRecommendationResult, "summary" | "drafts"> {
  if (!value || typeof value !== "object") {
    throw new ClaudeIntegrationError("Claude returned an invalid PR test recommendation JSON shape.");
  }
  const body = value as Record<string, unknown>;
  const rawDrafts = firstArray(body, ["drafts", "tests", "recommendations", "userFlowTests"]);
  if (!rawDrafts || rawDrafts.length === 0) {
    throw new ClaudeIntegrationError("Claude recommendation JSON did not include a non-empty drafts array.");
  }

  const drafts = rawDrafts.slice(0, MAX_DRAFTS).map((draft, index) => normalizeClaudeDraft(draft, index, request)).filter(Boolean);
  if (drafts.length === 0) {
    throw new ClaudeIntegrationError("Claude recommendation JSON did not include usable PR test drafts.");
  }
  const summary = firstString(body, ["summary", "rationale", "reason"]) || `Generated ${drafts.length} PR-aware user-flow test draft${drafts.length === 1 ? "" : "s"}.`;
  return { summary, drafts };
}

function normalizeClaudeDraft(value: unknown, index: number, request: PrTestRecommendationRequest): RecommendedPrTestDraft {
  if (!value || typeof value !== "object") {
    throw new ClaudeIntegrationError("Claude recommendation draft was not an object.");
  }
  const draft = value as Record<string, unknown>;
  const title = firstString(draft, ["title", "name", "flow", "summary"]) || `PR user flow ${index + 1}`;
  const rationale = firstString(draft, ["rationale", "reason", "why", "description"]) || `Covers user-facing behavior changed by PR #${request.pr.prNumber}.`;
  const priority = normalizePriority(firstString(draft, ["priority", "risk", "severity"]));
  const impactedFiles = stringArray(firstArray(draft, ["impactedFiles", "files", "paths"])).filter(Boolean);
  const rawSteps = firstArray(draft, ["steps", "testSteps", "flowSteps", "actions"]);
  const steps = normalizeSteps(rawSteps || [], title);
  const accessTags = normalizeAccessTags(firstArray(draft, ["accessTags", "tags", "requirements"]), title, rationale, steps);
  const sourcePrompt =
    firstString(draft, ["sourcePrompt", "prompt", "testPrompt"]) ||
    composeSourcePrompt({ title, rationale, impactedFiles, request, steps });
  const explicitRunnable = typeof draft.runnable === "boolean" ? draft.runnable : typeof draft.automatable === "boolean" ? draft.automatable : true;
  const manualReason = firstString(draft, ["manualReason", "credentialNotes", "manualNotes", "notes"]);

  return {
    title: concise(title, 140),
    rationale: concise(rationale, 800),
    priority,
    impactedFiles: impactedFiles.length ? impactedFiles.slice(0, 12) : request.pr.changedFiles.map((file) => file.path).slice(0, 6),
    accessTags,
    runnable: explicitRunnable,
    manualReason: explicitRunnable ? undefined : manualReason || "This flow needs manual review for a reason other than auth or privilege.",
    sourcePrompt: concise(sourcePrompt, 1800),
    steps
  };
}

function normalizeSteps(values: unknown[], title: string): ReusableTestStep[] {
  const steps = values
    .slice(0, MAX_STEPS_PER_DRAFT)
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is ReusableTestStep => Boolean(step));
  if (steps.length > 0) return steps;
  return [
    {
      id: "step-1",
      type: "act",
      title: concise(title, 120),
      detail: `Open the PR preview and exercise the ${title} flow.`
    },
    {
      id: "step-2",
      type: "assert",
      title: "Confirm regression-free result",
      detail: "Confirm the flow completes without visible errors, broken layout, or unexpected redirects."
    }
  ];
}

function normalizeStep(value: unknown, index: number): ReusableTestStep | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    return {
      id: `step-${index + 1}`,
      type: inferStepType(text),
      title: concise(text, 120),
      detail: text
    };
  }
  if (!value || typeof value !== "object") {
    throw new ClaudeIntegrationError("Claude recommendation step was not a string or object.");
  }
  const step = value as Record<string, unknown>;
  const detail = firstString(step, ["detail", "instruction", "description", "step", "action", "task"]) || firstString(step, ["title", "name", "label"]);
  const title = firstString(step, ["title", "name", "label", "summary"]) || detail;
  if (!title || !detail) {
    throw new ClaudeIntegrationError("Claude recommendation step was missing usable title/detail text.");
  }
  const rawType = firstString(step, ["type", "kind"]);
  return {
    id: `step-${index + 1}`,
    type: normalizeStepType(rawType, `${title} ${detail}`),
    title: concise(title, 120),
    detail: concise(detail, 1000)
  };
}

function fallbackRecommendations(request: PrTestRecommendationRequest, warning?: string): PrTestRecommendationResult {
  const changedFiles = request.pr.changedFiles.map((file) => file.path).filter(Boolean);
  const flowFiles = changedFiles.filter((file) => /(^|\/)(app|pages|routes|src\/app|src\/pages|src\/routes|src\/components)\//i.test(file));
  const candidateFiles = (flowFiles.length ? flowFiles : changedFiles).slice(0, Math.min(MAX_DRAFTS, 8));
  const drafts =
    candidateFiles.length > 0
      ? candidateFiles.map((filePath) => fallbackDraftForFile(filePath, request))
      : [fallbackDraftForFile("PR changes", request)];

  return {
    source: "fallback",
    summary: `Generated ${drafts.length} local PR-aware draft${drafts.length === 1 ? "" : "s"} from changed files.`,
    drafts,
    warning
  };
}

function fallbackDraftForFile(filePath: string, request: PrTestRecommendationRequest): RecommendedPrTestDraft {
  const title = filePath === "PR changes" ? "Review changed user flows" : `Review ${flowNameFromPath(filePath)} flow`;
  const impactedFiles = filePath === "PR changes" ? request.pr.changedFiles.map((file) => file.path).slice(0, 6) : [filePath];
  const rationale = `The PR changes ${filePath}, which may affect an observable user flow.`;
  const accessTags = inferAccessTags(`${filePath} ${title} ${rationale}`, []);
  const steps: ReusableTestStep[] = [
    {
      id: "step-1",
      type: "act",
      title: "Open PR preview",
      detail: "Open the PR preview URL and wait for the app shell to finish loading."
    },
    {
      id: "step-2",
      type: accessTags.includes("auth") || accessTags.includes("credentials") ? "login" : "act",
      title: accessTags.length ? "Reach the protected surface" : "Exercise impacted path",
      detail: accessTags.length
        ? "Use appropriate QA credentials or a seeded session to reach the protected surface affected by this PR."
        : `Navigate to the user-facing area affected by ${filePath}.`
    },
    {
      id: "step-3",
      type: "assert",
      title: "Confirm expected behavior",
      detail: "Confirm the changed flow works without visible errors, unexpected redirects, console-facing failure states, or broken layout."
    }
  ];
  return {
    title,
    rationale,
    priority: accessTags.length ? "high" : "medium",
    impactedFiles,
    accessTags,
    runnable: true,
    sourcePrompt: composeSourcePrompt({ title, rationale, impactedFiles, request, steps }),
    steps
  };
}

function composeSourcePrompt(input: {
  title: string;
  rationale: string;
  impactedFiles: string[];
  request: PrTestRecommendationRequest;
  steps: ReusableTestStep[];
}): string {
  return [
    `PR #${input.request.pr.prNumber}: ${input.request.pr.title || input.title}`,
    "",
    `Goal: ${input.title}.`,
    `Why: ${input.rationale}`,
    input.impactedFiles.length ? `Impacted files: ${input.impactedFiles.join(", ")}` : undefined,
    "",
    "Steps:",
    ...input.steps.map((step, index) => `${index + 1}. ${step.detail}`),
    "",
    "Expected: The user-facing flow completes without visible errors, unexpected redirects, broken layout, or data loss."
  ]
    .filter(Boolean)
    .join("\n");
}

function firstArray(body: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function firstString(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(values: unknown[] | undefined): string[] {
  return (values || []).filter((value): value is string => typeof value === "string").map((value) => value.trim());
}

function normalizePriority(value: string | undefined): PrTestDraftPriority {
  const normalized = value?.toLowerCase().trim();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  if (normalized === "p0" || normalized === "blocker") return "critical";
  if (normalized === "p1" || normalized === "major") return "high";
  if (normalized === "p3" || normalized === "minor") return "low";
  return "medium";
}

function normalizeStepType(value: string | undefined, text: string): ReusableTestStep["type"] {
  const normalized = value?.toLowerCase().trim();
  if (normalized === "act" || normalized === "assert" || normalized === "login" || normalized === "screenshot") return normalized;
  return inferStepType(text);
}

function inferStepType(text: string): ReusableTestStep["type"] {
  if (/\b(?:log ?in|sign ?in|authenticate|credentials?|session)\b/i.test(text)) return "login";
  if (/\b(?:screenshot|capture)\b/i.test(text)) return "screenshot";
  if (/\b(?:assert|confirm|verify|check|expect|without|no visible|no error)\b/i.test(text)) return "assert";
  return "act";
}

function normalizeAccessTags(values: unknown[] | undefined, title: string, rationale: string, steps: ReusableTestStep[]): PrTestDraftAccessTag[] {
  return inferAccessTags(
    `${title} ${rationale} ${steps.map((step) => `${step.title} ${step.detail}`).join(" ")}`,
    stringArray(values)
  );
}

function inferAccessTags(text: string, explicitTags: string[]): PrTestDraftAccessTag[] {
  const normalized = explicitTags
    .map((tag) => tag.toLowerCase().replace(/[^a-z]/g, ""))
    .flatMap((tag): PrTestDraftAccessTag[] => {
      if (tag === "auth" || tag === "authentication" || tag === "login" || tag === "session") return ["auth"];
      if (tag === "credential" || tag === "credentials") return ["credentials"];
      if (tag === "privileged" || tag === "privilege" || tag === "admin" || tag === "permission" || tag === "permissions" || tag === "role") {
        return ["privileged"];
      }
      if (tag === "billing" || tag === "invoice" || tag === "invoices") return ["billing"];
      if (tag === "payment" || tag === "payments") return ["payment"];
      return [];
    });
  const inferred: PrTestDraftAccessTag[] = [];
  if (/\b(?:log ?in|sign ?in|authenticate|session)\b/i.test(text)) inferred.push("auth");
  if (/\bcredentials?\b/i.test(text)) inferred.push("credentials");
  if (/\b(?:admin|permission|role|privileged)\b/i.test(text)) inferred.push("privileged");
  if (/\bbilling|invoice\b/i.test(text)) inferred.push("billing");
  if (/\bpayments?\b/i.test(text)) inferred.push("payment");
  return dedupeAccessTags([...normalized, ...inferred]);
}

function dedupeAccessTags(tags: PrTestDraftAccessTag[]): PrTestDraftAccessTag[] {
  const seen = new Set<PrTestDraftAccessTag>();
  return tags.filter((tag) => {
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

function flowNameFromPath(filePath: string): string {
  const clean = filePath
    .replace(/\.[cm]?[jt]sx?$/i, "")
    .replace(/\.(mdx?|css|scss|json|ya?ml)$/i, "")
    .split("/")
    .filter((part) => part && !["src", "app", "pages", "routes", "components", "index", "page"].includes(part.toLowerCase()))
    .slice(-2)
    .join(" ");
  return clean || filePath;
}

function concise(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trim()}...`;
}

function normalizeUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}
