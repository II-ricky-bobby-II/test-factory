import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ClaudeIntegrationError, safeClaudeErrorMessage } from "./claudeErrors.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import { parseClaudeJson } from "./claudeJson.js";

export interface BrowserElementSummary {
  index: number;
  tag: string;
  text: string;
  label?: string;
  role?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  name?: string;
  autocomplete?: string;
  canClick: boolean;
  canFill: boolean;
  receivesPointerEvents: boolean;
}

export interface BrowserObservation {
  url: string;
  title: string;
  visibleText: string;
  elements: BrowserElementSummary[];
  recentProblems: string[];
  screenshotAvailable: boolean;
}

export interface ActionContext {
  deploymentUrl: string;
  stepTitle: string;
  stepDetail: string;
  credentialsAvailable: {
    username: boolean;
    password: boolean;
  };
  actionNumber: number;
  maxActions: number;
  priorActions: string[];
}

export type AgentAction =
  | { action: "navigate"; url: "deployment" | string; reason: string }
  | { action: "click"; elementIndex: number; reason: string }
  | { action: "fill"; elementIndex: number; value: string; reason: string }
  | { action: "fillCredential"; elementIndex: number; credential: "username" | "password"; reason: string }
  | { action: "wait"; milliseconds: number; reason: string }
  | { action: "assertText"; expectedText: string; reason: string }
  | { action: "assertNoVisibleProblem"; reason: string }
  | { action: "done"; reason: string };

export interface ClaudeActionDecision {
  action: AgentAction;
  model: string;
  tokenUsage?: Record<string, number>;
}

const actionSchema: z.ZodType<AgentAction> = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("navigate"),
    url: z.string().trim().min(1),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("click"),
    elementIndex: z.number().int().min(0),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("fill"),
    elementIndex: z.number().int().min(0),
    value: z.string(),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("fillCredential"),
    elementIndex: z.number().int().min(0),
    credential: z.enum(["username", "password"]),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("wait"),
    milliseconds: z.number().int().min(100).max(5000),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("assertText"),
    expectedText: z.string().trim().min(1),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("assertNoVisibleProblem"),
    reason: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("done"),
    reason: z.string().trim().min(1)
  })
]);

export async function chooseClaudeAction(context: ActionContext, observation: BrowserObservation): Promise<ClaudeActionDecision> {
  if (!isClaudeConfigured()) {
    throw new ClaudeIntegrationError("Browser mode requires ANTHROPIC_API_KEY; Claude action selection is not configured.");
  }

  const model = getClaudeModel();
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model,
      max_tokens: 900,
      system: [
        "You are controlling a browser for a safe QA smoke test.",
        "Pick exactly one next action for the current step.",
        "Use only the element indexes from the current browser observation.",
        "For click actions, use only browser.elements where canClick is true and receivesPointerEvents is true.",
        "For fill or fillCredential actions, use only browser.elements where canFill is true and receivesPointerEvents is true.",
        "If a dialog or overlay is open, interact only with controls inside the active dialog or close the dialog first.",
        "For fillCredential password, use a fillable element whose type is password.",
        "For fillCredential username, use a fillable element whose type is not password and whose label, name, autocomplete, placeholder, or type suggests email or username.",
        "For passwords, never ask for or output the password; use fillCredential with credential=password.",
        "Prefer assertions and read-only checks. Do not mutate production data.",
        "Use assertText only for literal text visible in browser.visibleText.",
        "For URL, title, input type, placeholder, aria label, or element-list checks that are already proven by the observation, return done with the observable evidence.",
        "When the current step is satisfied, return done.",
        "Return JSON only. Do not include hidden chain-of-thought."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            currentStep: {
              title: context.stepTitle,
              detail: context.stepDetail
            },
            deploymentUrl: context.deploymentUrl,
            credentialsAvailable: context.credentialsAvailable,
            actionNumber: context.actionNumber,
            maxActions: context.maxActions,
            priorActions: context.priorActions,
            browser: observation,
            elementUseRules: {
              clickableIndexes: observation.elements.filter((element) => element.canClick).map((element) => element.index),
              fillableIndexes: observation.elements.filter((element) => element.canFill).map((element) => element.index),
              pointerReceivableIndexes: observation.elements.filter((element) => element.receivesPointerEvents).map((element) => element.index),
              passwordFieldIndexes: observation.elements
                .filter((element) => element.canFill && element.type === "password")
                .map((element) => element.index)
            },
            allowedActions: [
              { action: "navigate", url: "deployment", reason: "why navigation is needed" },
              { action: "click", elementIndex: 0, reason: "use only an index from elementUseRules.clickableIndexes" },
              { action: "fill", elementIndex: 0, value: "non-secret text", reason: "use only an index from elementUseRules.fillableIndexes" },
              {
                action: "fillCredential",
                elementIndex: 0,
                credential: "username",
                reason: "use a fillable non-password username/email field index"
              },
              {
                action: "fillCredential",
                elementIndex: 0,
                credential: "password",
                reason: "use only an index from elementUseRules.passwordFieldIndexes"
              },
              { action: "wait", milliseconds: 1000, reason: "what the browser is waiting for" },
              { action: "assertText", expectedText: "visible text", reason: "why this proves the step" },
              { action: "assertNoVisibleProblem", reason: "why this checks for visible errors or broken UI" },
              { action: "done", reason: "observable evidence that the step is complete" }
            ]
          })
        }
      ]
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    const parsed = actionSchema.safeParse(parseClaudeJson(text));
    if (!parsed.success) {
      throw new ClaudeIntegrationError("Claude returned an invalid action JSON shape.", {
        issues: parsed.error.flatten().fieldErrors
      });
    }

    return {
      action: parsed.data,
      model,
      tokenUsage: normalizeUsage(response.usage)
    };
  } catch (error) {
    if (error instanceof ClaudeIntegrationError) throw error;
    throw new ClaudeIntegrationError(`Claude action selection failed: ${safeClaudeErrorMessage(error)}`);
  }
}

function normalizeUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}
