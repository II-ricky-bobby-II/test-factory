# Architecture

## Runtime Shape

Test Factory is a Vite React application backed by an Express API. Local development runs the same Express app with `tsx`; production deploys it through `api/index.ts` as a Vercel serverless function.

`vercel.json` routes `/api/:path*` to the serverless function and all remaining paths to `dist/index.html`. Asset responses receive long-lived cache headers, while application responses receive conservative security headers.

## Components

- React UI: dashboard, project/test editor, and GitHub/Vercel integrations views.
- Express API: auth, health, project/test CRUD, run lifecycle, SSE events, screenshot serving, GitHub setup/webhook intake, PR automation, and PR test-draft actions.
- Auth service: owner password verification, signed session cookie issuance, protected API middleware, and CSRF confirmation for unsafe methods.
- Project store: durable project, reusable test, PR automation, and PR recommendation definitions.
- Secret store: encrypted integration-secret storage for Vercel API tokens and deployment-protection bypass secrets.
- Run store: active run state plus optional private Blob persistence for hosted run snapshots and screenshots.
- PR automation coordinator: maps GitHub webhooks to projects, resolves Vercel previews, runs selected saved tests, generates PR-aware draft tests, and writes GitHub checks/comments.
- GitHub App client: Octokit-backed installation-token operations for setup, repository sync, PR context fetching, checks, and comments.
- Vercel client: REST and CLI-backed project lookup plus preview deployment resolution.
- Browser agent: local Playwright in development, `playwright-core` plus `@sparticuz/chromium` on Vercel.
- Step planner and repair prompt generator: Claude-backed planning, action selection, draft generation, and failure analysis with deterministic fallbacks where possible.

## Data Boundaries

Run credentials are accepted only in run creation payloads. Public run responses replace credentials with `hasCredentials`. Passwords are not persisted in browser profiles, projects, reusable tests, logs, reports, GitHub comments, or repair prompts.

Project, reusable test, PR automation, and PR recommendation definitions are stored in `.qa-smoke/data.json` locally. On Vercel, `TEST_FACTORY_STORAGE=blob` with `BLOB_READ_WRITE_TOKEN` stores those documents in private Vercel Blob objects.

Vercel API tokens and protection bypass secrets are stored separately from project records. Locally, `.qa-smoke/secrets.json` is encrypted with `QA_SMOKE_SECRET_KEY` when provided, otherwise a generated `.qa-smoke/secrets.key`. In hosted mode, `QA_SMOKE_SECRET_KEY` is required so encrypted secret data remains decryptable across serverless invocations.

Run snapshots persist to private Blob in hosted mode. Persisted snapshots strip run credentials before writing. Screenshot data is stored as private Blob data and returned only by authenticated screenshot API routes.

Fix-it prompts receive redacted event/report text, failed-step metadata, credential presence booleans, and public repo snippets. Screenshot payloads are represented as captured evidence but are not sent into repair prompt generation.

## Production Protection

Owner login is enabled automatically when `NODE_ENV=production`, `VERCEL`, `VERCEL_ENV`, or auth variables are present. Protected API routes require a signed `test_factory_session` cookie. Unsafe protected methods also require `X-Test-Factory-CSRF: 1`.

The public API allowlist is intentionally narrow: health, auth session/login, GitHub webhook, GitHub setup, and GitHub manifest callback. GitHub webhooks still require signature verification through `GITHUB_WEBHOOK_SECRET`.

Hosted target protection is enabled on Vercel and can be tested locally with `TEST_FACTORY_ENFORCE_HOSTED_TARGETS=true`. It rejects non-HTTP protocols, localhost names, `.local` and `.internal` names, metadata hostnames, private IP literals, and public hostnames that resolve to private, loopback, link-local, carrier-grade NAT, multicast, or reserved ranges.

## Agent Behavior

Browser mode requires Claude for action selection. Ad hoc Browser runs use Claude to plan displayed steps from the prompt. Saved reusable tests execute persisted structured steps directly and do not re-plan on run creation.

Local Browser mode launches the full `playwright` package. Hosted Browser mode launches serverless Chromium through `@sparticuz/chromium`, uses `waitUntil` for background run work, and polls persisted run snapshots so SSE clients can observe events across serverless invocations.

The app does not read hidden LLM chain-of-thought. It displays observable model decisions and reasons returned as ordinary action metadata.

## PR Preview Behavior

GitHub `pull_request` webhooks for `opened`, `reopened`, `synchronize`, and `ready_for_review` are verified with `GITHUB_WEBHOOK_SECRET`. Matching requires an enabled project automation config with the same GitHub owner, repo, and installation ID.

Test Factory creates a queued check run, waits up to the configured timeout for a READY non-production Vercel deployment, updates the check to running, executes selected saved tests, then completes the check and sticky PR comment. Missing previews complete as neutral; smoke failures complete as failure. GitHub check/comment writeback failures are recorded as warnings and do not override the smoke result.

Every matching PR run can also start recommendation generation through the GitHub App installation. The GitHub client fetches PR title/body/base/head metadata, changed files, truncated patches, and relevant changed repo files from the PR head SHA. The PR test recommender creates app-only draft user-flow tests capped at 30. Operators can regenerate, dismiss, or promote drafts into reusable tests.

Recommendation drafts are not posted to GitHub and do not affect check conclusions. Promoting a draft into a reusable test does not add it to the automatic PR suite until explicitly selected.

## GitHub App Flow

When GitHub App credentials are missing, `/api/github/manifest/new?projectId=...` posts a preconfigured manifest to GitHub. The callback exchanges GitHub's manifest code for the app ID, slug, private key, and webhook secret, writes them to local `.env`, updates the in-memory client, and redirects to installation.

The normal connect flow starts at `/api/github/login?projectId=...`, stores a short-lived state cookie, and redirects to the configured GitHub App installation URL. GitHub returns to `/api/github/setup`, where Test Factory validates the installation, maps the selected repository, saves the installation ID, and returns the operator to `/integrations`.
