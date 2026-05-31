import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.QA_SMOKE_BASE_URL || "http://localhost:4317";
const targetUrl = process.env.QA_SMOKE_TARGET_URL || "admin.asymmetric.al";
const rounds = Number(process.env.QA_SMOKE_ROUNDS || 10);
const timeoutMs = Number(process.env.QA_SMOKE_ROUND_TIMEOUT_MS || 30000);
const pollMs = Number(process.env.QA_SMOKE_POLL_MS || 250);

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error("QA_SMOKE_ROUNDS must be a positive integer.");
}

await assertServerIsReady();

const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const created = await createRun(index);
  const completed = await waitForRun(created.id);
  const summary = summarizeRun(index, completed);
  results.push(summary);
  printRound(summary);
}

const failures = results.filter((result) => result.status !== "passed");
console.log(`\nCompleted ${results.length} admin smoke round${results.length === 1 ? "" : "s"} against ${targetUrl}.`);
if (failures.length > 0) {
  console.error(`${failures.length} round${failures.length === 1 ? "" : "s"} failed.`);
  process.exitCode = 1;
}

async function assertServerIsReady() {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Test Factory server is not reachable at ${baseUrl}. Start it with \`npm run dev\` first. ${message}`);
  }
}

async function createRun(round) {
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deploymentUrl: targetUrl,
      smokePrompt: [
        `Admin smoke round ${round}.`,
        "",
        "Steps:",
        "1. Open admin preview URL.",
        "2. Confirm admin sign in form is visible.",
        "3. Confirm no visible error banner appears.",
        "",
        "Expected:",
        "No browser console errors, failed network requests, or broken UI states."
      ].join("\n"),
      agentMode: "browser",
      maxActions: 8
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Could not create round ${round}: ${payload.error || JSON.stringify(payload)}`);
  }
  return payload.run;
}

async function waitForRun(runId) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await fetchRun(runId);
    if (!["queued", "running"].includes(run.status)) return run;
    await delay(pollMs);
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms.`);
}

async function fetchRun(runId) {
  const response = await fetch(`${baseUrl}/api/runs/${runId}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Could not fetch run ${runId}.`);
  return payload.run;
}

function summarizeRun(round, run) {
  const screenshotCount = run.events.filter((event) => event.type === "screenshot").length;
  return {
    round,
    id: run.id,
    status: run.status,
    screenshotCount,
    steps: run.steps.map((step) => ({ detail: step.detail, status: step.status })),
    errors: run.report?.errors || [],
    summary: run.report?.summary || "No report was produced."
  };
}

function printRound(result) {
  const failedStep = result.steps.find((step) => step.status === "failed");
  const status = result.status.toUpperCase().padEnd(6);
  const screenshots = String(result.screenshotCount).padStart(2, " ");
  console.log(
    `Round ${String(result.round).padStart(2, "0")} ${status} screenshots=${screenshots} run=${result.id} ${result.summary}`
  );
  if (failedStep) console.log(`  failed step: ${failedStep.detail}`);
  for (const error of result.errors) console.log(`  error: ${error}`);
}
