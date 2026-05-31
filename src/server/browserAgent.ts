import { setTimeout as delay } from "node:timers/promises";
import type { Browser, Locator, Page } from "playwright-core";
import {
  chooseClaudeAction,
  type ActionContext,
  type AgentAction,
  type BrowserElementSummary,
  type BrowserObservation,
  type ClaudeActionDecision
} from "./claudeAgent.js";
import { redactSecretFragments } from "./claudeErrors.js";
import { getClaudeModel, isClaudeConfigured } from "./config.js";
import { createFailureFixReport } from "./fixPrompt.js";
import type { RepoContext } from "./repoContext.js";
import { RunStore } from "./runStore.js";
import { isVercelRuntime } from "./runtime.js";
import type { QaRun, RunReport, SmokeStep } from "./types.js";

const UI_PROBLEM_SURFACE_SELECTOR = [
  '[role="alert"]',
  '[aria-live="assertive"]',
  '[data-testid*="alert" i]',
  '[data-testid*="banner" i]',
  '[data-testid*="error" i]',
  '[data-testid*="toast" i]',
  '[class*="alert" i]',
  '[class*="error-banner" i]',
  '[class*="error-message" i]',
  '[class*="notification" i]',
  '[class*="toast" i]'
].join(",");
const UI_PROBLEM_TEXT_PATTERNS = [
  /application error/i,
  /internal server error/i,
  /something went wrong/i,
  /failed to (?:load|fetch|save|submit|sign in|authenticate)/i,
  /unable to (?:load|fetch|save|submit|sign in|authenticate)/i,
  /invalid (?:login|sign[- ]?in|credentials|email|password)/i,
  /incorrect (?:login|sign[- ]?in|credentials|email|password)/i,
  /\b(?:401|403|404|500)\b.+\b(?:error|forbidden|not found|unauthorized|server)\b/i,
  /\b(?:not found|unauthorized|forbidden)\b/i
];
const OBSERVABLE_ELEMENT_SELECTOR = [
  "a:visible",
  "button:visible",
  "input:visible",
  "textarea:visible",
  "select:visible",
  '[contenteditable="true"]:visible',
  '[role="button"]:visible',
  '[role="link"]:visible',
  '[role="textbox"]:visible'
].join(",");
const OBSERVED_ELEMENT_ATTRIBUTE = "data-qa-smoke-observed-index";
const STEP_DELAY_MS = Number(process.env.QA_SMOKE_STEP_DELAY_MS || 650);

interface CapturedProblem {
  type: string;
  message: string;
}

export interface ExecuteQaRunOptions {
  repoContext?: RepoContext;
  vercelProtectionBypassSecret?: string;
}

interface ActionResult {
  message: string;
  stepComplete: boolean;
}

class InvalidClaudeActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClaudeActionError";
  }
}

export async function executeQaRun(run: QaRun, store: RunStore, options: ExecuteQaRunOptions = {}): Promise<void> {
  if (run.request.agentMode === "demo") {
    await executeDemoRun(run, store);
    return;
  }

  if (!isClaudeConfigured()) {
    await finish(
      run,
      store,
      {
        outcome: "failed",
        summary: "Browser mode requires Claude, but ANTHROPIC_API_KEY is not configured.",
        errors: ["Browser mode requires ANTHROPIC_API_KEY; Claude action selection is not configured."],
        repairBrief: "Add ANTHROPIC_API_KEY to .env, restart the server, and retry the run."
      },
      options,
      { failureCause: "Claude is not configured for Browser mode." }
    );
    return;
  }

  let browser: Browser | undefined;
  const problems: CapturedProblem[] = [];

  try {
    store.setStatus(run.id, "running", `Starting Claude-driven browser agent with ${getClaudeModel()}.`);
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: options.vercelProtectionBypassSecret
        ? {
            "x-vercel-protection-bypass": options.vercelProtectionBypassSecret,
            "x-vercel-set-bypass-cookie": "true"
          }
        : undefined
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);

    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        problems.push({ type: `console:${message.type()}`, message: redact(message.text()) });
      }
    });
    page.on("pageerror", (error) => {
      problems.push({ type: "pageerror", message: redact(error.message) });
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure();
      problems.push({
        type: "requestfailed",
        message: `${request.method()} ${request.url()} ${failure?.errorText || "failed"}`
      });
    });

    for (const step of run.steps) {
      await runClaudeStep(page, run, store, step, problems);
    }

    const visibleProblems = await collectVisibleUiProblems(page);
    const { fatalProblems, warningProblems } = classifyProblemsForReport(problems, visibleProblems, run.request.deploymentUrl);

    if (warningProblems.length > 0) {
      store.addLog(run.id, "warning", `Observed ${warningProblems.length} non-fatal browser issue(s).`, {
        problems: warningProblems.map((problem) => `${problem.type}: ${problem.message}`).slice(0, 8)
      });
    }

    if (fatalProblems.length > 0) {
      await finish(
        run,
        store,
        {
          outcome: "failed",
          summary: `Smoke run failed with ${fatalProblems.length} observed problem${fatalProblems.length === 1 ? "" : "s"}.`,
          errors: fatalProblems.map((problem) => `${problem.type}: ${problem.message}`).slice(0, 8),
          repairBrief:
            "Review the first failing step, browser screenshot, visible error, app request failure, and Claude action log."
        },
        options,
        {
          failureCause: "Fatal browser or visible UI problems were observed after the prompted flow.",
          observedProblems: [...fatalProblems, ...warningProblems].map((problem) => `${problem.type}: ${problem.message}`)
        }
      );
      return;
    }

    await finish(
      run,
      store,
      {
        outcome: "passed",
        summary: "Smoke run passed. Claude completed the prompted flow without visible UI or fatal browser errors.",
        errors: []
      },
      options
    );
  } catch (error) {
    const message = formatRunError(error);
    const runningStep = run.steps.find((step) => step.status === "running");
    if (runningStep) store.setStep(run.id, runningStep.id, "failed", message);
    await finish(
      run,
      store,
      {
        outcome: "failed",
        summary: "Smoke run failed before completing the prompted flow.",
        errors: [redact(message)],
        repairBrief: "Inspect the failed Claude action, browser screenshot, event log, redirect, or credential state."
      },
      options,
      {
        failureCause: message,
        observedProblems: problems.slice(-8).map((problem) => `${problem.type}: ${problem.message}`)
      }
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function formatRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|Please run the following command|playwright install/i.test(message)) {
    return [
      "Playwright Chromium is not installed for Browser mode.",
      "Run `npm run install:browsers`, then restart the dev server and try again."
    ].join(" ");
  }
  if (/locator\.click: Timeout[\s\S]+intercepts pointer events/i.test(message)) {
    return "The selected click target was blocked by another visible element, likely an open dialog overlay. Claude should choose a control inside the active dialog or close the overlay first.";
  }
  if (/locator\.fill:[\s\S]+Element is not an <input>/i.test(message)) {
    return "The selected fill target was not an editable field. Claude should choose an element marked canFill=true.";
  }
  return redact(message);
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.QA_SMOKE_BROWSER_RUNTIME === "serverless" || isVercelRuntime()) {
    const [{ chromium }, chromiumPackage] = await Promise.all([import("playwright-core"), import("@sparticuz/chromium")]);
    chromiumPackage.default.setGraphicsMode = false;
    return chromium.launch({
      args: chromiumPackage.default.args,
      executablePath: await chromiumPackage.default.executablePath(),
      headless: true
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless: process.env.QA_SMOKE_HEADLESS !== "false" });
}

async function runClaudeStep(
  page: Page,
  run: QaRun,
  store: RunStore,
  step: SmokeStep,
  problems: CapturedProblem[]
): Promise<void> {
  store.setStep(run.id, step.id, "running", step.detail);
  await capture(page, run.id, store, `Before: ${step.title}`);

  const priorActions: string[] = [];
  const maxActions = run.request.maxActions;
  for (let actionNumber = 1; actionNumber <= maxActions; actionNumber += 1) {
    const observation = await observe(page, problems, Boolean(run.latestScreenshot));
    const decision = await chooseClaudeAction(actionContext(run, step, actionNumber, maxActions, priorActions), observation);
    const selectedMessage = `Claude selected ${decision.action.action}: ${decision.action.reason}`;
    store.addLog(run.id, "info", selectedMessage, actionEventDetails(decision, observation));

    let result: ActionResult;
    try {
      result = await executeAction(page, run, step, decision.action, observation);
    } catch (error) {
      if (error instanceof InvalidClaudeActionError) {
        const message = error.message;
        priorActions.push(`Rejected ${decision.action.action}: ${message}`);
        store.addLog(run.id, "warning", `Rejected Claude action: ${message}`, actionEventDetails(decision, observation));
        continue;
      }
      throw error;
    }

    priorActions.push(`${decision.action.action}: ${result.message}`);
    store.addLog(run.id, "success", `Claude action completed: ${result.message}`, actionEventDetails(decision, observation));

    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await delay(STEP_DELAY_MS);
    await capture(page, run.id, store, `After Claude action: ${step.title}`);

    const visibleProblems = await collectVisibleUiProblems(page);
    if (visibleProblems.length > 0 && !stepExpectsProblem(step)) {
      throw new Error(`Visible UI shows a problem state: ${visibleProblems.map((problem) => problem.message).join(" | ")}`);
    }

    if (result.stepComplete) {
      store.setStep(run.id, step.id, "passed", `${step.title} completed.`);
      return;
    }
  }

  throw new Error(`Claude did not complete step within ${maxActions} actions: ${step.detail}`);
}

function actionContext(run: QaRun, step: SmokeStep, actionNumber: number, maxActions: number, priorActions: string[]): ActionContext {
  return {
    deploymentUrl: run.request.deploymentUrl,
    stepTitle: step.title,
    stepDetail: step.detail,
    credentialsAvailable: {
      username: Boolean(run.request.credentials?.username),
      password: Boolean(run.request.credentials?.password)
    },
    actionNumber,
    maxActions,
    priorActions
  };
}

async function executeAction(page: Page, run: QaRun, step: SmokeStep, action: AgentAction, observation: BrowserObservation): Promise<ActionResult> {
  if (action.action === "navigate") {
    const url = resolveNavigationUrl(page, run.request.deploymentUrl, action.url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { message: `Navigated to ${url}`, stepComplete: isNavigationStep(step) };
  }

  if (action.action === "wait") {
    await delay(action.milliseconds);
    return { message: `Waited ${action.milliseconds}ms`, stepComplete: false };
  }

  if (action.action === "assertText") {
    if (looksLikeProblemText(action.expectedText) && !stepExpectsProblem(step)) {
      throw new Error(`Claude tried to satisfy a positive step with problem text: ${action.expectedText}`);
    }
    if (!(await page.getByText(action.expectedText, { exact: false }).first().isVisible().catch(() => false))) {
      throw new Error(`Expected text was not visible: ${action.expectedText}`);
    }
    return { message: `Asserted visible text: ${action.expectedText}`, stepComplete: true };
  }

  if (action.action === "assertNoVisibleProblem") {
    const visibleProblems = await collectVisibleUiProblems(page);
    if (visibleProblems.length > 0) {
      throw new Error(`Visible UI still shows a problem state: ${visibleProblems.map((problem) => problem.message).join(" | ")}`);
    }
    return { message: "Asserted no visible problem surfaces.", stepComplete: isProblemCheckStep(step) };
  }

  if (action.action === "done") {
    return { message: `Step marked done: ${action.reason}`, stepComplete: true };
  }

  const target = observation.elements[action.elementIndex];
  if (!target) throw new Error(`Claude chose missing element index ${action.elementIndex}.`);
  validateElementAction(action, target);
  const locator = elementLocator(page, action.elementIndex);
  if (!(await locator.count().then((count) => count > 0).catch(() => false))) {
    throw new InvalidClaudeActionError(`Observed element index ${action.elementIndex} is no longer attached; choose from the current observation.`);
  }

  if (action.action === "click") {
    await assertReceivesPointerEvents(locator, target);
    await locator.click();
    return { message: `Clicked ${describeElement(target)}`, stepComplete: false };
  }

  if (action.action === "fillCredential") {
    const value = run.request.credentials?.[action.credential] || "";
    if (!value) throw new Error(`Claude requested missing ${action.credential} credential.`);
    await locator.fill(value);
    return { message: `Filled ${action.credential} credential into ${describeElement(target)}`, stepComplete: false };
  }

  await locator.fill(action.value);
  return { message: `Filled ${describeElement(target)}`, stepComplete: false };
}

async function observe(page: Page, problems: CapturedProblem[], screenshotAvailable: boolean): Promise<BrowserObservation> {
  await page.locator(`[${OBSERVED_ELEMENT_ATTRIBUTE}]`).evaluateAll(function (nodes, attribute) {
    for (const node of nodes) {
      (node as HTMLElement).removeAttribute(attribute as string);
    }
  }, OBSERVED_ELEMENT_ATTRIBUTE).catch(() => undefined);

  const elements = await page.locator(OBSERVABLE_ELEMENT_SELECTOR).evaluateAll(function (nodes, attribute) {
    const summaries = [];
    const limit = Math.min(nodes.length, 60);
    for (let index = 0; index < limit; index += 1) {
      const node = nodes[index];
      const element = node as HTMLElement;
      const input = node as HTMLInputElement;
      element.setAttribute(attribute as string, String(index));

      let label = "";
      const direct = element.getAttribute("aria-label") || "";
      if (direct.replace(/\s+/g, " ").trim()) {
        label = direct.replace(/\s+/g, " ").trim();
      }
      const labelledBy = label ? "" : element.getAttribute("aria-labelledby");
      if (labelledBy) {
        let text = "";
        for (const id of labelledBy.split(/\s+/)) {
          text += ` ${document.getElementById(id)?.innerText || ""}`;
        }
        if (text.replace(/\s+/g, " ").trim()) {
          label = text.replace(/\s+/g, " ").trim();
        }
      }
      const id = element.id;
      if (!label && id) {
        const labels = Array.from(document.querySelectorAll("label"));
        for (const candidate of labels) {
          if (candidate.htmlFor !== id) continue;
          const text = candidate.innerText.replace(/\s+/g, " ").trim();
          if (text) {
            label = text;
            break;
          }
        }
      }
      if (!label) {
        const wrapped = element.closest("label")?.innerText || "";
        if (wrapped.replace(/\s+/g, " ").trim()) {
          label = wrapped.replace(/\s+/g, " ").trim();
        }
      }

      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || undefined;
      const inputType = (input.type || "").toLowerCase() || undefined;
      const disabled = Boolean((input as HTMLInputElement).disabled) || element.getAttribute("aria-disabled") === "true";
      const readonly = Boolean((input as HTMLInputElement).readOnly) || element.getAttribute("aria-readonly") === "true";
      const fillableInputTypes = [
        "date",
        "datetime-local",
        "email",
        "month",
        "number",
        "password",
        "search",
        "tel",
        "text",
        "time",
        "url",
        "week"
      ];
      const clickableInputTypes = ["button", "checkbox", "image", "radio", "reset", "submit"];
      const isInput = tag === "input";
      const canFill =
        !disabled &&
        !readonly &&
        (tag === "textarea" ||
          tag === "select" ||
          element.isContentEditable ||
          role === "textbox" ||
          (isInput && fillableInputTypes.includes(inputType || "text")));
      const canClick =
        !disabled &&
        (tag === "a" ||
          tag === "button" ||
          role === "button" ||
          role === "link" ||
          (isInput && clickableInputTypes.includes(inputType || "text")));
      let receivesPointerEvents = true;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        receivesPointerEvents = false;
      } else {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (centerX >= 0 && centerY >= 0 && centerX <= window.innerWidth && centerY <= window.innerHeight) {
          const topElement = document.elementFromPoint(centerX, centerY);
          receivesPointerEvents = Boolean(topElement && (element === topElement || element.contains(topElement) || topElement.contains(element)));
        }
      }
      summaries.push({
        index,
        tag,
        text: (element.innerText || "").trim().slice(0, 140),
        label: label.slice(0, 140) || undefined,
        role,
        type: inputType,
        placeholder: input.placeholder || undefined,
        ariaLabel: element.getAttribute("aria-label") || undefined,
        name: input.name || undefined,
        autocomplete: input.autocomplete || undefined,
        canClick: canClick && receivesPointerEvents,
        canFill: canFill && receivesPointerEvents,
        receivesPointerEvents
      });
    }
    return summaries;
  }, OBSERVED_ELEMENT_ATTRIBUTE);

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    visibleText: (await safeVisibleText(page)).slice(0, 5000),
    elements: elements as BrowserElementSummary[],
    recentProblems: problems.slice(-8).map((problem) => `${problem.type}: ${problem.message}`),
    screenshotAvailable
  };
}

async function capture(page: Page, runId: string, store: RunStore, message: string): Promise<void> {
  const screenshot = await page.screenshot({ type: "jpeg", quality: 62, fullPage: false });
  store.addScreenshot(runId, `data:image/jpeg;base64,${screenshot.toString("base64")}`, message);
}

async function safeVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
}

async function collectVisibleUiProblems(page: Page): Promise<CapturedProblem[]> {
  const problems: CapturedProblem[] = [];
  const bodyText = await safeVisibleText(page);

  for (const pattern of UI_PROBLEM_TEXT_PATTERNS) {
    const snippet = snippetForPattern(bodyText, pattern);
    if (snippet) {
      problems.push({ type: "visible-ui", message: `Page text matched ${pattern}: "${snippet}"` });
    }
  }

  const surfaces = page.locator(UI_PROBLEM_SURFACE_SELECTOR);
  const count = Math.min(await surfaces.count().catch(() => 0), 25);
  for (let index = 0; index < count; index += 1) {
    const surface = surfaces.nth(index);
    if (!(await surface.isVisible().catch(() => false))) continue;
    const text = normalizeWhitespace(await surface.innerText({ timeout: 1000 }).catch(() => ""));
    if (!text || !looksLikeProblemText(text)) continue;
    problems.push({ type: "visible-ui", message: `Visible problem surface: "${truncate(text, 180)}"` });
  }

  return dedupeProblems(problems).slice(0, 8);
}

function resolveNavigationUrl(page: Page, deploymentUrl: string, requested: string): string {
  const base = page.url() === "about:blank" ? deploymentUrl : page.url();
  const url = requested === "deployment" ? new URL(deploymentUrl) : new URL(requested, base);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Claude requested unsupported navigation protocol: ${url.protocol}`);
  }
  return url.toString();
}

function elementLocator(page: Page, elementIndex: number): Locator {
  return page.locator(`[${OBSERVED_ELEMENT_ATTRIBUTE}="${elementIndex}"]`);
}

function actionEventDetails(decision: ClaudeActionDecision, observation: BrowserObservation): Record<string, unknown> {
  const action = decision.action;
  const element = "elementIndex" in action ? observation.elements[action.elementIndex] : undefined;
  return {
    model: decision.model,
    action: action.action,
    reason: action.reason,
    elementIndex: "elementIndex" in action ? action.elementIndex : undefined,
    elementLabel: element ? describeElement(element) : undefined,
    elementCanClick: element?.canClick,
    elementCanFill: element?.canFill,
    elementReceivesPointerEvents: element?.receivesPointerEvents,
    credential: action.action === "fillCredential" ? action.credential : undefined,
    tokenUsage: decision.tokenUsage
  };
}

function describeElement(element: BrowserElementSummary): string {
  const label =
    element.label ||
    element.ariaLabel ||
    element.text ||
    element.placeholder ||
    element.name ||
    [element.tag, element.type].filter(Boolean).join(" ");
  return `${element.tag}[${element.index}]${label ? ` "${truncate(label, 80)}"` : ""}`;
}

function validateElementAction(action: AgentAction, target: BrowserElementSummary): void {
  if (action.action === "click") {
    if (!target.receivesPointerEvents) {
      throw new InvalidClaudeActionError(
        `${describeElement(target)} is blocked by another element, likely a dialog overlay; choose an element where receivesPointerEvents is true.`
      );
    }
    if (!target.canClick) {
      throw new InvalidClaudeActionError(`${describeElement(target)} is not clickable; choose an element where canClick is true.`);
    }
    return;
  }

  if (action.action === "fill" || action.action === "fillCredential") {
    if (!target.receivesPointerEvents) {
      throw new InvalidClaudeActionError(
        `${describeElement(target)} is blocked by another element, likely a dialog overlay; choose an element where receivesPointerEvents is true.`
      );
    }
    if (!target.canFill) {
      throw new InvalidClaudeActionError(`${describeElement(target)} is not fillable; choose an element where canFill is true.`);
    }
    if (action.action === "fillCredential" && action.credential === "password" && target.type !== "password") {
      throw new InvalidClaudeActionError(`${describeElement(target)} is not a password field; choose an element where type is password.`);
    }
    if (action.action === "fillCredential" && action.credential === "username" && target.type === "password") {
      throw new InvalidClaudeActionError(`${describeElement(target)} is a password field; choose a non-password username or email field.`);
    }
  }
}

async function assertReceivesPointerEvents(locator: Locator, target: BrowserElementSummary): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  const receivesPointer = await locator
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX < 0 || centerY < 0 || centerX > window.innerWidth || centerY > window.innerHeight) return true;
      const topElement = document.elementFromPoint(centerX, centerY);
      return Boolean(topElement && (element === topElement || element.contains(topElement) || topElement.contains(element)));
    })
    .catch(() => false);

  if (!receivesPointer) {
    throw new InvalidClaudeActionError(
      `${describeElement(target)} is blocked by another visible element, likely a dialog overlay; choose a control inside the active dialog or close it first.`
    );
  }
}

function looksLikeProblemText(text: string): boolean {
  return UI_PROBLEM_TEXT_PATTERNS.some((pattern) => pattern.test(text)) || /\b(?:error|failed|invalid|wrong|try again)\b/i.test(text);
}

function isNavigationStep(step: SmokeStep): boolean {
  const text = `${step.title} ${step.detail}`;
  return /\b(?:navigate|visit|go to)\b/i.test(text) || /\bopen\b.+\b(?:url|deployment|preview|site|app|https?:\/\/)/i.test(text);
}

function isProblemCheckStep(step: SmokeStep): boolean {
  return /\b(?:no|without|check|scan|verify|confirm)\b.+\b(?:error|banner|alert|warning|broken|problem|failure|failed)\b/i.test(
    `${step.title} ${step.detail}`
  );
}

function stepExpectsProblem(step: SmokeStep): boolean {
  const text = `${step.title} ${step.detail}`;
  if (/\b(?:no|without|none|absence|not)\b.+\b(?:error|failed|invalid|warning|alert|problem|broken)\b/i.test(text)) {
    return false;
  }
  return /\b(?:expect|confirm|verify|assert|check)\b.+\b(?:error|failed|invalid|warning|alert)\b.+\b(?:appears|visible|shown|displayed|message)\b/i.test(
    text
  );
}

function snippetForPattern(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  if (!match?.index && match?.index !== 0) return undefined;
  const start = Math.max(0, match.index - 70);
  const end = Math.min(text.length, match.index + match[0].length + 70);
  return truncate(normalizeWhitespace(text.slice(start, end)), 220);
}

function dedupeProblems(problems: CapturedProblem[]): CapturedProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = `${problem.type}:${problem.message.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyProblemsForReport(
  capturedProblems: CapturedProblem[],
  visibleProblems: CapturedProblem[],
  deploymentUrl: string
): { fatalProblems: CapturedProblem[]; warningProblems: CapturedProblem[] } {
  const visible = dedupeProblems(visibleProblems);
  const captured = dedupeProblems(capturedProblems);
  const fatalCaptured = captured.filter((problem) => isFatalCapturedProblem(problem, deploymentUrl));
  const fatalProblems = dedupeProblems([...visible, ...fatalCaptured]).slice(0, 8);
  const fatalKeys = new Set(fatalProblems.map(problemKey));
  const warningProblems = captured.filter((problem) => !fatalKeys.has(problemKey(problem))).slice(0, 8);
  return { fatalProblems, warningProblems };
}

function isFatalCapturedProblem(problem: CapturedProblem, deploymentUrl: string): boolean {
  if (problem.type === "pageerror") return true;
  if (problem.type === "requestfailed") return isFatalRequestFailure(problem.message, deploymentUrl);
  if (problem.type === "console:error") return isFatalConsoleError(problem.message);
  return false;
}

function isFatalRequestFailure(message: string, deploymentUrl: string): boolean {
  const requestUrl = firstHttpUrl(message);
  if (!requestUrl) return true;
  if (isTelemetryUrl(requestUrl)) return false;

  try {
    return requestUrl.origin === new URL(deploymentUrl).origin;
  } catch {
    return true;
  }
}

function isTelemetryUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "sentry.io" || host.endsWith(".sentry.io");
}

function isFatalConsoleError(message: string): boolean {
  if (/sentry\.io/i.test(message)) return false;
  return /uncaught|exception|application error|hydration failed|chunk load error/i.test(message);
}

function firstHttpUrl(value: string): URL | undefined {
  const match = value.match(/https?:\/\/[^\s)]+/i);
  if (!match) return undefined;
  try {
    return new URL(match[0]);
  } catch {
    return undefined;
  }
}

function problemKey(problem: CapturedProblem): string {
  return `${problem.type}:${problem.message.toLowerCase()}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
}

async function finish(
  run: QaRun,
  store: RunStore,
  report: RunReport,
  options: ExecuteQaRunOptions,
  failureDetails: { failureCause?: string; observedProblems?: string[] } = {}
): Promise<void> {
  if (report.outcome !== "failed") {
    store.setReport(run.id, report);
    return;
  }

  store.addLog(run.id, "info", "Generating a repo-aware fix-it prompt for the failed run.");
  const finalReport = await createFailureFixReport({
    run,
    report,
    repoContext: options.repoContext,
    failureCause: failureDetails.failureCause,
    observedProblems: failureDetails.observedProblems
  });

  if (finalReport.fixPrompt?.source === "claude") {
    store.addLog(run.id, "success", "Claude generated a repo-aware fix-it prompt.", {
      model: finalReport.fixPrompt.model,
      repoContextSummary: finalReport.fixPrompt.repoContextSummary,
      warnings: finalReport.fixPrompt.warnings,
      tokenUsage: finalReport.fixPrompt.tokenUsage
    });
  } else if (finalReport.fixPrompt) {
    store.addLog(run.id, "warning", "Generated a fallback fix-it prompt without Claude repair analysis.", {
      repoContextSummary: finalReport.fixPrompt.repoContextSummary,
      warnings: finalReport.fixPrompt.warnings
    });
  }

  store.setReport(run.id, finalReport);
}

async function executeDemoRun(run: QaRun, store: RunStore): Promise<void> {
  store.setStatus(run.id, "running", "Running demo agent timeline.");
  for (const step of run.steps) {
    store.setStep(run.id, step.id, "running", step.detail);
    store.addScreenshot(run.id, demoScreenshot(step.title, step.detail), `Demo browser state for ${step.title}.`);
    store.addLog(run.id, "info", `Demo agent completed: ${step.detail}`);
    await delay(350);
    store.setStep(run.id, step.id, "passed", `${step.title} completed.`);
  }
  store.setReport(run.id, {
    outcome: "passed",
    summary: "Demo smoke run passed. Switch to Browser mode to exercise a real deployment with Playwright and Claude.",
    errors: []
  });
}

function demoScreenshot(title: string, detail: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1366" height="900" viewBox="0 0 1366 900">
    <rect width="1366" height="900" fill="#f7f9fb"/>
    <rect x="0" y="0" width="1366" height="66" fill="#172033"/>
    <circle cx="31" cy="33" r="8" fill="#ef4444"/><circle cx="57" cy="33" r="8" fill="#f59e0b"/><circle cx="83" cy="33" r="8" fill="#22c55e"/>
    <rect x="132" y="18" width="890" height="30" rx="6" fill="#25324a"/>
    <text x="154" y="38" fill="#d8dee9" font-family="Arial" font-size="14">test factory demo browser</text>
    <rect x="80" y="128" width="1206" height="620" rx="8" fill="#ffffff" stroke="#d6dbe5"/>
    <text x="132" y="214" fill="#101827" font-family="Arial" font-size="36" font-weight="700">${escapeSvg(title)}</text>
    <text x="132" y="270" fill="#48556a" font-family="Arial" font-size="20">${escapeSvg(detail.slice(0, 120))}</text>
    <rect x="132" y="338" width="330" height="48" rx="6" fill="#2563eb"/>
    <text x="164" y="369" fill="#ffffff" font-family="Arial" font-size="17" font-weight="700">Agent action completed</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeSvg(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function redact(value: string): string {
  return redactSecretFragments(value);
}
