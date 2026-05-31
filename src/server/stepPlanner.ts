import Anthropic from "@anthropic-ai/sdk";
import { ClaudeIntegrationError, safeClaudeErrorMessage } from "./claudeErrors.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import { parseClaudeJson } from "./claudeJson.js";
import type { RepoContext } from "./repoContext.js";
import type { RunRequest, SmokeStep } from "./types.js";

const MAX_STEPS = 8;

export interface ClaudePlanDiagnostics {
  model: string;
  tokenUsage?: Record<string, number>;
  repoContextFileCount: number;
  repoContextSummary: string;
  repoContextWarnings: string[];
}

export interface ClaudeSmokePlan {
  steps: SmokeStep[];
  diagnostics: ClaudePlanDiagnostics;
}

export function planFallbackSteps(request: Pick<RunRequest, "smokePrompt" | "credentials">): SmokeStep[] {
  const promptSteps = extractExplicitSteps(request.smokePrompt);
  const steps = promptSteps.length > 0 ? promptSteps : splitPromptIntoIntentSteps(request.smokePrompt);
  return composeFallbackSmokeSteps(request, steps);
}

export async function planClaudeSmokeSteps(request: RunRequest, repoContext: RepoContext): Promise<ClaudeSmokePlan> {
  if (!isClaudeConfigured()) {
    throw new ClaudeIntegrationError("Browser mode requires ANTHROPIC_API_KEY; Claude planning is not configured.");
  }

  const model = getClaudeModel();
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1200,
      system: [
        "You are planning a safe browser QA smoke test.",
        "Create the exact browser-observable steps the app should display and execute.",
        "Include navigation to the deployment URL as a step when needed.",
        "Use the repo context to understand product routes, labels, and expected surfaces.",
        "Do not include destructive or data-mutating actions.",
        "Return JSON only. Do not include hidden chain-of-thought."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            deploymentUrl: request.deploymentUrl,
            githubRepo: request.githubRepo,
            credentialsSupplied: Boolean(request.credentials?.username && request.credentials?.password),
            userPrompt: request.smokePrompt,
            repoContext: {
              summary: repoContext.summary,
              warnings: repoContext.warnings,
              files: repoContext.files.map((file) => ({
                path: file.path,
                content: file.content
              }))
            },
            requiredShape: {
              steps: [
                {
                  title: "Short UI label for the step",
                  detail: "Specific browser-observable instruction for Claude to execute"
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
    const steps = extractClaudeSteps(parseClaudeJson(text));
    return {
      steps,
      diagnostics: {
        model,
        tokenUsage: normalizeUsage(response.usage),
        repoContextFileCount: repoContext.files.length,
        repoContextSummary: repoContext.summary,
        repoContextWarnings: repoContext.warnings
      }
    };
  } catch (error) {
    if (error instanceof ClaudeIntegrationError) throw error;
    throw new ClaudeIntegrationError(`Claude planning failed: ${safeClaudeErrorMessage(error)}`);
  }
}

function extractClaudeSteps(value: unknown): SmokeStep[] {
  if (!value || typeof value !== "object") {
    throw new ClaudeIntegrationError("Claude returned an invalid planning JSON shape.");
  }
  const body = value as Record<string, unknown>;
  const rawSteps = firstArray(body, ["steps", "testSteps", "checkpoints", "plan"]);
  if (!rawSteps || rawSteps.length === 0) {
    throw new ClaudeIntegrationError("Claude planning JSON did not include a non-empty steps array.");
  }

  const steps = rawSteps.slice(0, MAX_STEPS).map((step, index) => normalizeClaudeStep(step, index)).filter(Boolean);
  if (steps.length === 0) {
    throw new ClaudeIntegrationError("Claude planning JSON did not include usable step text.");
  }
  return steps;
}

function normalizeClaudeStep(step: unknown, index: number): SmokeStep {
  if (typeof step === "string") {
    return smokeStepFromText(step, step, index);
  }
  if (!step || typeof step !== "object") {
    throw new ClaudeIntegrationError("Claude planning step was not a string or object.");
  }
  const candidate = step as Record<string, unknown>;
  const title =
    firstString(candidate, ["title", "name", "label", "summary"]) ||
    firstString(candidate, ["detail", "instruction", "description", "step", "action", "task"]);
  const detail =
    firstString(candidate, ["detail", "instruction", "description", "step", "action", "task"]) ||
    firstString(candidate, ["title", "name", "label", "summary"]);
  if (!title || !detail) {
    throw new ClaudeIntegrationError("Claude planning step was missing usable title/detail text.");
  }
  return smokeStepFromText(title, detail, index);
}

function smokeStepFromText(title: string, detail: string, index: number): SmokeStep {
  const cleanTitle = title.trim();
  const cleanDetail = detail.trim();
  if (!cleanTitle || !cleanDetail) {
    throw new ClaudeIntegrationError("Claude planning step text was empty.");
  }
  return {
    id: `step-${index + 1}`,
    title: conciseTitle(cleanTitle),
    detail: cleanDetail,
    status: "pending"
  };
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

function composeFallbackSmokeSteps(request: Pick<RunRequest, "smokePrompt" | "credentials">, steps: string[]): SmokeStep[] {
  const normalized = normalizeSteps(steps)
    .flatMap(splitCompoundStep)
    .map(removeLoginDirective)
    .filter(Boolean)
    .filter((step) => !isDeploymentOpenDirective(step));
  const needsLogin = Boolean(request.credentials?.username && request.credentials?.password);

  const full = [
    "Open the deployment URL and wait for the app shell.",
    ...(needsLogin ? ["Log in with the provided QA credentials."] : []),
    ...normalized,
    "Confirm the requested flow completed without visible error banners, unexpected redirects, or broken UI."
  ];

  return dedupe(full)
    .slice(0, MAX_STEPS)
    .map((title, index) => ({
      id: `step-${index + 1}`,
      title: conciseTitle(title),
      detail: title,
      status: "pending"
    }));
}

function extractExplicitSteps(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length > 5)
    .filter((line) => /^(open|log|sign|click|select|go|navigate|confirm|verify|assert|reach|submit|choose|view|test)\b/i.test(line));
}

function splitPromptIntoIntentSteps(prompt: string): string[] {
  return prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\bthen\b|\band then\b/gi)
    .map((part) => part.trim())
    .filter((part) => part.length > 8)
    .slice(0, 5);
}

function normalizeSteps(steps: string[]): string[] {
  return steps.map((step) => step.replace(/^steps?:\s*/i, "").trim()).filter(Boolean);
}

function splitCompoundStep(step: string): string[] {
  return step
    .split(/\s+(?:and then|then)\s+/i)
    .flatMap((part) => {
      if (/^\s*(?:log ?in|sign ?in)\b.+\band\s+(?:click|open|go|navigate|reach|confirm|verify|view|select)\b/i.test(part)) {
        return part.split(/\s+and\s+/i);
      }
      return [part];
    })
    .map((part) => part.trim())
    .filter(Boolean);
}

function removeLoginDirective(step: string): string {
  return step
    .replace(/^\s*(?:log ?in|sign ?in)(?:\s+with\s+(?:the\s+)?(?:provided\s+)?(?:qa\s+)?credentials)?(?:\s+and\s+)?\.?\s*/i, "")
    .replace(/^\s*(?:log ?in|sign ?in)\.?\s*$/i, "")
    .replace(/^[\s.]+$/, "")
    .trim();
}

function isDeploymentOpenDirective(step: string): boolean {
  return /^(?:open|go to|navigate to|load|visit)\b.+\b(?:deployment|preview|url|app|site|homepage|home page)\b/i.test(step);
}

function conciseTitle(step: string): string {
  const clean = step.replace(/[.]+$/, "");
  if (clean.length <= 74) return clean;
  return `${clean.slice(0, 71).trim()}...`;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}
