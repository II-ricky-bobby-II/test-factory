import { describe, expect, it } from "vitest";
import { planFallbackSteps } from "../src/server/stepPlanner";
import { normalizeDeploymentUrl } from "../src/server/types";

describe("planFallbackSteps", () => {
  it("extracts explicit QA smoke steps and adds login when credentials exist", () => {
    const steps = planFallbackSteps({
      credentials: { username: "qa@example.com", password: "secret" },
      smokePrompt: `Goal: verify donor history.

Steps:
1. Open donor preview URL.
2. Reach donor dashboard.
3. Click Giving History.
4. Confirm empty state appears.`
    });

    expect(steps.map((step) => step.detail)).toEqual([
      "Open the deployment URL and wait for the app shell.",
      "Log in with the provided QA credentials.",
      "Reach donor dashboard.",
      "Click Giving History.",
      "Confirm empty state appears.",
      "Confirm the requested flow completed without visible error banners, unexpected redirects, or broken UI."
    ]);
  });

  it("omits redundant prompt steps that only reopen the deployment", () => {
    const steps = planFallbackSteps({
      smokePrompt: `Steps:
1. Open admin preview URL.
2. Confirm admin sign in form is visible.
3. Confirm no visible error banner appears.`
    });

    expect(steps.map((step) => step.detail)).toEqual([
      "Open the deployment URL and wait for the app shell.",
      "Confirm admin sign in form is visible.",
      "Confirm no visible error banner appears.",
      "Confirm the requested flow completed without visible error banners, unexpected redirects, or broken UI."
    ]);
  });

  it("does not duplicate a login step when the prompt already asks for it", () => {
    const steps = planFallbackSteps({
      credentials: { username: "qa@example.com", password: "secret" },
      smokePrompt: "Open the app. Log in. Navigate to settings. Confirm settings heading appears."
    });

    const loginSteps = steps.filter((step) => /log ?in/i.test(step.detail));
    expect(loginSteps).toHaveLength(1);
    expect(steps.map((step) => step.detail)).not.toContain(".");
  });

  it("splits login from a compound prompted action", () => {
    const steps = planFallbackSteps({
      credentials: { username: "qa@example.com", password: "secret" },
      smokePrompt: "login and click around the menu."
    });

    expect(steps.map((step) => step.detail)).toContain("Log in with the provided QA credentials.");
    expect(steps.map((step) => step.detail)).toContain("click around the menu.");
  });
});

describe("normalizeDeploymentUrl", () => {
  it("adds https to bare hosts", () => {
    expect(normalizeDeploymentUrl("admin.asymmetric.al")).toBe("https://admin.asymmetric.al");
  });

  it("adds http to bare localhost targets", () => {
    expect(normalizeDeploymentUrl("localhost:4320")).toBe("http://localhost:4320");
    expect(normalizeDeploymentUrl("127.0.0.1:4320")).toBe("http://127.0.0.1:4320");
  });

  it("preserves explicit protocols", () => {
    expect(normalizeDeploymentUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
