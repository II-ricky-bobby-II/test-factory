import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Clock3,
  ExternalLink,
  Eye,
  Factory,
  FolderOpen,
  Github,
  GitPullRequest,
  Globe2,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Mail,
  Monitor,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Trash2,
  Wand2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  createProject,
  createProjectTest,
  createRun,
  deleteProject,
  deleteProjectTest,
  dismissPrTestDraft,
  discoverVercelProjects,
  fetchIntegrationStatus,
  fetchAuthSession,
  fetchProjectTests,
  fetchProjects,
  fetchPrRuns,
  fetchPrTestDrafts,
  fetchRun,
  generatePrTestDrafts,
  loginOwner,
  logoutOwner,
  planProjectTest,
  promotePrTestDraft,
  rerunPrRun,
  runProjectTest,
  syncGitHubProject,
  updateProject,
  updateProjectTest,
  updatePrAutomation,
  verifyVercelProject
} from "./api";
import { deleteProfile, formFromProfile, loadProfiles, saveProfile } from "./profiles";
import type {
  AgentMode,
  AuthSession,
  IntegrationStatus,
  PrAutomationFormState,
  PrAutomationRun,
  PrTestDraft,
  PrTestRecommendationSet,
  Project,
  ProjectFormState,
  PublicQaRun,
  QaEvent,
  ReusableStepType,
  ReusableTestStep,
  RunFormState,
  SavedRunProfile,
  SavedTestRunForm,
  StepStatus,
  TestDefinition,
  TestEditorState,
  VercelProjectListResult,
  VercelProjectSummary
} from "./types";

const defaultPrompt = `Surface: donor
Role: donor
Goal: verify donor can open Giving History.

Steps:
1. Open donor preview URL.
2. Log in.
3. Reach donor dashboard.
4. Open Giving History.
5. Confirm heading or empty state appears.

Expected:
No error banner. No sign-in prompt. No data mutation.`;

const initialAdHocForm: RunFormState = {
  profileName: "",
  githubRepo: "",
  deploymentUrl: "",
  username: "",
  password: "",
  smokePrompt: defaultPrompt,
  agentMode: "browser",
  maxActions: 8
};

const emptyProjectForm: ProjectFormState = {
  name: "",
  deploymentUrl: "",
  githubRepo: "",
  defaultAgentMode: "browser",
  defaultMaxActions: 8
};

const emptyTestForm: TestEditorState = {
  title: "",
  description: "",
  sourcePrompt: defaultPrompt,
  steps: []
};

const emptyPrAutomationForm: PrAutomationFormState = {
  enabled: false,
  githubOwner: "",
  githubRepo: "",
  githubInstallationId: "",
  selectedTestIds: [],
  previewWaitTimeoutSeconds: 120,
  vercelProjectId: "",
  vercelProjectName: "",
  vercelTeamId: "",
  vercelTeamSlug: "",
  vercelApiToken: "",
  vercelBypassSecret: ""
};

const stepTypes: ReusableStepType[] = ["act", "assert", "login", "screenshot"];
type ThemePreference = "light" | "dark" | "system";
type PageRoute = "home" | "login" | "app";
type PublicPreviewTab = "run" | "report" | "logs";
type AppRoute = "dashboard" | "projects" | "integrations";
const themeStorageKey = "qa-smoke.theme.v1";
const selectedProjectStorageKey = "qa-smoke.selected-project.v1";
const themeOptions: ThemePreference[] = ["light", "dark", "system"];
const localAuthSession: AuthSession = { authEnabled: false, configured: true, authenticated: true };

function isProductionBundle(): boolean {
  return (
    (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true ||
    (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === "production"
  );
}

export function App() {
  const [pageRoute, setPageRoute] = useState<PageRoute>(() => pageRouteFromLocation());
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  const [projects, setProjects] = useState<Project[]>([]);
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => loadSelectedProjectId());
  const [selectedTestId, setSelectedTestId] = useState("");
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [testForm, setTestForm] = useState<TestEditorState>(emptyTestForm);
  const [automationForm, setAutomationForm] = useState<PrAutomationFormState>(emptyPrAutomationForm);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | undefined>();
  const [prRuns, setPrRuns] = useState<PrAutomationRun[]>([]);
  const [prRecommendationSets, setPrRecommendationSets] = useState<Record<string, PrTestRecommendationSet | null>>({});
  const [runForm, setRunForm] = useState<SavedTestRunForm>({
    username: "",
    password: "",
    agentMode: "browser",
    maxActions: 8
  });

  const [adHocForm, setAdHocForm] = useState<RunFormState>(initialAdHocForm);
  const [profiles, setProfiles] = useState<SavedRunProfile[]>(() => loadProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState("");

  const [run, setRun] = useState<PublicQaRun | undefined>();
  const [events, setEvents] = useState<QaEvent[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [isStarting, setIsStarting] = useState(false);
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [isTestSaving, setIsTestSaving] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isIntegrationSaving, setIsIntegrationSaving] = useState(false);
  const [isVercelVerifying, setIsVercelVerifying] = useState(false);
  const [isVercelDiscovering, setIsVercelDiscovering] = useState(false);
  const [isVercelSelecting, setIsVercelSelecting] = useState(false);
  const [vercelProjectList, setVercelProjectList] = useState<VercelProjectListResult | undefined>();
  const [isGitHubSyncing, setIsGitHubSyncing] = useState(false);
  const [rerunningPrRunId, setRerunningPrRunId] = useState("");
  const [generatingPrDraftsRunId, setGeneratingPrDraftsRunId] = useState("");
  const [promotingDraftId, setPromotingDraftId] = useState("");
  const [dismissingDraftId, setDismissingDraftId] = useState("");
  const [copiedPromptRunId, setCopiedPromptRunId] = useState("");
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference());
  const [authSession, setAuthSession] = useState<AuthSession | undefined>(() =>
    isProductionBundle() ? undefined : localAuthSession
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedTest = tests.find((test) => test.id === selectedTestId);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  useEffect(() => {
    const onPopState = () => {
      setPageRoute(pageRouteFromLocation());
      setRoute(routeFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("githubConnected")) setMessage("Connected GitHub App installation.");
    if (params.get("githubError")) setError(githubSetupErrorCopy(params.get("githubError") || ""));
  }, []);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => applyThemePreference(themePreference), [themePreference]);

  useEffect(() => {
    if (pageRoute === "login" && authSession?.authenticated) {
      navigate("dashboard");
    }
  }, [authSession?.authenticated, pageRoute]);

  useEffect(() => {
    if (!run?.id) return undefined;

    const source = new EventSource(`/api/runs/${run.id}/events`);
    source.onmessage = (messageEvent) => {
      const event = JSON.parse(messageEvent.data) as QaEvent;
      setEvents((current) => mergeEvents(current, event));
      void fetchRun(run.id).then(setRun).catch(() => undefined);
    };
    for (const name of ["status", "step", "log", "screenshot", "report"]) {
      source.addEventListener(name, (messageEvent) => {
        const event = JSON.parse((messageEvent as MessageEvent).data) as QaEvent;
        setEvents((current) => mergeEvents(current, event));
        void fetchRun(run.id).then(setRun).catch(() => undefined);
      });
    }
    return () => source.close();
  }, [run?.id]);

  const orderedEvents = useMemo(() => [...events].sort((a, b) => a.at.localeCompare(b.at)), [events]);
  const latestScreenshotEvent = [...orderedEvents].reverse().find((event) => event.screenshot);
  const latestImage = latestScreenshotEvent?.screenshot || run?.latestScreenshot;
  const browserCaption =
    latestScreenshotEvent?.message || (run?.status === "running" ? "Browser agent is running." : "Awaiting run");

  async function refreshProjects(preferredProjectId?: string) {
    try {
      const nextProjects = await fetchProjects();
      const storedProjectId = preferredProjectId ?? selectedProjectId ?? loadSelectedProjectId();
      const nextProject =
        nextProjects.find((project) => project.id === storedProjectId) || nextProjects[0] || undefined;

      setProjects(nextProjects);
      if (nextProject) {
        saveSelectedProjectId(nextProject.id);
        setSelectedProjectId(nextProject.id);
        setProjectForm(projectFormFromProject(nextProject));
        setRunForm((current) => ({
          ...current,
          agentMode: nextProject.defaultAgentMode,
          maxActions: nextProject.defaultMaxActions
        }));
        setAutomationForm(automationFormFromProject(nextProject));
        syncAdHocWithProject(nextProject, false);
        await refreshTests(nextProject.id);
        await refreshPrRuns(nextProject.id);
        return;
      }

      saveSelectedProjectId("");
      setSelectedProjectId("");
      setSelectedTestId("");
      setProjectForm(emptyProjectForm);
      setAutomationForm(emptyPrAutomationForm);
      setVercelProjectList(undefined);
      setTests([]);
      setTestForm(emptyTestForm);
      setPrRuns([]);
      setPrRecommendationSets({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load projects.");
    }
  }

  async function refreshIntegrationStatus() {
    try {
      setIntegrationStatus(await fetchIntegrationStatus());
    } catch {
      setIntegrationStatus(undefined);
    }
  }

  async function bootstrap() {
    try {
      const session = await fetchAuthSession();
      setAuthSession(session);
      if (session.authenticated) {
        await refreshProjects();
        await refreshIntegrationStatus();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load sign-in session.");
      if (isProductionBundle()) {
        setAuthSession({ authEnabled: true, configured: false, authenticated: false });
      }
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setIsLoggingIn(true);
    setError(undefined);
    try {
      const session = await loginOwner(loginEmail, loginPassword);
      setAuthSession(session);
      setLoginEmail("");
      setLoginPassword("");
      await refreshProjects();
      await refreshIntegrationStatus();
      navigate("dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function onLogout() {
    await logoutOwner();
    setAuthSession({ authEnabled: true, configured: true, authenticated: false });
    setProjects([]);
    setTests([]);
    setRun(undefined);
    setEvents([]);
    navigateToLogin();
  }

  async function refreshTests(projectId: string, preferredTestId?: string) {
    const nextTests = await fetchProjectTests(projectId);
    setTests(nextTests);
    const nextSelectedId = preferredTestId || selectedTestId || nextTests[0]?.id || "";
    const nextTest = nextTests.find((test) => test.id === nextSelectedId);
    if (nextTest) {
      setSelectedTestId(nextTest.id);
      setTestForm(testFormFromTest(nextTest));
    } else {
      setSelectedTestId("");
      setTestForm(emptyTestForm);
    }
  }

  async function refreshPrRuns(projectId: string = selectedProjectId) {
    if (!projectId) {
      setPrRuns([]);
      setPrRecommendationSets({});
      return;
    }
    try {
      const nextRuns = await fetchPrRuns(projectId);
      setPrRuns(nextRuns);
      await refreshPrRecommendationSets(nextRuns);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load PR preview runs.");
    }
  }

  async function refreshPrRecommendationSets(nextRuns: PrAutomationRun[]) {
    const entries = await Promise.all(
      nextRuns.map(async (prRun) => {
        try {
          return [prRun.id, await fetchPrTestDrafts(prRun.id)] as const;
        } catch {
          return [prRun.id, null] as const;
        }
      })
    );
    setPrRecommendationSets(Object.fromEntries(entries));
  }

  function navigate(nextRoute: AppRoute) {
    const nextPath = appPathForRoute(nextRoute);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
    setPageRoute("app");
    setRoute(nextRoute);
  }

  function navigateToLogin(event?: MouseEvent<HTMLAnchorElement>) {
    event?.preventDefault();
    if (authSession?.authenticated) {
      navigate("dashboard");
      return;
    }
    if (window.location.pathname !== "/login") {
      window.history.pushState(null, "", "/login");
    }
    setPageRoute("login");
  }

  function syncAdHocWithProject(project: Project, force: boolean) {
    setAdHocForm((current) => {
      if (!force && (current.deploymentUrl || current.githubRepo)) return current;
      return {
        ...current,
        githubRepo: project.githubRepo,
        deploymentUrl: project.deploymentUrl,
        agentMode: project.defaultAgentMode,
        maxActions: project.defaultMaxActions
      };
    });
  }

  function selectProject(projectId: string) {
    const project = projects.find((candidate) => candidate.id === projectId);
    setSelectedProjectId(projectId);
    setSelectedTestId("");
    setMessage(undefined);
    setError(undefined);
    setVercelProjectList(undefined);
    saveSelectedProjectId(projectId);
    if (!project) {
      setProjectForm(emptyProjectForm);
      setAutomationForm(emptyPrAutomationForm);
      setVercelProjectList(undefined);
      setTests([]);
      setTestForm(emptyTestForm);
      setPrRuns([]);
      setPrRecommendationSets({});
      return;
    }
    setProjectForm(projectFormFromProject(project));
    setAutomationForm(automationFormFromProject(project));
    setRunForm((current) => ({ ...current, agentMode: project.defaultAgentMode, maxActions: project.defaultMaxActions }));
    syncAdHocWithProject(project, true);
    void refreshTests(project.id, "");
    void refreshPrRuns(project.id);
  }

  function selectTest(testId: string) {
    const test = tests.find((candidate) => candidate.id === testId);
    setSelectedTestId(testId);
    setMessage(undefined);
    setError(undefined);
    setTestForm(test ? testFormFromTest(test) : emptyTestForm);
  }

  async function onSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsProjectSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = selectedProject
        ? await updateProject(selectedProject.id, projectForm)
        : await createProject(projectForm);
      setMessage(selectedProject ? `Updated "${saved.name}".` : `Created "${saved.name}".`);
      syncAdHocWithProject(saved, true);
      await refreshProjects(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save project.");
    } finally {
      setIsProjectSaving(false);
    }
  }

  async function onDeleteProject() {
    if (!selectedProject) return;
    setError(undefined);
    setMessage(undefined);
    try {
      await deleteProject(selectedProject.id);
      setMessage(`Deleted "${selectedProject.name}".`);
      await refreshProjects("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete project.");
    }
  }

  async function onPlanTest() {
    if (!selectedProject) return;
    setIsPlanning(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const plan = await planProjectTest(selectedProject.id, testForm.sourcePrompt);
      setTestForm((current) => ({
        ...current,
        title: current.title || conciseTitle(current.sourcePrompt),
        steps: plan.steps
      }));
      setMessage(plan.source === "claude" ? "Generated reusable steps with Claude." : "Generated reusable fallback steps.");
      if (plan.warning) setError(`Planner warning: ${plan.warning}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate test steps.");
    } finally {
      setIsPlanning(false);
    }
  }

  async function onSaveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    if (testForm.steps.length === 0) {
      setError("Generate or add at least one step before saving the test.");
      return;
    }
    setIsTestSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = selectedTest
        ? await updateProjectTest(selectedTest.id, testForm)
        : await createProjectTest(selectedProject.id, testForm);
      setMessage(selectedTest ? `Updated "${saved.title}".` : `Created "${saved.title}".`);
      await refreshTests(selectedProject.id, saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save test.");
    } finally {
      setIsTestSaving(false);
    }
  }

  async function onDeleteTest() {
    if (!selectedProject || !selectedTest) return;
    setError(undefined);
    setMessage(undefined);
    try {
      await deleteProjectTest(selectedTest.id);
      setMessage(`Deleted "${selectedTest.title}".`);
      await refreshTests(selectedProject.id, "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete test.");
    }
  }

  async function onRunSavedTest() {
    if (!selectedTest) return;
    setError(undefined);
    setMessage(undefined);
    setIsStarting(true);
    setEvents([]);
    setCopiedPromptRunId("");
    try {
      const nextRun = await runProjectTest(selectedTest.id, runForm);
      setRun(nextRun);
      setEvents(nextRun.events);
      setMessage(`Started "${selectedTest.title}".`);
      navigate("dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start saved test.");
    } finally {
      setIsStarting(false);
    }
  }

  async function onRunAdHoc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    setIsStarting(true);
    setEvents([]);
    setCopiedPromptRunId("");
    try {
      const nextRun = await createRun(adHocForm);
      setRun(nextRun);
      setEvents(nextRun.events);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start run.");
    } finally {
      setIsStarting(false);
    }
  }

  function onSaveProfile() {
    const nextProfiles = saveProfile(adHocForm, profiles);
    const saved = nextProfiles[0];
    setProfiles(nextProfiles);
    setSelectedProfileId(saved.id);
    setAdHocForm({ ...adHocForm, profileName: saved.profileName });
    setMessage(`Saved "${saved.profileName}".`);
    setError(undefined);
  }

  function updateAdHocForm(patch: Partial<RunFormState>) {
    setAdHocForm((current) => ({ ...current, ...patch }));
    setSelectedProfileId("");
    setMessage(undefined);
  }

  function onSelectProfile(profileId: string) {
    setSelectedProfileId(profileId);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      setMessage(undefined);
      return;
    }
    setAdHocForm(formFromProfile(profile));
    setMessage(`Loaded "${profile.profileName}".`);
    setError(undefined);
  }

  function onDeleteProfile() {
    if (!selectedProfile) return;
    const nextProfiles = deleteProfile(selectedProfile.id, profiles);
    setProfiles(nextProfiles);
    setSelectedProfileId("");
    setMessage(`Deleted "${selectedProfile.profileName}".`);
  }

  async function onCopyFixPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPromptRunId(run?.id || "current");
      setError(undefined);
    } catch {
      setError("Could not copy the fix-it prompt from this browser.");
    }
  }

  async function onSaveIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    setIsIntegrationSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const updated = await updatePrAutomation(selectedProject.id, automationForm);
      setAutomationForm(automationFormFromProject(updated));
      setMessage("Saved PR preview automation settings.");
      await refreshProjects(updated.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save integration settings.");
    } finally {
      setIsIntegrationSaving(false);
    }
  }

  async function onVerifyVercel() {
    if (!selectedProject) return;
    setIsVercelVerifying(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const updated = await verifyVercelProject(selectedProject.id, automationForm);
      const verification = updated.prAutomation.lastVercelVerification;
      setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)));
      if (verification?.ok) {
        setAutomationForm((current) => ({
          ...automationFormFromConfig(updated.prAutomation),
          vercelApiToken: current.vercelApiToken,
          vercelBypassSecret: current.vercelBypassSecret
        }));
      }
      setMessage(verification?.message || "Vercel verification finished.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify Vercel project.");
    } finally {
      setIsVercelVerifying(false);
    }
  }

  async function onDiscoverVercelProjects() {
    if (!selectedProject) return;
    setIsVercelDiscovering(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await discoverVercelProjects(selectedProject.id, automationForm);
      setVercelProjectList(result);
      const listedProject = result.project;
      if (listedProject) {
        setProjects((current) => current.map((project) => (project.id === listedProject.id ? listedProject : project)));
      }
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not list Vercel projects.");
    } finally {
      setIsVercelDiscovering(false);
    }
  }

  async function selectVercelProject(project: VercelProjectSummary) {
    if (!selectedProject) return;
    const nextForm = {
      ...automationForm,
      vercelProjectId: project.id,
      vercelProjectName: project.name,
      vercelTeamId: project.teamId || automationForm.vercelTeamId,
      vercelTeamSlug: project.teamSlug || automationForm.vercelTeamSlug
    };
    setAutomationForm(nextForm);
    setIsVercelSelecting(true);
    setError(undefined);
    try {
      const updated = await updatePrAutomation(selectedProject.id, nextForm);
      setProjects((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      setAutomationForm((current) => ({
        ...automationFormFromConfig(updated.prAutomation),
        vercelApiToken: current.vercelApiToken,
        vercelBypassSecret: current.vercelBypassSecret
      }));
      setMessage(`Connected Vercel project "${project.name}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect Vercel project.");
    } finally {
      setIsVercelSelecting(false);
    }
  }

  async function onSyncGitHub() {
    if (!selectedProject) return;
    setIsGitHubSyncing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const config = await syncGitHubProject(selectedProject.id);
      setAutomationForm((current) => ({ ...current, ...automationFormFromConfig(config) }));
      setMessage(config.lastGithubSync?.message || "GitHub App sync finished.");
      await refreshProjects(selectedProject.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sync GitHub App installation.");
    } finally {
      setIsGitHubSyncing(false);
    }
  }

  async function onRerunPrRun(prRunId: string) {
    setRerunningPrRunId(prRunId);
    setError(undefined);
    setMessage(undefined);
    try {
      await rerunPrRun(prRunId);
      setMessage("Started PR preview rerun.");
      await refreshPrRuns();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rerun PR preview automation.");
    } finally {
      setRerunningPrRunId("");
    }
  }

  async function onGeneratePrDrafts(prRunId: string) {
    setGeneratingPrDraftsRunId(prRunId);
    setError(undefined);
    setMessage(undefined);
    try {
      const recommendationSet = await generatePrTestDrafts(prRunId);
      setPrRecommendationSets((current) => ({ ...current, [prRunId]: recommendationSet }));
      setMessage(recommendationSet.status === "ready" ? "Generated PR-aware test drafts." : recommendationSet.summary);
      await refreshPrRuns();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate PR-aware test drafts.");
    } finally {
      setGeneratingPrDraftsRunId("");
    }
  }

  async function onPromotePrDraft(draft: PrTestDraft) {
    if (!selectedProject) return;
    setPromotingDraftId(draft.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await promotePrTestDraft(draft.id);
      replaceRecommendationSet(result.recommendationSet);
      setMessage(`Saved "${result.test.title}" to reusable tests.`);
      await refreshTests(selectedProject.id, result.test.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save PR test draft.");
    } finally {
      setPromotingDraftId("");
    }
  }

  async function onDismissPrDraft(draft: PrTestDraft) {
    setDismissingDraftId(draft.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const recommendationSet = await dismissPrTestDraft(draft.id);
      replaceRecommendationSet(recommendationSet);
      setMessage(`Dismissed "${draft.title}".`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not dismiss PR test draft.");
    } finally {
      setDismissingDraftId("");
    }
  }

  function replaceRecommendationSet(recommendationSet: PrTestRecommendationSet) {
    setPrRecommendationSets((current) =>
      Object.fromEntries(
        Object.entries(current).map(([prRunId, existing]) => [
          prRunId,
          existing?.id === recommendationSet.id ? recommendationSet : existing
        ])
      )
    );
  }

  function toggleAutomationTest(testId: string) {
    setAutomationForm((current) => ({
      ...current,
      selectedTestIds: current.selectedTestIds.includes(testId)
        ? current.selectedTestIds.filter((candidate) => candidate !== testId)
        : [...current.selectedTestIds, testId]
    }));
  }

  function updateStep(index: number, patch: Partial<ReusableTestStep>) {
    setTestForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step))
    }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setTestForm((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.steps.length) return current;
      const steps = [...current.steps];
      const [moved] = steps.splice(index, 1);
      steps.splice(targetIndex, 0, moved);
      return { ...current, steps };
    });
  }

  function removeStep(index: number) {
    setTestForm((current) => ({ ...current, steps: current.steps.filter((_step, stepIndex) => stepIndex !== index) }));
  }

  function renderDashboard() {
    return (
      <div className="dashboard-shell" aria-label="Test Factory dashboard">
        <section className="control-pane" aria-label="Run setup">
          <section className="pane-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Smoke run</p>
                <h2>Run a smoke check</h2>
              </div>
            </div>

            <form className="run-form" onSubmit={onRunAdHoc}>
              <div className="profile-tools">
                <Field label="Settings name" icon={<Save size={16} aria-hidden />}>
                  <input
                    value={adHocForm.profileName}
                    onChange={(event) => updateAdHocForm({ profileName: event.target.value })}
                    placeholder="Checkout smoke"
                    autoComplete="off"
                  />
                </Field>

                <label className="field-block">
                  <span className="field-label">
                    <FolderOpen size={16} aria-hidden />
                    Saved settings
                  </span>
                  <select value={selectedProfileId} onChange={(event) => onSelectProfile(event.target.value)} aria-label="Saved settings">
                    <option value="">Choose saved settings</option>
                    {profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.profileName}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="profile-actions">
                  <button type="button" className="secondary-button" onClick={onSaveProfile}>
                    <Save size={15} aria-hidden />
                    Save
                  </button>
                  <button
                    type="button"
                    className="icon-danger-button"
                    onClick={onDeleteProfile}
                    disabled={!selectedProfile}
                    title="Delete saved settings"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>

                <p className="profile-note">Saved settings are stored in this browser. Passwords are never saved.</p>
              </div>

              <Field label="GitHub repo" icon={<Github size={16} aria-hidden />}>
                <input
                  value={adHocForm.githubRepo}
                  onChange={(event) => updateAdHocForm({ githubRepo: event.target.value })}
                  placeholder="https://github.com/org/repo"
                  autoComplete="off"
                />
              </Field>

              <Field label="Deployment URL" icon={<Globe2 size={16} aria-hidden />}>
                <input
                  required
                  value={adHocForm.deploymentUrl}
                  onChange={(event) => updateAdHocForm({ deploymentUrl: event.target.value })}
                  placeholder="https://preview.example.com"
                  autoComplete="url"
                />
              </Field>

              <div className="credential-grid">
                <Field label="Username" icon={<KeyRound size={16} aria-hidden />}>
                  <input
                    value={adHocForm.username}
                    onChange={(event) => updateAdHocForm({ username: event.target.value })}
                    placeholder="qa@example.com"
                    autoComplete="username"
                  />
                </Field>
                <Field label="Password" icon={<KeyRound size={16} aria-hidden />}>
                  <input
                    value={adHocForm.password}
                    onChange={(event) => updateAdHocForm({ password: event.target.value })}
                    placeholder="Optional"
                    type="password"
                    autoComplete="current-password"
                  />
                </Field>
              </div>

              <label className="field-block">
                <span className="field-label">
                  <TerminalSquare size={16} aria-hidden />
                  QA prompt
                </span>
                <textarea
                  required
                  value={adHocForm.smokePrompt}
                  onChange={(event) => updateAdHocForm({ smokePrompt: event.target.value })}
                  rows={8}
                />
              </label>

              <div className="form-footer">
                <ModeToggle value={adHocForm.agentMode} onChange={(agentMode) => updateAdHocForm({ agentMode })} label="Agent mode" />
                <button className="primary-button" type="submit" disabled={isStarting}>
                  {isStarting ? <Loader2 className="spin" size={17} aria-hidden /> : <Play size={17} aria-hidden />}
                  Run smoke check
                </button>
              </div>
            </form>
          </section>

          {message ? <div className="save-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <RunWorkspace
          run={run}
          orderedEvents={orderedEvents}
          latestImage={latestImage}
          browserCaption={browserCaption}
          copiedPromptRunId={copiedPromptRunId}
          onCopyFixPrompt={onCopyFixPrompt}
        />
      </div>
    );
  }

  function renderProjects() {
    return (
      <div className="projects-shell" aria-label="Runs">
        <section className="project-directory-pane" aria-label="Run targets">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Runs</p>
              <h2>{selectedProject ? selectedProject.name : "New run target"}</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => selectProject("")} title="New project">
              <Plus size={17} aria-hidden />
            </button>
          </div>

          <div className="project-list">
            {projects.map((project) => (
              <button
                type="button"
                className={project.id === selectedProjectId ? "project-button active" : "project-button"}
                onClick={() => selectProject(project.id)}
                key={project.id}
              >
                <strong>{project.name}</strong>
                <span>{project.deploymentUrl}</span>
              </button>
            ))}
            {projects.length === 0 ? <div className="empty-list compact">No projects yet.</div> : null}
          </div>

          <form className="run-form" onSubmit={onSaveProject}>
            <Field label="Project name" icon={<FolderOpen size={16} aria-hidden />}>
              <input
                required
                value={projectForm.name}
                onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
                placeholder="Preview workspace"
                autoComplete="off"
              />
            </Field>
            <Field label="Project URL" icon={<Globe2 size={16} aria-hidden />}>
              <input
                required
                value={projectForm.deploymentUrl}
                onChange={(event) => setProjectForm({ ...projectForm, deploymentUrl: event.target.value })}
                placeholder="https://preview.example.com"
                autoComplete="url"
              />
            </Field>
            <Field label="Project GitHub repo" icon={<Github size={16} aria-hidden />}>
              <input
                value={projectForm.githubRepo}
                onChange={(event) => setProjectForm({ ...projectForm, githubRepo: event.target.value })}
                placeholder="https://github.com/org/repo"
                autoComplete="off"
              />
            </Field>

            <div className="setting-grid">
              <ModeToggle
                value={projectForm.defaultAgentMode}
                onChange={(agentMode) => setProjectForm({ ...projectForm, defaultAgentMode: agentMode })}
                label="Default mode"
              />
              <Field label="Max actions" icon={<ListChecks size={16} aria-hidden />}>
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={projectForm.defaultMaxActions}
                  onChange={(event) => setProjectForm({ ...projectForm, defaultMaxActions: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="button-row">
              <button className="primary-button" type="submit" disabled={isProjectSaving}>
                {isProjectSaving ? <Loader2 className="spin" size={17} aria-hidden /> : <Save size={17} aria-hidden />}
                {selectedProject ? "Save project" : "Create project"}
              </button>
              <button
                type="button"
                className="icon-danger-button"
                onClick={onDeleteProject}
                disabled={!selectedProject}
                title="Delete project"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </form>

          {message ? <div className="save-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <section className="project-detail-pane" aria-label="Reusable test details">
          {selectedProject ? (
            <>
              <div className="project-detail-header">
                <div>
                  <p className="eyebrow">Current project</p>
                  <h2>{selectedProject.name}</h2>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    syncAdHocWithProject(selectedProject, true);
                    navigate("dashboard");
                  }}
                >
                  <LayoutDashboard size={16} aria-hidden />
                  Open dashboard
                </button>
              </div>

              <div className="project-summary-strip">
                <SummaryItem label="URL" value={selectedProject.deploymentUrl} href={selectedProject.deploymentUrl} />
                <SummaryItem label="GitHub repo" value={selectedProject.githubRepo || "Not set"} href={selectedProject.githubRepo || undefined} />
                <SummaryItem label="Default mode" value={modeCopy(selectedProject.defaultAgentMode)} />
                <SummaryItem label="Max actions" value={String(selectedProject.defaultMaxActions)} />
              </div>

              <div className="project-workspace-grid">
                <section className="detail-panel test-library-panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Reusable tests</p>
                      <h2>{selectedTest ? selectedTest.title : "New test"}</h2>
                    </div>
                    <button type="button" className="icon-button" onClick={() => selectTest("")} title="New test">
                      <Plus size={17} aria-hidden />
                    </button>
                  </div>

                  <div className="test-list">
                    {tests.map((test) => (
                      <button
                        type="button"
                        className={test.id === selectedTestId ? "test-button active" : "test-button"}
                        onClick={() => selectTest(test.id)}
                        key={test.id}
                      >
                        <strong>{test.title}</strong>
                        <span>
                          {test.steps.length} step{test.steps.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    ))}
                    {tests.length === 0 ? <div className="empty-list compact">No saved tests for this project.</div> : null}
                  </div>
                </section>

                <section className="detail-panel test-editor-panel">
                  <form className="run-form" onSubmit={onSaveTest}>
                    <Field label="Test title" icon={<ListChecks size={16} aria-hidden />}>
                      <input
                        required
                        value={testForm.title}
                        onChange={(event) => setTestForm({ ...testForm, title: event.target.value })}
                        placeholder="Donor giving history"
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Description" icon={<TerminalSquare size={16} aria-hidden />}>
                      <input
                        value={testForm.description}
                        onChange={(event) => setTestForm({ ...testForm, description: event.target.value })}
                        placeholder="Critical donor dashboard flow"
                        autoComplete="off"
                      />
                    </Field>

                    <label className="field-block">
                      <span className="field-label">
                        <Wand2 size={16} aria-hidden />
                        Source prompt
                      </span>
                      <textarea
                        value={testForm.sourcePrompt}
                        onChange={(event) => setTestForm({ ...testForm, sourcePrompt: event.target.value })}
                        rows={7}
                      />
                    </label>

                    <div className="button-row">
                      <button type="button" className="secondary-button" onClick={onPlanTest} disabled={isPlanning}>
                        {isPlanning ? <Loader2 className="spin" size={16} aria-hidden /> : <Wand2 size={16} aria-hidden />}
                        Generate steps
                      </button>
                      <button type="button" className="secondary-button" onClick={() => setTestForm({ ...testForm, steps: [...testForm.steps, newStep()] })}>
                        <Plus size={16} aria-hidden />
                        Add step
                      </button>
                    </div>

                    <div className="step-editor-list">
                      {testForm.steps.map((step, index) => (
                        <div className="step-editor-row" key={step.id}>
                          <div className="step-editor-top">
                            <select
                              aria-label={`Step ${index + 1} type`}
                              value={step.type}
                              onChange={(event) => updateStep(index, { type: event.target.value as ReusableStepType })}
                            >
                              {stepTypes.map((type) => (
                                <option value={type} key={type}>
                                  {stepTypeLabel(type)}
                                </option>
                              ))}
                            </select>
                            <div className="step-editor-actions">
                              <button type="button" className="icon-button" onClick={() => moveStep(index, -1)} disabled={index === 0} title="Move step up">
                                <ArrowUp size={15} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() => moveStep(index, 1)}
                                disabled={index === testForm.steps.length - 1}
                                title="Move step down"
                              >
                                <ArrowDown size={15} aria-hidden />
                              </button>
                              <button type="button" className="icon-danger-button" onClick={() => removeStep(index)} title="Delete step">
                                <Trash2 size={15} aria-hidden />
                              </button>
                            </div>
                          </div>
                          <input
                            aria-label={`Step ${index + 1} title`}
                            required
                            value={step.title}
                            onChange={(event) => updateStep(index, { title: event.target.value })}
                            placeholder="Open dashboard"
                          />
                          <textarea
                            aria-label={`Step ${index + 1} detail`}
                            required
                            value={step.detail}
                            onChange={(event) => updateStep(index, { detail: event.target.value })}
                            rows={3}
                            placeholder="Navigate to the dashboard and wait for the app shell."
                          />
                        </div>
                      ))}
                      {testForm.steps.length === 0 ? <div className="empty-list compact">Generate or add at least one step.</div> : null}
                    </div>

                    <div className="button-row">
                      <button className="primary-button" type="submit" disabled={isTestSaving}>
                        {isTestSaving ? <Loader2 className="spin" size={17} aria-hidden /> : <Save size={17} aria-hidden />}
                        {selectedTest ? "Save test" : "Create test"}
                      </button>
                      <button type="button" className="icon-danger-button" onClick={onDeleteTest} disabled={!selectedTest} title="Delete test">
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </form>
                </section>

                <section className="detail-panel saved-test-panel" aria-label="Run saved test">
                  <div>
                    <p className="eyebrow">Run saved test</p>
                    <h2>{selectedTest ? selectedTest.title : "Select a test"}</h2>
                  </div>
                  <div className="credential-grid">
                    <Field label="Run username" icon={<KeyRound size={16} aria-hidden />}>
                      <input
                        value={runForm.username}
                        onChange={(event) => setRunForm({ ...runForm, username: event.target.value })}
                        placeholder="qa@example.com"
                        autoComplete="username"
                      />
                    </Field>
                    <Field label="Run password" icon={<KeyRound size={16} aria-hidden />}>
                      <input
                        value={runForm.password}
                        onChange={(event) => setRunForm({ ...runForm, password: event.target.value })}
                        placeholder="Optional"
                        type="password"
                        autoComplete="current-password"
                      />
                    </Field>
                  </div>
                  <div className="setting-grid">
                    <ModeToggle value={runForm.agentMode} onChange={(agentMode) => setRunForm({ ...runForm, agentMode })} label="Run mode" />
                    <Field label="Run max actions" icon={<ListChecks size={16} aria-hidden />}>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={runForm.maxActions}
                        onChange={(event) => setRunForm({ ...runForm, maxActions: Number(event.target.value) })}
                      />
                    </Field>
                  </div>
                  <button className="primary-button wide" type="button" onClick={onRunSavedTest} disabled={!selectedTest || isStarting}>
                    {isStarting ? <Loader2 className="spin" size={17} aria-hidden /> : <Play size={17} aria-hidden />}
                    Run saved test
                  </button>
                </section>
              </div>
            </>
          ) : (
            <div className="empty-project-detail">
              <FolderOpen size={42} aria-hidden />
              <strong>Create or select a project to manage reusable tests.</strong>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderIntegrations() {
    return (
      <div className="integrations-shell" aria-label="Settings">
        <section className="integration-main">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>{selectedProject ? `${selectedProject.name} PR previews` : "Select a project"}</h2>
            </div>
            <button type="button" className="secondary-button" onClick={() => void refreshPrRuns()} disabled={!selectedProject}>
              <RefreshCw size={16} aria-hidden />
              Refresh
            </button>
          </div>

          <div className="integration-status-grid">
            <IntegrationStatusItem label="GitHub App" ok={Boolean(integrationStatus?.githubAppConfigured)} />
            <IntegrationStatusItem label="GitHub login" ok={Boolean(integrationStatus?.githubInstallFlowConfigured)} />
            <IntegrationStatusItem label="Webhook secret" ok={Boolean(integrationStatus?.githubWebhookSecretConfigured)} />
            <IntegrationStatusItem label="Public URL" ok={Boolean(integrationStatus?.publicUrlConfigured)} />
            <IntegrationStatusItem label="Manual Vercel" ok={Boolean(integrationStatus?.vercelManualConnection)} />
          </div>

          {selectedProject ? (
            <form className="integration-grid" onSubmit={onSaveIntegration}>
              <section className="detail-panel integration-panel">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">GitHub App</p>
                    <h3>Repository mapping</h3>
                  </div>
                  <div className="header-actions">
                    {integrationStatus?.githubInstallFlowConfigured ? (
                      <a className="secondary-button" href={`/api/github/login?projectId=${encodeURIComponent(selectedProject.id)}`}>
                        <Github size={16} aria-hidden />
                        Connect GitHub
                      </a>
                    ) : (
                      <a className="secondary-button" href={`/api/github/manifest/new?projectId=${encodeURIComponent(selectedProject.id)}`}>
                        <Github size={16} aria-hidden />
                        Create GitHub App
                      </a>
                    )}
                    <button type="button" className="secondary-button" onClick={onSyncGitHub} disabled={isGitHubSyncing}>
                      {isGitHubSyncing ? <Loader2 className="spin" size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                      Sync
                    </button>
                  </div>
                </div>
                <GitHubSetupNote status={integrationStatus} />
                <div className="setting-grid">
                  <Field label="Owner" icon={<Github size={16} aria-hidden />}>
                    <input
                      value={automationForm.githubOwner}
                      onChange={(event) => setAutomationForm({ ...automationForm, githubOwner: event.target.value })}
                      placeholder="acme"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Repo" icon={<Github size={16} aria-hidden />}>
                    <input
                      value={automationForm.githubRepo}
                      onChange={(event) => setAutomationForm({ ...automationForm, githubRepo: event.target.value })}
                      placeholder="app"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Field label="Installation ID" icon={<KeyRound size={16} aria-hidden />}>
                  <input
                    value={automationForm.githubInstallationId}
                    onChange={(event) => setAutomationForm({ ...automationForm, githubInstallationId: event.target.value })}
                    placeholder="Synced from GitHub App"
                    autoComplete="off"
                  />
                </Field>
                <ConnectionNote check={selectedProject.prAutomation.lastGithubSync} fallback={selectedProject.prAutomation.githubInstalled ? "GitHub App is mapped." : "GitHub App is not mapped yet."} />
              </section>

              <section className="detail-panel integration-panel">
                <div className="section-heading compact-heading">
                  <div>
                    <p className="eyebrow">Vercel</p>
                    <h3>Preview discovery</h3>
                  </div>
                  <div className="header-actions">
                    <button type="button" className="secondary-button" onClick={onDiscoverVercelProjects} disabled={isVercelDiscovering}>
                      {isVercelDiscovering ? <Loader2 className="spin" size={16} aria-hidden /> : <ListChecks size={16} aria-hidden />}
                      List projects
                    </button>
                    <button type="button" className="secondary-button" onClick={onVerifyVercel} disabled={isVercelVerifying}>
                      {isVercelVerifying ? <Loader2 className="spin" size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
                      Verify
                    </button>
                  </div>
                </div>
                <div className="setting-grid">
                  <Field label="Project ID" icon={<Globe2 size={16} aria-hidden />}>
                    <input
                      value={automationForm.vercelProjectId}
                      onChange={(event) => setAutomationForm({ ...automationForm, vercelProjectId: event.target.value })}
                      placeholder="prj_..."
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Project name" icon={<Globe2 size={16} aria-hidden />}>
                    <input
                      value={automationForm.vercelProjectName}
                      onChange={(event) => setAutomationForm({ ...automationForm, vercelProjectName: event.target.value })}
                      placeholder="web-app"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <div className="setting-grid">
                  <Field label="Team ID" icon={<Globe2 size={16} aria-hidden />}>
                    <input
                      value={automationForm.vercelTeamId}
                      onChange={(event) => setAutomationForm({ ...automationForm, vercelTeamId: event.target.value })}
                      placeholder="team_..."
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Team slug" icon={<Globe2 size={16} aria-hidden />}>
                    <input
                      value={automationForm.vercelTeamSlug}
                      onChange={(event) => setAutomationForm({ ...automationForm, vercelTeamSlug: event.target.value })}
                      placeholder="acme"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Field label="Vercel API token" icon={<KeyRound size={16} aria-hidden />}>
                  <input
                    value={automationForm.vercelApiToken}
                    onChange={(event) => setAutomationForm({ ...automationForm, vercelApiToken: event.target.value })}
                    placeholder={selectedProject.prAutomation.vercelConnected ? "Saved token unchanged" : "Required"}
                    type="password"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Automation bypass secret" icon={<KeyRound size={16} aria-hidden />}>
                  <input
                    value={automationForm.vercelBypassSecret}
                    onChange={(event) => setAutomationForm({ ...automationForm, vercelBypassSecret: event.target.value })}
                    placeholder={selectedProject.prAutomation.bypassConfigured ? "Saved bypass unchanged" : "Optional"}
                    type="password"
                    autoComplete="off"
                  />
                </Field>
                {vercelProjectList ? (
                  <VercelProjectPicker result={vercelProjectList} onSelect={selectVercelProject} selectedProjectId={automationForm.vercelProjectId} isSelecting={isVercelSelecting} />
                ) : null}
                <ConnectionNote check={currentVercelCheck(selectedProject)} fallback={selectedProject.prAutomation.vercelConnected ? "Vercel token is saved." : "Vercel is not connected yet."} />
              </section>

              <section className="detail-panel integration-panel suite-panel">
                <div>
                  <p className="eyebrow">PR suite</p>
                  <h3>Automatic preview runs</h3>
                </div>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={automationForm.enabled}
                    onChange={(event) => setAutomationForm({ ...automationForm, enabled: event.target.checked })}
                  />
                  <span>Run Test Factory automatically for matching PR previews</span>
                </label>
                <Field label="Preview wait timeout" icon={<Clock3 size={16} aria-hidden />}>
                  <input
                    type="number"
                    min={0}
                    max={1800}
                    value={automationForm.previewWaitTimeoutSeconds}
                    onChange={(event) => setAutomationForm({ ...automationForm, previewWaitTimeoutSeconds: Number(event.target.value) })}
                  />
                </Field>
                <div className="suite-list">
                  {tests.map((test) => (
                    <label className="suite-row" key={test.id}>
                      <input
                        type="checkbox"
                        checked={automationForm.selectedTestIds.includes(test.id)}
                        onChange={() => toggleAutomationTest(test.id)}
                      />
                      <span>
                        <strong>{test.title}</strong>
                        <small>
                          {test.steps.length} step{test.steps.length === 1 ? "" : "s"}
                        </small>
                      </span>
                    </label>
                  ))}
                  {tests.length === 0 ? <div className="empty-list compact">Saved tests are optional; matching PRs can still generate draft user-flow recommendations.</div> : null}
                </div>
                <button className="primary-button wide" type="submit" disabled={isIntegrationSaving}>
                  {isIntegrationSaving ? <Loader2 className="spin" size={17} aria-hidden /> : <Save size={17} aria-hidden />}
                  Save settings
                </button>
              </section>
            </form>
          ) : (
            <div className="empty-project-detail">
              <GitPullRequest size={42} aria-hidden />
              <strong>Select a project to configure PR preview automation.</strong>
            </div>
          )}

          {message ? <div className="save-banner">{message}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <section className="pr-runs-panel" aria-label="Recent PR preview runs">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent PR previews</p>
              <h2>Automation runs</h2>
            </div>
          </div>
          <div className="pr-run-list">
            {prRuns.map((prRun) => (
              <div className="pr-run-card" key={prRun.id}>
                <div className="pr-run-row">
                  <div>
                    <strong>
                      {prRun.githubOwner}/{prRun.githubRepo}#{prRun.prNumber}
                    </strong>
                    <p>{prRun.summary || `${prRun.branch} at ${prRun.headSha.slice(0, 7)}`}</p>
                    {prRun.githubWritebackError ? <p className="pr-run-warning">{prRun.githubWritebackError}</p> : null}
                    <small>{new Date(prRun.updatedAt).toLocaleString()}</small>
                  </div>
                  <StatusPill status={prRun.status === "neutral" ? "queued" : prRun.status === "passed" ? "passed" : prRun.status === "failed" ? "failed" : "running"} />
                  <div className="pr-run-actions">
                    {prRun.previewUrl ? (
                      <a className="icon-button" href={`/api/pr-runs/${prRun.id}/open-preview`} target="_blank" rel="noreferrer" title="Open protected preview">
                        <ExternalLink size={16} aria-hidden />
                      </a>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => onRerunPrRun(prRun.id)} disabled={rerunningPrRunId === prRun.id}>
                      {rerunningPrRunId === prRun.id ? <Loader2 className="spin" size={15} aria-hidden /> : <RefreshCw size={15} aria-hidden />}
                      Rerun
                    </button>
                  </div>
                </div>
                <PrTestDraftPanel
                  prRun={prRun}
                  recommendationSet={prRecommendationSets[prRun.id] || null}
                  isGenerating={generatingPrDraftsRunId === prRun.id}
                  promotingDraftId={promotingDraftId}
                  dismissingDraftId={dismissingDraftId}
                  onGenerate={onGeneratePrDrafts}
                  onPromote={onPromotePrDraft}
                  onDismiss={onDismissPrDraft}
                />
              </div>
            ))}
            {prRuns.length === 0 ? <div className="empty-list">No PR preview automation runs yet.</div> : null}
          </div>
        </section>
      </div>
    );
  }

  if (pageRoute === "home") {
    return <PublicHomepage onLogin={navigateToLogin} />;
  }

  if (!authSession) {
    return (
      <main className="app-root auth-root">
        <div className="auth-panel">
          <Loader2 className="spin" size={20} aria-hidden />
        </div>
      </main>
    );
  }

  if (!authSession.authenticated) {
    return (
      <LoginScreen
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        isLoggingIn={isLoggingIn}
        authConfigured={authSession.configured}
        error={error}
        onLogin={onLogin}
        onEmailChange={setLoginEmail}
        onPasswordChange={setLoginPassword}
      />
    );
  }

  return (
    <main className="app-root">
      <AppTopbar
        route={route}
        selectedProject={selectedProject}
        onNavigate={navigate}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        onLogout={authSession.authEnabled ? onLogout : undefined}
      />
      {route === "projects" ? renderProjects() : route === "integrations" ? renderIntegrations() : renderDashboard()}
    </main>
  );
}

function TestFactoryMark({ label = "Test Factory logo" }: { label?: string }) {
  return (
    <div className="test-factory-mark" role="img" aria-label={label}>
      <Factory size={23} aria-hidden />
      <CheckCircle2 className="test-factory-mark-check" size={13} aria-hidden />
    </div>
  );
}

function LoginScreen({
  loginEmail,
  loginPassword,
  isLoggingIn,
  authConfigured,
  error,
  onLogin,
  onEmailChange,
  onPasswordChange
}: {
  loginEmail: string;
  loginPassword: string;
  isLoggingIn: boolean;
  authConfigured: boolean;
  error?: string;
  onLogin: (event: FormEvent) => void;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
}) {
  return (
    <main className="app-root auth-root">
      <form className="auth-panel" onSubmit={onLogin}>
        <TestFactoryMark />
        <h1>Test Factory</h1>
        <p className="auth-copy">Sign in to keep runs, credentials, screenshots, and integration settings behind the production session.</p>
        <Field label="Email" icon={<Mail size={16} aria-hidden />}>
          <input
            value={loginEmail}
            onChange={(event) => onEmailChange(event.target.value)}
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            required
            autoFocus
          />
        </Field>
        <Field label="Password" icon={<KeyRound size={16} aria-hidden />}>
          <input
            value={loginPassword}
            onChange={(event) => onPasswordChange(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <button className="primary-button" type="submit" disabled={isLoggingIn || !authConfigured}>
          {isLoggingIn ? <Loader2 className="spin" size={17} aria-hidden /> : <ShieldCheck size={17} aria-hidden />}
          Sign in
        </button>
        {!authConfigured ? <div className="error-banner">Sign-in is not configured.</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
      </form>
    </main>
  );
}

function PublicHomepage({ onLogin }: { onLogin: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <main className="public-root">
      <header className="public-nav" aria-label="Homepage">
        <div className="public-brand">
          <TestFactoryMark />
          <div>
            <strong>Test Factory</strong>
            <span>Preview QA control room</span>
          </div>
        </div>
        <a className="public-login-link" href="/login" onClick={onLogin}>
          <ShieldCheck size={16} aria-hidden />
          Login
        </a>
      </header>

      <section className="public-hero" aria-labelledby="public-hero-title">
        <div className="public-hero-copy">
          <p className="eyebrow">Private beta / preview QA</p>
          <h1 id="public-hero-title">Test Factory</h1>
          <p>
            AI-assisted smoke checks for preview deployments. Turn prompts, saved user flows, PR context, and live browser evidence into a
            repeatable signal before a release reaches production.
          </p>
          <div className="public-hero-tags" aria-label="Core capabilities">
            <span>Prompt runs</span>
            <span>Reusable checks</span>
            <span>PR previews</span>
            <span>Repair prompts</span>
          </div>
          <div className="public-hero-note" aria-label="Beta access status">
            <CheckCircle2 size={18} aria-hidden />
            <span>Protected beta while the run loop, evidence capture, and PR automation harden.</span>
          </div>
        </div>
        <PublicProductPreview />
      </section>

      <PublicManifesto />
      <PublicEvidenceEditorial />

      <section className="public-section public-summary" aria-labelledby="summary-heading">
        <div className="public-section-heading">
          <p className="eyebrow">Executive summary</p>
          <h2 id="summary-heading">A browser QA operator for teams shipping through previews.</h2>
        </div>
        <div className="public-summary-copy">
          <p>
            Test Factory launches read-only browser runs against deployment URLs, captures what happened, and returns structured pass/fail
            output that a builder can act on immediately.
          </p>
          <p>
            Today it supports ad hoc smoke prompts, saved projects, reusable test steps, GitHub App PR automation, Vercel preview resolution,
            screenshot evidence, live logs, and fix-it prompts generated from failure context.
          </p>
        </div>
      </section>

      <section className="public-section public-feature-band" aria-label="What Test Factory does">
        <FeatureCard
          icon={<Play size={19} aria-hidden />}
          label="Run"
          title="Launch smoke checks from plain language"
          body="Describe the user flow, provide a preview URL and optional runtime credentials, then watch the browser agent step through the surface."
        />
        <FeatureCard
          icon={<ListChecks size={19} aria-hidden />}
          label="Reuse"
          title="Save project-specific checks"
          body="Turn important flows into structured steps so the same release path can be rerun without replanning from scratch."
        />
        <FeatureCard
          icon={<GitPullRequest size={19} aria-hidden />}
          label="Automate"
          title="Attach checks to PR previews"
          body="Use GitHub and Vercel integrations to find the right preview deployment, run selected checks, and write the result back to the pull request."
        />
        <FeatureCard
          icon={<Wand2 size={19} aria-hidden />}
          label="Repair"
          title="Convert failures into fix prompts"
          body="Package redacted failure evidence, relevant repo context, and the failed run summary into a prompt for the implementation agent."
        />
      </section>

      <section className="public-section public-workflow" aria-labelledby="workflow-heading">
        <div className="public-section-heading">
          <p className="eyebrow">Run loop</p>
          <h2 id="workflow-heading">From preview URL to release signal.</h2>
        </div>
        <ol>
          <li>
            <strong>Target the preview.</strong>
            <span>Use a deployment URL directly or let PR automation resolve the matching Vercel preview.</span>
          </li>
          <li>
            <strong>Exercise the flow.</strong>
            <span>Claude plans and selects browser actions for ad hoc runs; saved checks execute their persisted steps.</span>
          </li>
          <li>
            <strong>Capture evidence.</strong>
            <span>Test Factory records screenshots, event logs, step status, reports, and warnings without saving passwords.</span>
          </li>
          <li>
            <strong>Close the loop.</strong>
            <span>Passed runs become confidence; failed runs produce focused repair prompts and PR-visible status.</span>
          </li>
        </ol>
      </section>

      <section className="public-section public-integration-grid" aria-label="Integrations and safeguards">
        <IntegrationCard icon={<Github size={19} aria-hidden />} title="GitHub App" body="Checks, comments, PR context, installation mapping, and app-only draft tests." />
        <IntegrationCard icon={<Globe2 size={19} aria-hidden />} title="Vercel previews" body="Preview discovery by commit and branch, with optional deployment-protection bypass handling." />
        <IntegrationCard icon={<Bot size={19} aria-hidden />} title="Claude + browser agent" body="Prompt planning, action selection, test draft generation, and failure repair briefing." />
        <IntegrationCard icon={<ShieldCheck size={19} aria-hidden />} title="Protected data" body="Production auth, CSRF checks, encrypted integration secrets, and redacted run persistence." />
      </section>
      <PublicFooter />
    </main>
  );
}

function PublicManifesto() {
  return (
    <section className="public-manifesto" aria-labelledby="manifesto-heading">
      <div className="manifesto-meta">
        <span>Preview deployments</span>
        <span>Browser evidence</span>
        <span>PR writeback</span>
      </div>
      <div className="manifesto-copy">
        <p className="eyebrow">Operating thesis</p>
        <h2 id="manifesto-heading">Ship decisions should come from evidence, not optimism.</h2>
        <p>
          Test Factory turns a preview URL into a readable release receipt: what the browser did, what changed, what failed,
          and what an implementation agent needs next.
        </p>
      </div>
    </section>
  );
}

function PublicEvidenceEditorial() {
  return (
    <section className="public-section public-evidence-editorial" aria-labelledby="evidence-heading">
      <div className="evidence-intro">
        <p className="eyebrow">Evidence board</p>
        <h2 id="evidence-heading">A product proof collage for every preview.</h2>
      </div>
      <div className="evidence-collage">
        <figure className="evidence-image-card">
          <img src="/assets/testfactory-live-home-evidence.png" alt="Captured Test Factory homepage and report preview" />
          <figcaption>
            <span>Live capture</span>
            <strong>Production surface, captured after deploy.</strong>
          </figcaption>
        </figure>
        <article className="evidence-type-card evidence-type-card-dark">
          <span>Report receipt</span>
          <strong>Run 042 flagged the checkout payment CTA.</strong>
          <p>Selector, screenshot, route, and event log are preserved as one reviewable artifact.</p>
        </article>
        <article className="evidence-type-card evidence-type-card-clay">
          <span>Repair prompt</span>
          <strong>Failure context packaged for the implementation pass.</strong>
        </article>
        <article className="evidence-type-card evidence-type-card-paper">
          <span>PR signal</span>
          <strong>GitHub check posted. Sticky comment updated. Preview evidence attached.</strong>
        </article>
      </div>
    </section>
  );
}

const publicPreviewTabs: Array<{ id: PublicPreviewTab; label: string }> = [
  { id: "run", label: "Run 042" },
  { id: "report", label: "Report" },
  { id: "logs", label: "Logs" }
];

function PublicProductPreview() {
  const [activeTab, setActiveTab] = useState<PublicPreviewTab>("run");
  const activePanelId = `public-preview-panel-${activeTab}`;

  return (
    <aside className="public-product-preview" aria-label="Test Factory product preview">
      <div className="preview-tabs" role="tablist" aria-label="Preview content">
        {publicPreviewTabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={selected ? "active" : undefined}
              role="tab"
              id={`public-preview-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`public-preview-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id={activePanelId}
        className={`preview-report-card preview-${activeTab}-panel`}
        role="tabpanel"
        aria-labelledby={`public-preview-tab-${activeTab}`}
      >
        {activeTab === "run" ? <PreviewRunPanel /> : null}
        {activeTab === "report" ? <PreviewReportPanel /> : null}
        {activeTab === "logs" ? <PreviewLogsPanel /> : null}
      </div>
    </aside>
  );
}

function PreviewRunPanel() {
  return (
    <>
      <div className="preview-report-header">
        <span>PROJECT 02 / SMOKE TEST</span>
        <strong>Smoke Test - Checkout</strong>
        <em>FAILED</em>
      </div>
      <div className="preview-metrics" aria-label="Example run metrics">
        <div>
          <strong>87</strong>
          <span>Passed</span>
        </div>
        <div>
          <strong>3</strong>
          <span>Failed</span>
        </div>
        <div>
          <strong>5</strong>
          <span>Warnings</span>
        </div>
        <div>
          <strong>95</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="preview-evidence-grid">
        <div className="preview-evidence-card">
          <span>Browser evidence</span>
          <strong>Checkout payment step</strong>
          <p>Element mismatch captured with screenshot, route, selector, and event log.</p>
        </div>
        <div className="preview-evidence-card">
          <span>Repair brief</span>
          <strong>Ready for implementation agent</strong>
          <p>Failure context, redacted credentials, and run summary packaged into a focused fix prompt.</p>
        </div>
      </div>
      <div className="preview-log-panel" aria-label="Example run log">
        <div>
          <TerminalSquare size={15} aria-hidden />
          <span>run-log.txt</span>
        </div>
        <p><span className="log-pass">PASS</span> Auth smoke passed</p>
        <p><span className="log-warn">WARN</span> Pricing card shifted 4%</p>
        <p><span className="log-fail">FAIL</span> Payment button missing expected label</p>
      </div>
    </>
  );
}

function PreviewReportPanel() {
  return (
    <>
      <div className="preview-report-header">
        <span>RELEASE READINESS / CHECKOUT</span>
        <strong>Report Needs Review</strong>
        <em className="preview-status-warn">ACTION NEEDED</em>
      </div>
      <div className="preview-report-summary" aria-label="Release readiness summary">
        <div>
          <span>Result</span>
          <strong>Blocked</strong>
          <p>Payment CTA mismatch is still visible on the preview route.</p>
        </div>
        <div>
          <span>PR writeback</span>
          <strong>Posted</strong>
          <p>GitHub check, sticky comment, and repair prompt are ready for review.</p>
        </div>
      </div>
      <div className="preview-table" aria-label="Failed test rows">
        <div className="preview-table-row preview-table-head">
          <span>Check</span>
          <span>Status</span>
          <span>Evidence</span>
        </div>
        <div className="preview-table-row">
          <span>/checkout/payment</span>
          <strong>FAILED</strong>
          <span>selector + screenshot</span>
        </div>
        <div className="preview-table-row">
          <span>/checkout/summary</span>
          <strong>WARN</strong>
          <span>visual shift 4%</span>
        </div>
      </div>
      <div className="preview-artifact-strip" aria-label="Report artifacts">
        <span>report.html</span>
        <span>screenshots.zip</span>
        <span>repair-prompt.md</span>
      </div>
      <div className="preview-stamp">Do not ship until checkout CTA is confirmed.</div>
    </>
  );
}

function PreviewLogsPanel() {
  return (
    <>
      <div className="preview-report-header">
        <span>RUN 042 / BROWSER AGENT</span>
        <strong>Terminal Receipt</strong>
        <em>FAILED</em>
      </div>
      <div className="preview-log-panel preview-log-panel-expanded" aria-label="Agent execution log">
        <div>
          <TerminalSquare size={15} aria-hidden />
          <span>agent-run.log</span>
        </div>
        <p><span className="log-time">10:24:01</span> Opened Vercel preview for branch checkout-fix.</p>
        <p><span className="log-pass">PASS</span> Auth smoke passed with saved credentials.</p>
        <p><span className="log-pass">PASS</span> Cart summary rendered with expected total.</p>
        <p><span className="log-warn">WARN</span> Pricing card shifted 4% against baseline.</p>
        <p><span className="log-fail">FAIL</span> Payment button missing expected label.</p>
        <p><span className="log-time">10:25:18</span> GitHub check updated and repair brief generated.</p>
      </div>
      <div className="preview-log-meta" aria-label="Log environment metadata">
        <span>Chrome 126</span>
        <span>Desktop</span>
        <span>Vercel preview</span>
        <span>Claude browser agent</span>
      </div>
    </>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer" aria-label="Homepage footer">
      <div className="public-footer-brand">
        <TestFactoryMark label="Test Factory footer logo" />
        <div>
          <strong>Test Factory</strong>
          <span>Private beta QA signal for preview deployments.</span>
        </div>
      </div>
      <div className="public-footer-grid">
        <div>
          <span className="eyebrow">Build state</span>
          <p>Private beta. Sign-in access only while smoke runs, saved checks, PR automation, and report handoff mature.</p>
        </div>
        <div>
          <span className="eyebrow">Capabilities</span>
          <p>Prompt runs, reusable checks, screenshots, logs, visual warnings, reports, and repair prompts.</p>
        </div>
        <div>
          <span className="eyebrow">Integrations</span>
          <p>GitHub App, Vercel previews, Claude browser agent, encrypted project secrets, and PR-visible status.</p>
        </div>
        <div>
          <span className="eyebrow">Security posture</span>
          <p>Sign-in, CSRF checks, redacted run persistence, and no public access to stored credentials.</p>
        </div>
      </div>
      <div className="public-footer-bottom">
        <span>(c) 2026 Test Factory</span>
        <span>Contact details pending.</span>
      </div>
    </footer>
  );
}

function FeatureCard({ icon, label, title, body }: { icon: ReactNode; label: string; title: string; body: string }) {
  return (
    <article className="public-feature-card">
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function IntegrationCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <article className="public-integration-card">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function AppTopbar({
  route,
  selectedProject,
  onNavigate,
  themePreference,
  onThemeChange,
  onLogout
}: {
  route: AppRoute;
  selectedProject?: Project;
  onNavigate: (route: AppRoute) => void;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLogout?: () => void;
}) {
  return (
    <header className="app-topbar">
      <div className="topbar-brand">
        <TestFactoryMark />
        <div>
          <h1>Test Factory</h1>
          <p>Preview QA control room</p>
        </div>
      </div>

      <div className="topbar-project" aria-label="Current project">
        <FolderOpen size={18} aria-hidden />
        <div>
          <span>Project</span>
          <strong>{selectedProject ? selectedProject.name : "No project selected"}</strong>
          <p>{selectedProject ? selectedProject.deploymentUrl : "Ad hoc run only"}</p>
        </div>
      </div>

      <nav className="topbar-actions" aria-label="Primary">
        <button type="button" className={route === "dashboard" ? "nav-button active" : "nav-button"} onClick={() => onNavigate("dashboard")}>
          <LayoutDashboard size={16} aria-hidden />
          Dashboard
        </button>
        <button type="button" className={route === "projects" ? "nav-button active" : "nav-button"} onClick={() => onNavigate("projects")}>
          <FolderOpen size={16} aria-hidden />
          Runs
        </button>
        <button type="button" className="nav-button nav-button-disabled" disabled title="Visual diff workspace coming from run artifacts">
          <Eye size={16} aria-hidden />
          Visuals
        </button>
        <button type="button" className="nav-button nav-button-disabled" disabled title="Report archive coming from completed smoke runs">
          <TerminalSquare size={16} aria-hidden />
          Reports
        </button>
        <button
          type="button"
          className={route === "integrations" ? "nav-button active" : "nav-button"}
          onClick={() => onNavigate("integrations")}
        >
          <GitPullRequest size={16} aria-hidden />
          Settings
        </button>
        <ThemeToggle value={themePreference} onChange={onThemeChange} />
        {onLogout ? (
          <button type="button" className="nav-button" onClick={onLogout}>
            <ShieldCheck size={16} aria-hidden />
            Sign out
          </button>
        ) : null}
      </nav>
    </header>
  );
}

function RunWorkspace({
  run,
  orderedEvents,
  latestImage,
  browserCaption,
  copiedPromptRunId,
  onCopyFixPrompt
}: {
  run?: PublicQaRun;
  orderedEvents: QaEvent[];
  latestImage?: string;
  browserCaption: string;
  copiedPromptRunId: string;
  onCopyFixPrompt: (text: string) => Promise<void>;
}) {
  const passedSteps = run?.steps.filter((step) => step.status === "passed").length || 0;
  const failedSteps = run?.steps.filter((step) => step.status === "failed").length || 0;
  const warningCount = orderedEvents.filter((event) => event.level === "warning").length;
  const screenshotCount = Math.max(orderedEvents.filter((event) => event.screenshot).length, latestImage ? 1 : 0);
  const runMeta = run ? `${run.request.agentMode} / ${run.request.maxActions} max actions` : "Awaiting deployment";

  return (
    <section className="workspace" aria-label="Run results">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Latest run</p>
          <h2>{run ? statusCopy(run.status) : "READY"}</h2>
          {run?.request.testTitle ? <p className="run-subtitle">{run.request.testTitle}</p> : null}
        </div>
        {run ? <StatusPill status={run.status} /> : null}
      </header>

      <div className="run-metric-grid" aria-label="Run health">
        <MetricCard label="Latest run" value={run ? statusCopy(run.status) : "READY"} meta={runMeta} tone={run?.status || "queued"} />
        <MetricCard label="Passed" value={String(passedSteps)} meta={`${run?.steps.length || 0} total steps`} tone="passed" />
        <MetricCard label="Failures" value={String(failedSteps)} meta={failedSteps ? "Needs repair prompt" : "No failed steps"} tone={failedSteps ? "failed" : "passed"} />
        <MetricCard label="Visuals" value={String(screenshotCount)} meta={screenshotCount === 1 ? "Screenshot captured" : "Screenshots captured"} tone={screenshotCount ? "running" : "queued"} />
        <MetricCard label="Warnings" value={String(warningCount)} meta={warningCount ? "Review agent log" : "No warnings"} tone={warningCount ? "warning" : "passed"} />
      </div>

      <div className="browser-and-steps">
        <div className="browser-panel">
          <div className="browser-bar">
            <span />
            <span />
            <span />
            <p>{run?.request.deploymentUrl || "No deployment selected"}</p>
            {run?.request.deploymentUrl ? (
              <a href={run.request.deploymentUrl} target="_blank" rel="noreferrer" title="Open deployment">
                <ExternalLink size={16} aria-hidden />
              </a>
            ) : null}
          </div>
          <div className="browser-viewport">
            {latestImage ? (
              <>
                <img src={latestImage} alt="Latest browser screenshot" />
                <div className="browser-caption">{browserCaption}</div>
              </>
            ) : (
              <div className="empty-viewport">
                <Bot size={42} aria-hidden />
                <span>Awaiting run</span>
              </div>
            )}
          </div>
        </div>

        <div className="steps-panel">
          <h3>Steps</h3>
          <div className="step-list">
            {(run?.steps || []).map((step) => (
              <div className={`step-row ${step.status}`} key={step.id}>
                {stepIcon(step.status)}
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
            {!run ? <div className="empty-list">No steps generated yet.</div> : null}
          </div>
        </div>
      </div>

      <div className="lower-grid">
        <div className="report-panel">
          <h3>Result</h3>
          {run?.report ? (
            <div className={`report ${run.report.outcome}`}>
              <strong>{run.report.summary}</strong>
              {run.report.errors.length > 0 ? (
                <ul>
                  {run.report.errors.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {run.report.repairBrief ? <p>{run.report.repairBrief}</p> : null}
              {run.report.fixPrompt ? (
                <div className="fix-prompt-block">
                  <div className="fix-prompt-header">
                    <div>
                      <span>Fix-it prompt</span>
                      <p>{fixPromptSourceCopy(run.report.fixPrompt.source, run.report.fixPrompt.model)}</p>
                    </div>
                    <div className="fix-prompt-actions">
                      {run.report.fixPrompt.repoUrl ? (
                        <a href={run.report.fixPrompt.repoUrl} target="_blank" rel="noreferrer" title="Open repository">
                          <ExternalLink size={15} aria-hidden />
                        </a>
                      ) : null}
                      <button type="button" className="secondary-button" onClick={() => onCopyFixPrompt(run.report?.fixPrompt?.text || "")}>
                        {copiedPromptRunId === run.id ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                        {copiedPromptRunId === run.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <textarea aria-label="Fix-it prompt" readOnly value={run.report.fixPrompt.text} rows={12} />
                  {run.report.fixPrompt.warnings.length > 0 ? (
                    <p className="fix-prompt-warning">{run.report.fixPrompt.warnings.join(" ")}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-list">Pass/fail output appears when the run completes.</div>
          )}
        </div>

        <div className="log-panel">
          <h3>Agent log</h3>
          <div className="event-list">
            {orderedEvents.length > 0 ? (
              orderedEvents.map((event) => <EventRow event={event} key={event.id} />)
            ) : (
              <div className="empty-list">No events streamed yet.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <label className="field-block">
      <span className="field-label">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryItem({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  meta,
  tone
}: {
  label: string;
  value: string;
  meta: string;
  tone: PublicQaRun["status"] | "warning";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{meta}</p>
    </article>
  );
}

function IntegrationStatusItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={ok ? "integration-status-item ok" : "integration-status-item"}>
      {ok ? <CheckCircle2 size={17} aria-hidden /> : <Circle size={17} aria-hidden />}
      <span>{label}</span>
    </div>
  );
}

function ConnectionNote({ check, fallback }: { check?: { ok: boolean; message: string; at: string; details?: string[] }; fallback: string }) {
  return (
    <div className={check?.ok ? "connection-note ok" : "connection-note"}>
      <p>{check ? `${check.message} ${new Date(check.at).toLocaleString()}` : fallback}</p>
      {check?.details?.length ? (
        <ul>
          {check.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VercelProjectPicker({
  result,
  onSelect,
  selectedProjectId,
  isSelecting
}: {
  result: VercelProjectListResult;
  onSelect: (project: VercelProjectSummary) => void | Promise<void>;
  selectedProjectId: string;
  isSelecting: boolean;
}) {
  return (
    <div className="vercel-project-picker" aria-label="Vercel projects">
      <div className="picker-heading">
        <strong>{result.message}</strong>
        <span>{result.projects.length} shown</span>
      </div>
      {result.projects.length ? (
        <div className="vercel-project-list">
          {result.projects.map((project) => (
            <button
              type="button"
              className={project.id === selectedProjectId ? "vercel-project-row selected" : "vercel-project-row"}
              key={project.id}
              onClick={() => onSelect(project)}
              disabled={isSelecting}
            >
              <span>
                <strong>{project.name}</strong>
                <small>{project.productionUrl || project.repoUrl || project.teamSlug || "No linked GitHub repo reported"}</small>
              </span>
              <code>{project.id}</code>
              <span className="project-pill-list">
                {project.source === "cli" ? <span className="match-pill">CLI</span> : null}
                {project.teamSlug ? <span className="match-pill">{project.teamSlug}</span> : null}
                {project.matchedRepo ? <span className="match-pill">Repo match</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-list compact">No Vercel projects were returned for this token and team scope.</div>
      )}
      {result.diagnostics.length ? (
        <details>
          <summary>Discovery diagnostics</summary>
          <ul>
            {result.diagnostics.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PrTestDraftPanel({
  prRun,
  recommendationSet,
  isGenerating,
  promotingDraftId,
  dismissingDraftId,
  onGenerate,
  onPromote,
  onDismiss
}: {
  prRun: PrAutomationRun;
  recommendationSet: PrTestRecommendationSet | null;
  isGenerating: boolean;
  promotingDraftId: string;
  dismissingDraftId: string;
  onGenerate: (prRunId: string) => void | Promise<void>;
  onPromote: (draft: PrTestDraft) => void | Promise<void>;
  onDismiss: (draft: PrTestDraft) => void | Promise<void>;
}) {
  const visibleDrafts = (recommendationSet?.drafts || []).filter((draft) => draft.status !== "dismissed");
  const busy = isGenerating || recommendationSet?.status === "generating" || prRun.recommendationStatus === "generating";
  const hasDrafts = visibleDrafts.length > 0;
  const generateLabel = recommendationSet ? "Regenerate drafts" : "Generate drafts";

  return (
    <div className="pr-draft-panel" aria-label={`PR #${prRun.prNumber} suggested user-flow tests`}>
      <div className="pr-draft-heading">
        <div>
          <strong>Suggested user-flow tests</strong>
          <p>
            {recommendationSet
              ? recommendationSet.summary
              : "No PR-aware draft tests have been generated for this run yet."}
          </p>
        </div>
        <div className="pr-draft-heading-actions">
          {recommendationSet ? <span className={`draft-state ${recommendationSet.status}`}>{draftStatusCopy(recommendationSet.status)}</span> : null}
          <button type="button" className="secondary-button" onClick={() => onGenerate(prRun.id)} disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} aria-hidden /> : <Wand2 size={15} aria-hidden />}
            {busy ? "Generating" : generateLabel}
          </button>
        </div>
      </div>

      {recommendationSet?.error ? <div className="draft-error">{recommendationSet.error}</div> : null}

      {hasDrafts ? (
        <div className="pr-draft-list">
          {visibleDrafts.map((draft) => (
            <article className="pr-draft-row" key={draft.id}>
              <div className="pr-draft-body">
                <div className="pr-draft-title-row">
                  <strong>{draft.title}</strong>
                  <span className="draft-badge-list">
                    <span className={`draft-badge priority-${draft.priority}`}>{priorityLabel(draft.priority)}</span>
                    {isDraftManual(draft) ? <span className="draft-badge manual">Manual</span> : <span className="draft-badge runnable">Runnable</span>}
                    {draftAccessTags(draft).map((tag) => (
                      <span className={`draft-badge access-${tag}`} key={tag}>
                        {accessTagLabel(tag)}
                      </span>
                    ))}
                    {draft.status === "promoted" ? <span className="draft-badge promoted">Saved</span> : null}
                  </span>
                </div>
                <p>{draft.rationale}</p>
                {isDraftManual(draft) && draft.manualReason ? <small>{draft.manualReason}</small> : null}
                {draft.impactedFiles.length ? (
                  <div className="draft-file-list" aria-label="Impacted files">
                    {draft.impactedFiles.slice(0, 6).map((file) => (
                      <code key={file}>{file}</code>
                    ))}
                  </div>
                ) : null}
                <details className="draft-steps">
                  <summary>
                    {draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}
                  </summary>
                  <ol>
                    {draft.steps.map((step) => (
                      <li key={step.id}>
                        <strong>{step.title}</strong>
                        <span>{step.detail}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
              <div className="pr-draft-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onPromote(draft)}
                  disabled={draft.status === "promoted" || promotingDraftId === draft.id}
                >
                  {promotingDraftId === draft.id ? <Loader2 className="spin" size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
                  Save test
                </button>
                <button
                  type="button"
                  className="icon-danger-button"
                  onClick={() => onDismiss(draft)}
                  disabled={draft.status === "promoted" || dismissingDraftId === draft.id}
                  title="Dismiss draft"
                >
                  {dismissingDraftId === draft.id ? <Loader2 className="spin" size={15} aria-hidden /> : <Trash2 size={15} aria-hidden />}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-list compact">
          {busy ? "Generating PR-aware draft tests." : "No actionable draft tests for this PR run."}
        </div>
      )}
    </div>
  );
}

function GitHubSetupNote({ status }: { status?: IntegrationStatus }) {
  if (!status) return null;
  const missing = githubMissingConfigLabels(status);
  const shouldRender = missing.length > 0 || !status.githubAppConfigured || !status.githubInstallFlowConfigured;
  if (!shouldRender) return null;

  return (
    <div className="setup-note" role="note">
      <strong>GitHub setup is incomplete.</strong>
      <p>
        Use Create GitHub App to sign in with GitHub and register the app. Generated app credentials are stored encrypted.
      </p>
      {missing.length > 0 ? (
        <div className="env-chip-list" aria-label="Missing GitHub configuration">
          {missing.map((label) => (
            <code className="env-chip" key={label}>
              {label}
            </code>
          ))}
        </div>
      ) : null}
      {!status.publicUrlConfigured ? (
        <p>
          Live PR webhooks need <code>QA_SMOKE_PUBLIC_URL</code>. Local setup can still create and install the app.
        </p>
      ) : null}
      <div className="setup-link-row">
        {status.githubSetupUrl ? (
          <a href={status.githubSetupUrl} target="_blank" rel="noreferrer">
            Setup URL <ExternalLink size={13} aria-hidden />
          </a>
        ) : null}
        {status.githubWebhookUrl ? (
          <a href={status.githubWebhookUrl} target="_blank" rel="noreferrer">
            Webhook URL <ExternalLink size={13} aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ModeToggle({ value, onChange, label }: { value: AgentMode; onChange: (value: AgentMode) => void; label: string }) {
  return (
    <div className="field-block">
      <span className="field-label">
        <Eye size={16} aria-hidden />
        {label}
      </span>
      <div className="segmented" role="group" aria-label={label}>
        <button type="button" className={value === "browser" ? "active" : ""} onClick={() => onChange("browser")}>
          <Eye size={15} aria-hidden />
          Browser
        </button>
        <button type="button" className={value === "demo" ? "active" : ""} onClick={() => onChange("demo")}>
          <Clock3 size={15} aria-hidden />
          Demo
        </button>
      </div>
    </div>
  );
}

function ThemeToggle({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return (
    <div className="theme-row">
      <span className="field-label">
        <Sun size={16} aria-hidden />
        Theme
      </span>
      <div className="segmented segmented-three" role="group" aria-label="Theme">
        {themeOptions.map((option) => (
          <button type="button" className={value === option ? "active" : ""} onClick={() => onChange(option)} key={option}>
            {themeIcon(option)}
            {themeLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: QaEvent }) {
  return (
    <div className={`event-row ${event.level}`}>
      <span>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <p>{event.message}</p>
    </div>
  );
}

function StatusPill({ status }: { status: PublicQaRun["status"] }) {
  return <span className={`status-pill ${status}`}>{statusCopy(status)}</span>;
}

function statusCopy(status: PublicQaRun["status"]) {
  if (status === "passed") return "PASSED";
  if (status === "failed") return "FAILED";
  if (status === "running") return "RUNNING";
  return "QUEUED";
}

function draftStatusCopy(status: PrTestRecommendationSet["status"]): string {
  if (status === "generating") return "Generating";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  return "Superseded";
}

function priorityLabel(priority: PrTestDraft["priority"]): string {
  if (priority === "critical") return "Critical";
  if (priority === "high") return "High";
  if (priority === "low") return "Low";
  return "Medium";
}

function isDraftManual(draft: PrTestDraft): boolean {
  if (draft.runnable) return false;
  return !isAccessOnlyManualReason(draft.manualReason);
}

function draftAccessTags(draft: PrTestDraft): NonNullable<PrTestDraft["accessTags"]> {
  const explicitTags = draft.accessTags || [];
  if (explicitTags.length > 0) return explicitTags;
  return inferAccessTags(`${draft.title} ${draft.rationale} ${draft.manualReason || ""} ${draft.steps.map((step) => `${step.title} ${step.detail}`).join(" ")}`);
}

function inferAccessTags(text: string): NonNullable<PrTestDraft["accessTags"]> {
  const tags: NonNullable<PrTestDraft["accessTags"]> = [];
  if (/\b(?:log ?in|sign ?in|authenticate|session)\b/i.test(text)) tags.push("auth");
  if (/\bcredentials?\b/i.test(text)) tags.push("credentials");
  if (/\b(?:admin|permission|role|privileged)\b/i.test(text)) tags.push("privileged");
  if (/\b(?:billing|invoice)\b/i.test(text)) tags.push("billing");
  if (/\bpayments?\b/i.test(text)) tags.push("payment");
  return [...new Set(tags)];
}

function isAccessOnlyManualReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /\b(?:auth|log ?in|sign ?in|credential|admin|permission|role|privileged|billing|payment)\b/i.test(reason);
}

function accessTagLabel(tag: NonNullable<PrTestDraft["accessTags"]>[number]): string {
  if (tag === "auth") return "Auth";
  if (tag === "credentials") return "Credentials";
  if (tag === "privileged") return "Privileged";
  if (tag === "billing") return "Billing";
  return "Payment";
}

function modeCopy(mode: AgentMode): string {
  return mode === "browser" ? "Browser" : "Demo";
}

function fixPromptSourceCopy(source: "claude" | "fallback", model?: string) {
  if (source === "claude") return `Generated by Claude${model ? ` (${model})` : ""}.`;
  return "Generated from local failure evidence.";
}

function stepIcon(status: StepStatus) {
  if (status === "passed") return <CheckCircle2 size={18} aria-hidden />;
  if (status === "failed") return <XCircle size={18} aria-hidden />;
  if (status === "running") return <Loader2 className="spin" size={18} aria-hidden />;
  return <Circle size={18} aria-hidden />;
}

function mergeEvents(events: QaEvent[], next: QaEvent) {
  if (events.some((event) => event.id === next.id)) return events;
  return [...events, next];
}

function routeFromLocation(pathname: string = window.location.pathname): AppRoute {
  if (pathname.startsWith("/app/settings") || pathname.startsWith("/integrations")) return "integrations";
  if (pathname.startsWith("/app/runs") || pathname.startsWith("/projects")) return "projects";
  return "dashboard";
}

function pageRouteFromLocation(pathname: string = window.location.pathname): PageRoute {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/login")) return "login";
  return "app";
}

function appPathForRoute(route: AppRoute): string {
  if (route === "projects") return "/app/runs";
  if (route === "integrations") return "/app/settings";
  return "/app";
}

function loadThemePreference(storage: Storage = window.localStorage): ThemePreference {
  const stored = storage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
}

function loadSelectedProjectId(storage: Storage = window.localStorage): string {
  const fromUrl = new URLSearchParams(window.location.search).get("projectId");
  if (fromUrl) return fromUrl;
  return storage.getItem(selectedProjectStorageKey) || "";
}

function saveSelectedProjectId(projectId: string, storage: Storage = window.localStorage): void {
  if (projectId) {
    storage.setItem(selectedProjectStorageKey, projectId);
    return;
  }
  storage.removeItem(selectedProjectStorageKey);
}

function applyThemePreference(preference: ThemePreference): () => void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const apply = () => {
    const resolved = preference === "system" && media?.matches ? "dark" : preference === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
  };

  window.localStorage.setItem(themeStorageKey, preference);
  apply();

  if (preference !== "system" || !media) return () => undefined;
  media.addEventListener?.("change", apply);
  return () => media.removeEventListener?.("change", apply);
}

function themeIcon(theme: ThemePreference) {
  if (theme === "light") return <Sun size={15} aria-hidden />;
  if (theme === "dark") return <Moon size={15} aria-hidden />;
  return <Monitor size={15} aria-hidden />;
}

function themeLabel(theme: ThemePreference): string {
  if (theme === "light") return "Light";
  if (theme === "dark") return "Dark";
  return "System";
}

function githubSetupErrorCopy(code: string): string {
  if (code === "missing_installation") return "GitHub did not return an installation ID.";
  if (code === "expired_login") return "GitHub login expired. Start the connection again from this page.";
  if (code === "project_not_found") return "The project for this GitHub connection no longer exists.";
  if (code === "setup_unmatched") return "GitHub returned an installation, but Test Factory could not match it to exactly one configured project. Check the repository mapping and press Sync.";
  if (code === "manifest_missing_code") return "GitHub did not return a manifest setup code.";
  if (code === "manifest_conversion") return "GitHub App registration did not complete.";
  return "GitHub connection did not complete.";
}

function githubMissingConfigLabels(status: IntegrationStatus): string[] {
  const missing = status.githubMissingConfig;
  if (!missing) return [];
  return [
    missing.appId ? "GITHUB_APP_ID" : "",
    missing.privateKey ? "GITHUB_APP_PRIVATE_KEY" : "",
    missing.webhookSecret ? "GITHUB_WEBHOOK_SECRET" : "",
    missing.installUrl ? "GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL" : "",
    missing.publicUrl ? "QA_SMOKE_PUBLIC_URL" : ""
  ].filter(Boolean);
}

function projectFormFromProject(project: Project): ProjectFormState {
  return {
    name: project.name,
    deploymentUrl: project.deploymentUrl,
    githubRepo: project.githubRepo,
    defaultAgentMode: project.defaultAgentMode,
    defaultMaxActions: project.defaultMaxActions
  };
}

function automationFormFromProject(project: Project): PrAutomationFormState {
  return {
    ...automationFormFromConfig(project.prAutomation),
    vercelApiToken: "",
    vercelBypassSecret: ""
  };
}

function automationFormFromConfig(config: Project["prAutomation"]): Omit<PrAutomationFormState, "vercelApiToken" | "vercelBypassSecret"> {
  return {
    enabled: config.enabled,
    githubOwner: config.githubOwner,
    githubRepo: config.githubRepo,
    githubInstallationId: config.githubInstallationId,
    selectedTestIds: [...config.selectedTestIds],
    previewWaitTimeoutSeconds: config.previewWaitTimeoutSeconds,
    vercelProjectId: config.vercelProjectId,
    vercelProjectName: config.vercelProjectName,
    vercelTeamId: config.vercelTeamId,
    vercelTeamSlug: config.vercelTeamSlug
  };
}

function currentVercelCheck(project: Project): Project["prAutomation"]["lastVercelVerification"] {
  const check = project.prAutomation.lastVercelVerification;
  if (!check || check.ok || !project.prAutomation.vercelConnected) return check;
  const updatedAt = Date.parse(project.updatedAt);
  const checkedAt = Date.parse(check.at);
  if (Number.isFinite(updatedAt) && Number.isFinite(checkedAt) && updatedAt - checkedAt > 1000) return undefined;
  return check;
}

function testFormFromTest(test: TestDefinition): TestEditorState {
  return {
    title: test.title,
    description: test.description,
    sourcePrompt: test.sourcePrompt || defaultPrompt,
    steps: test.steps.map((step) => ({ ...step }))
  };
}

function newStep(type: ReusableStepType = "act"): ReusableTestStep {
  return {
    id: `client-step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title: "",
    detail: ""
  };
}

function stepTypeLabel(type: ReusableStepType): string {
  if (type === "act") return "Act";
  if (type === "assert") return "Assert";
  if (type === "login") return "Login";
  return "Screenshot";
}

function conciseTitle(prompt: string): string {
  const clean = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:goal|surface|role|steps?|expected):\s*/i, "").trim())
    .find((line) => line.length > 6);
  if (!clean) return "Reusable smoke test";
  return clean.length <= 64 ? clean : `${clean.slice(0, 61).trim()}...`;
}
