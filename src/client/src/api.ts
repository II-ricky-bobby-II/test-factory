import type {
  Project,
  ProjectFormState,
  AuthSession,
  IntegrationStatus,
  PrAutomationFormState,
  PrAutomationRun,
  PrTestRecommendationSet,
  PublicPrAutomationConfig,
  PublicQaRun,
  RunFormState,
  SavedTestRunForm,
  TestDefinition,
  TestEditorState,
  TestPlanResult,
  VercelProjectListResult
} from "./types";

export async function createRun(form: RunFormState): Promise<PublicQaRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({
      githubRepo: form.githubRepo,
      deploymentUrl: form.deploymentUrl,
      smokePrompt: form.smokePrompt,
      agentMode: form.agentMode,
      maxActions: form.maxActions,
      credentials:
        form.username || form.password
          ? {
              username: form.username,
              password: form.password
            }
          : undefined
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(formatApiError(payload));
  }
  return payload.run;
}

export async function fetchAuthSession(): Promise<AuthSession> {
  const session = await apiRequest<Partial<AuthSession>>("/api/auth/session");
  if (
    typeof session.authEnabled !== "boolean" ||
    typeof session.configured !== "boolean" ||
    typeof session.authenticated !== "boolean"
  ) {
    return { authEnabled: false, configured: true, authenticated: true };
  }
  return session as AuthSession;
}

export async function loginOwner(email: string, password: string): Promise<AuthSession> {
  return apiRequest<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function logoutOwner(): Promise<void> {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export async function fetchRun(id: string): Promise<PublicQaRun> {
  const response = await fetch(`/api/runs/${id}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Run not found.");
  }
  return payload.run;
}

export async function fetchProjects(): Promise<Project[]> {
  const payload = await apiRequest<{ projects: Project[] }>("/api/projects");
  return payload.projects;
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  return apiRequest<IntegrationStatus>("/api/integrations/status");
}

export async function createProject(form: ProjectFormState): Promise<Project> {
  const payload = await apiRequest<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(form)
  });
  return payload.project;
}

export async function updateProject(id: string, form: ProjectFormState): Promise<Project> {
  const payload = await apiRequest<{ project: Project }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(form)
  });
  return payload.project;
}

export async function deleteProject(id: string): Promise<void> {
  await apiRequest<void>(`/api/projects/${id}`, { method: "DELETE" });
}

export async function updatePrAutomation(projectId: string, form: PrAutomationFormState): Promise<Project> {
  const payload = await apiRequest<{ project: Project }>(`/api/projects/${projectId}/pr-automation`, {
    method: "PATCH",
    body: JSON.stringify(form)
  });
  return payload.project;
}

export async function verifyVercelProject(projectId: string, form: PrAutomationFormState): Promise<Project> {
  const payload = await apiRequest<{ project: Project }>(`/api/projects/${projectId}/pr-automation/vercel/verify`, {
    method: "POST",
    body: JSON.stringify(form)
  });
  return payload.project;
}

export async function discoverVercelProjects(projectId: string, form: PrAutomationFormState): Promise<VercelProjectListResult> {
  return apiRequest<VercelProjectListResult>(`/api/projects/${projectId}/pr-automation/vercel/projects`, {
    method: "POST",
    body: JSON.stringify(form)
  });
}

export async function syncGitHubProject(projectId: string): Promise<PublicPrAutomationConfig> {
  const payload = await apiRequest<{ prAutomation: PublicPrAutomationConfig }>(`/api/projects/${projectId}/pr-automation/github/sync`, {
    method: "POST"
  });
  return payload.prAutomation;
}

export async function fetchPrRuns(projectId?: string): Promise<PrAutomationRun[]> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const payload = await apiRequest<{ prRuns: PrAutomationRun[] }>(`/api/pr-runs${suffix}`);
  return payload.prRuns;
}

export async function rerunPrRun(prRunId: string): Promise<PrAutomationRun> {
  const payload = await apiRequest<{ prRun: PrAutomationRun }>(`/api/pr-runs/${prRunId}/rerun`, { method: "POST" });
  return payload.prRun;
}

export async function fetchPrTestDrafts(prRunId: string): Promise<PrTestRecommendationSet | null> {
  const payload = await apiRequest<{ recommendationSet: PrTestRecommendationSet | null }>(`/api/pr-runs/${prRunId}/test-drafts`);
  return payload.recommendationSet;
}

export async function generatePrTestDrafts(prRunId: string): Promise<PrTestRecommendationSet> {
  const payload = await apiRequest<{ recommendationSet: PrTestRecommendationSet }>(`/api/pr-runs/${prRunId}/test-drafts/generate`, {
    method: "POST"
  });
  return payload.recommendationSet;
}

export async function promotePrTestDraft(draftId: string): Promise<{ test: TestDefinition; recommendationSet: PrTestRecommendationSet }> {
  return apiRequest<{ test: TestDefinition; recommendationSet: PrTestRecommendationSet }>(`/api/pr-test-drafts/${draftId}/promote`, {
    method: "POST"
  });
}

export async function dismissPrTestDraft(draftId: string): Promise<PrTestRecommendationSet> {
  const payload = await apiRequest<{ recommendationSet: PrTestRecommendationSet }>(`/api/pr-test-drafts/${draftId}/dismiss`, {
    method: "POST"
  });
  return payload.recommendationSet;
}

export async function fetchProjectTests(projectId: string): Promise<TestDefinition[]> {
  const payload = await apiRequest<{ tests: TestDefinition[] }>(`/api/projects/${projectId}/tests`);
  return payload.tests;
}

export async function planProjectTest(projectId: string, prompt: string): Promise<TestPlanResult> {
  return apiRequest<TestPlanResult>(`/api/projects/${projectId}/tests/plan`, {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
}

export async function createProjectTest(projectId: string, form: TestEditorState): Promise<TestDefinition> {
  const payload = await apiRequest<{ test: TestDefinition }>(`/api/projects/${projectId}/tests`, {
    method: "POST",
    body: JSON.stringify(form)
  });
  return payload.test;
}

export async function updateProjectTest(testId: string, form: TestEditorState): Promise<TestDefinition> {
  const payload = await apiRequest<{ test: TestDefinition }>(`/api/tests/${testId}`, {
    method: "PATCH",
    body: JSON.stringify(form)
  });
  return payload.test;
}

export async function deleteProjectTest(testId: string): Promise<void> {
  await apiRequest<void>(`/api/tests/${testId}`, { method: "DELETE" });
}

export async function runProjectTest(testId: string, form: SavedTestRunForm): Promise<PublicQaRun> {
  const payload = await apiRequest<{ run: PublicQaRun }>(`/api/tests/${testId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      agentMode: form.agentMode,
      maxActions: form.maxActions,
      credentials:
        form.username || form.password
          ? {
              username: form.username,
              password: form.password
            }
          : undefined
    })
  });
  return payload.run;
}

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { ...mutationHeaders(), ...(init.headers || {}) } : init.headers
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(formatApiError(payload));
  }
  return payload as T;
}

function mutationHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Test-Factory-CSRF": "1"
  };
}

function formatApiError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Could not start run.";
  const body = payload as { error?: string; issues?: Record<string, string[]> };
  const issueText = body.issues
    ? Object.entries(body.issues)
        .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
        .join(" ")
    : "";
  return issueText || body.error || "Could not start run.";
}
