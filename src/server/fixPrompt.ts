import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ClaudeIntegrationError, redactSecretFragments, safeClaudeErrorMessage } from "./claudeErrors.js";
import { parseClaudeJson } from "./claudeJson.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import { buildRepoContext, type RepoContext } from "./repoContext.js";
import type { QaEvent, QaRun, RunReport, SmokeStep } from "./types.js";

export interface FailureFixPromptInput {
  run: QaRun;
  report: RunReport;
  repoContext?: RepoContext;
  failureCause?: string;
  observedProblems?: string[];
}

const claudeFixResponseSchema = z.object({
  repairBrief: z.string().trim().min(1).optional(),
  fixPrompt: z.string().trim().min(40)
});

export async function createFailureFixReport(input: FailureFixPromptInput): Promise<RunReport> {
  if (input.report.outcome !== "failed" || input.report.fixPrompt) return input.report;

  const repoContext = input.repoContext ?? (await buildRepoContext(input.run.request.githubRepo));
  const fallbackReport = createFallbackFixReport(input, repoContext);

  if (!isClaudeConfigured() || !hasRepoSignal(repoContext)) {
    return fallbackReport;
  }

  const model = getClaudeModel();
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1800,
      system: [
        "You generate implementation prompts for coding agents that own a repository.",
        "Use the failure evidence and repository context to produce a concrete fix-it prompt.",
        "The prompt must tell the repo agent what failed, how it happened, where to start looking, what to change, what tests to add or run, and how to verify the fix.",
        "Do not include credentials, secret values, or hidden chain-of-thought.",
        "Do not overstate certainty. Separate observed evidence from likely root-cause hypotheses.",
        "Return JSON only with keys repairBrief and fixPrompt."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            failure: buildFailurePacket(input),
            repoContext: {
              summary: repoContext.summary,
              repoUrl: repoContext.repoUrl,
              defaultBranch: repoContext.defaultBranch,
              warnings: repoContext.warnings,
              files: repoContext.files.map((file) => ({
                path: file.path,
                content: truncate(redactSecretFragments(file.content), 2800)
              }))
            },
            requiredShape: {
              repairBrief: "One short operator-facing sentence summarizing the likely fix direction.",
              fixPrompt:
                "A complete markdown prompt addressed to the repo coding agent. It should be ready to paste into that agent without extra context."
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
    const parsed = claudeFixResponseSchema.safeParse(parseClaudeJson(text));
    if (!parsed.success) {
      throw new ClaudeIntegrationError("Claude returned an invalid fix prompt JSON shape.", {
        issues: parsed.error.flatten().fieldErrors
      });
    }

    return {
      ...input.report,
      repairBrief: parsed.data.repairBrief || fallbackReport.repairBrief,
      fixPrompt: {
        text: parsed.data.fixPrompt,
        source: "claude",
        model,
        repoUrl: repoContext.repoUrl || undefined,
        repoContextSummary: repoContext.summary,
        warnings: repoContext.warnings,
        tokenUsage: normalizeUsage(response.usage)
      }
    };
  } catch (error) {
    return {
      ...fallbackReport,
      fixPrompt: fallbackReport.fixPrompt
        ? {
            ...fallbackReport.fixPrompt,
            warnings: [...fallbackReport.fixPrompt.warnings, `Claude fix prompt generation failed: ${safeClaudeErrorMessage(error)}`]
          }
        : fallbackReport.fixPrompt
    };
  }
}

function createFallbackFixReport(input: FailureFixPromptInput, repoContext: RepoContext): RunReport {
  return {
    ...input.report,
    repairBrief: input.report.repairBrief || "Use the generated fix-it prompt to hand this failure to the repo agent.",
    fixPrompt: {
      text: buildFallbackPrompt(input, repoContext),
      source: "fallback",
      repoUrl: repoContext.repoUrl || undefined,
      repoContextSummary: repoContext.summary,
      warnings: repoContext.warnings,
      tokenUsage: undefined
    }
  };
}

function buildFallbackPrompt(input: FailureFixPromptInput, repoContext: RepoContext): string {
  const failedStep = findFailedStep(input.run.steps);
  const repoTarget = repoContext.repoUrl || input.run.request.githubRepo || "the target repository";
  const likelyFiles = repoContext.files.map((file) => `- ${file.path}`).join("\n") || "- Inspect routes, auth, data loading, and UI error handling for the failing flow.";
  const failurePacket = buildFailurePacket(input);

  return [
    `You are the coding agent responsible for ${repoTarget}. Fix this QA smoke failure end to end.`,
    "",
    "Use the evidence below to reproduce or reason through the failure. Do not use or expose secret values; QA credentials were only supplied to the smoke runner as booleans.",
    "",
    "Failure summary:",
    `- Deployment: ${input.run.request.deploymentUrl}`,
    `- Smoke prompt: ${sanitizeText(input.run.request.smokePrompt, 900)}`,
    `- Failed step: ${failedStep ? `${failedStep.title} - ${failedStep.detail}` : "No individual failed step was recorded."}`,
    ...input.report.errors.map((error) => `- Error: ${sanitizeText(error, 900)}`),
    "",
    "Repo context already fetched by Test Factory:",
    repoContext.summary,
    repoContext.warnings.length > 0 ? `Warnings: ${repoContext.warnings.join(" | ")}` : "Warnings: none",
    "",
    "Start with these files or areas:",
    likelyFiles,
    "",
    "Required fix:",
    "1. Identify the root cause in the repo, using the failure packet and current code.",
    "2. Implement the product fix, not a test-only workaround.",
    "3. Add or update automated coverage for the broken flow or component.",
    "4. Run the relevant typecheck, unit tests, and any focused browser/QA verification available in the repo.",
    "5. Summarize the root cause, code changes, tests, and residual risk.",
    "",
    "Failure packet:",
    "```json",
    JSON.stringify(failurePacket, null, 2),
    "```"
  ].join("\n");
}

function buildFailurePacket(input: FailureFixPromptInput): Record<string, unknown> {
  const run = input.run;
  return {
    runId: run.id,
    deploymentUrl: run.request.deploymentUrl,
    githubRepo: run.request.githubRepo || undefined,
    credentialsSupplied: Boolean(run.request.credentials?.username && run.request.credentials?.password),
    smokePrompt: sanitizeText(run.request.smokePrompt, 1600),
    failureCause: input.failureCause ? sanitizeText(input.failureCause, 1000) : undefined,
    failedStep: findFailedStep(run.steps),
    steps: run.steps.map(summarizeStep),
    report: {
      summary: sanitizeText(input.report.summary, 1000),
      errors: input.report.errors.map((error) => sanitizeText(error, 1000)),
      repairBrief: input.report.repairBrief ? sanitizeText(input.report.repairBrief, 1000) : undefined
    },
    observedProblems: input.observedProblems?.map((problem) => sanitizeText(problem, 1000)).slice(0, 12) || [],
    recentEvents: summarizeEvents(run.events),
    latestScreenshotCaptured: Boolean(run.latestScreenshot)
  };
}

function summarizeStep(step: SmokeStep): Record<string, string> {
  return {
    id: step.id,
    title: sanitizeText(step.title, 240),
    detail: sanitizeText(step.detail, 500),
    status: step.status
  };
}

function findFailedStep(steps: SmokeStep[]): Record<string, string> | undefined {
  const failed = steps.find((step) => step.status === "failed") || steps.find((step) => step.status === "running");
  return failed ? summarizeStep(failed) : undefined;
}

function summarizeEvents(events: QaEvent[]): Record<string, unknown>[] {
  return events.slice(-30).map((event) => ({
    at: event.at,
    type: event.type,
    level: event.level,
    stepId: event.stepId,
    message: sanitizeText(event.message, 700),
    screenshotCaptured: Boolean(event.screenshot) || undefined,
    details: sanitizeValue(event.details, 0)
  }));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeText(value, 700);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/(password|secret|api[_-]?key|screenshot)/i.test(key))
        .slice(0, 18)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  return String(value);
}

function hasRepoSignal(repoContext: RepoContext): boolean {
  return repoContext.source === "github" || repoContext.files.length > 0;
}

function sanitizeText(value: string, maxLength: number): string {
  return truncate(redactSecretFragments(value), maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function normalizeUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}
