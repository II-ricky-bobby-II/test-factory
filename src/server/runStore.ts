import { randomUUID } from "node:crypto";
import { runPersistence, type RunPersistence } from "./persistence.js";
import type {
  EventLevel,
  PrAutomationRun,
  PrAutomationRunStatus,
  PublicQaRun,
  QaEvent,
  QaRun,
  RunReport,
  RunRequest,
  SmokeStep
} from "./types.js";

type Listener = (event: QaEvent) => void;

export class RunStore {
  private readonly runs = new Map<string, QaRun>();
  private readonly prRuns = new Map<string, PrAutomationRun>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly readyPromise: Promise<void>;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly persistence: RunPersistence | undefined = runPersistence()) {
    this.readyPromise = this.persistence ? this.syncFromPersistence() : Promise.resolve();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  hasPersistence(): boolean {
    return Boolean(this.persistence?.enabled);
  }

  async refresh(): Promise<void> {
    if (!this.persistence) return;
    await this.syncFromPersistence();
  }

  async getScreenshotDataUri(runId: string, screenshotId: string): Promise<string | undefined> {
    return this.persistence?.readScreenshot(runId, screenshotId);
  }

  create(request: RunRequest, steps: SmokeStep[]): QaRun {
    const now = new Date().toISOString();
    const run: QaRun = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      request,
      status: "queued",
      steps,
      events: []
    };
    this.runs.set(run.id, run);
    this.persistSoon();
    return run;
  }

  list(): PublicQaRun[] {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => this.toPublicRun(run));
  }

  get(id: string): QaRun | undefined {
    return this.runs.get(id);
  }

  getPublic(id: string): PublicQaRun | undefined {
    const run = this.runs.get(id);
    return run ? this.toPublicRun(run) : undefined;
  }

  createPrRun(input: Omit<PrAutomationRun, "id" | "createdAt" | "updatedAt" | "status" | "runIds"> & {
    status?: PrAutomationRunStatus;
    runIds?: string[];
  }): PrAutomationRun {
    const now = new Date().toISOString();
    const prRun: PrAutomationRun = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: input.status || "queued",
      runIds: input.runIds || [],
      ...input
    };
    this.prRuns.set(prRun.id, prRun);
    this.persistSoon();
    return { ...prRun, testIds: [...prRun.testIds], runIds: [...prRun.runIds] };
  }

  getPrRun(id: string): PrAutomationRun | undefined {
    const prRun = this.prRuns.get(id);
    return prRun ? clonePrRun(prRun) : undefined;
  }

  listPrRuns(projectId?: string): PrAutomationRun[] {
    return [...this.prRuns.values()]
      .filter((run) => !projectId || run.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clonePrRun);
  }

  updatePrRun(id: string, patch: Partial<Omit<PrAutomationRun, "id" | "createdAt">>): PrAutomationRun | undefined {
    const prRun = this.prRuns.get(id);
    if (!prRun) return undefined;
    Object.assign(prRun, patch, { updatedAt: new Date().toISOString() });
    this.persistSoon();
    return clonePrRun(prRun);
  }

  addRunToPrRun(prRunId: string, runId: string): void {
    const prRun = this.prRuns.get(prRunId);
    if (!prRun || prRun.runIds.includes(runId)) return;
    prRun.runIds.push(runId);
    prRun.updatedAt = new Date().toISOString();
    this.persistSoon();
  }

  setStatus(runId: string, status: QaRun["status"], message: string, level: EventLevel = "info"): void {
    const run = this.mustGet(runId);
    run.status = status;
    this.touch(run);
    this.addEvent(runId, { type: "status", level, message });
  }

  setStep(runId: string, stepId: string, status: SmokeStep["status"], message?: string): void {
    const run = this.mustGet(runId);
    const step = run.steps.find((candidate) => candidate.id === stepId);
    if (!step) return;
    step.status = status;
    this.touch(run);
    this.addEvent(runId, {
      type: "step",
      level: status === "failed" ? "error" : status === "passed" ? "success" : "info",
      message: message || `${step.title}: ${status}`,
      stepId
    });
  }

  addLog(runId: string, level: EventLevel, message: string, details?: Record<string, unknown>): QaEvent {
    return this.addEvent(runId, { type: "log", level, message, details });
  }

  addScreenshot(runId: string, screenshot: string, message = "Captured browser state."): QaEvent {
    const run = this.mustGet(runId);
    const eventId = randomUUID();
    const publicScreenshot = this.persistence ? `/api/runs/${encodeURIComponent(runId)}/screenshots/${encodeURIComponent(eventId)}` : screenshot;
    run.latestScreenshot = publicScreenshot;
    this.touch(run);
    if (this.persistence) {
      void this.persistence.writeScreenshot(runId, eventId, screenshot).catch((error) => {
        const failure = error instanceof Error ? error.message : String(error);
        this.addLog(runId, "warning", `Could not persist screenshot ${eventId}: ${failure}`);
      });
    }
    return this.addEvent(runId, { type: "screenshot", level: "info", message, screenshot: publicScreenshot }, eventId);
  }

  setReport(runId: string, report: RunReport): void {
    const run = this.mustGet(runId);
    run.report = report;
    run.status = report.outcome;
    this.touch(run);
    this.addEvent(runId, {
      type: "report",
      level: report.outcome === "passed" ? "success" : "error",
      message: report.summary,
      details: {
        errors: report.errors,
        repairBrief: report.repairBrief,
        fixPrompt: report.fixPrompt
      }
    });
  }

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) || new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  private addEvent(runId: string, event: Omit<QaEvent, "id" | "runId" | "at">, id = randomUUID()): QaEvent {
    const run = this.mustGet(runId);
    const qaEvent: QaEvent = {
      ...event,
      id,
      runId,
      at: new Date().toISOString()
    };
    run.events.push(qaEvent);
    this.touch(run);
    this.persistSoon();
    this.listeners.get(runId)?.forEach((listener) => listener(qaEvent));
    return qaEvent;
  }

  private touch(run: QaRun): void {
    run.updatedAt = new Date().toISOString();
  }

  private mustGet(id: string): QaRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  }

  private toPublicRun(run: QaRun): PublicQaRun {
    const { credentials: _credentials, ...request } = run.request;
    return {
      ...run,
      request: {
        ...request,
        hasCredentials: Boolean(run.request.credentials?.username && run.request.credentials?.password)
      }
    };
  }

  private persistSoon(): void {
    if (!this.persistence) return;
    const snapshot = JSON.stringify(
      {
        version: 1,
        runs: [...this.runs.values()].map((run) => ({
          ...run,
          request: { ...run.request, credentials: undefined }
        })),
        prRuns: [...this.prRuns.values()]
      },
      null,
      2
    );
    this.writeQueue = this.writeQueue
      .then(() => this.persistence?.writeSnapshot(`${snapshot}\n`))
      .catch((error) => {
        console.warn(`Could not persist run store snapshot: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async syncFromPersistence(): Promise<void> {
    if (!this.persistence) return;
    const raw = await this.persistence.readSnapshot();
    if (!raw) return;
    const parsed = JSON.parse(raw) as { runs?: QaRun[]; prRuns?: PrAutomationRun[] };
    for (const run of parsed.runs || []) {
      const current = this.runs.get(run.id);
      if (!current || run.updatedAt.localeCompare(current.updatedAt) > 0) {
        this.runs.set(run.id, cloneRun(run));
      }
    }
    for (const prRun of parsed.prRuns || []) {
      const current = this.prRuns.get(prRun.id);
      if (!current || prRun.updatedAt.localeCompare(current.updatedAt) > 0) {
        this.prRuns.set(prRun.id, clonePrRun(prRun));
      }
    }
  }
}

function cloneRun(run: QaRun): QaRun {
  return {
    ...run,
    request: {
      ...run.request,
      credentials: run.request.credentials ? { ...run.request.credentials } : undefined,
      pr: run.request.pr ? { ...run.request.pr } : undefined
    },
    steps: run.steps.map((step) => ({ ...step })),
    events: run.events.map((event) => ({
      ...event,
      details: event.details ? { ...event.details } : undefined
    })),
    report: run.report
      ? {
          ...run.report,
          errors: [...run.report.errors],
          fixPrompt: run.report.fixPrompt
            ? {
                ...run.report.fixPrompt,
                warnings: [...run.report.fixPrompt.warnings],
                tokenUsage: run.report.fixPrompt.tokenUsage ? { ...run.report.fixPrompt.tokenUsage } : undefined
              }
            : undefined
        }
      : undefined
  };
}

function clonePrRun(prRun: PrAutomationRun): PrAutomationRun {
  return {
    ...prRun,
    testIds: [...prRun.testIds],
    runIds: [...prRun.runIds]
  };
}
