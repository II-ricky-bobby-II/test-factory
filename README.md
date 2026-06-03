# Test Factory

Test Factory is an owner-operated QA smoke runner for preview deployments. It turns saved projects, reusable smoke tests, PR diffs, and plain-language prompts into browser runs with live screenshots, structured logs, pass/fail reports, and repair prompts.

The public deployment target for this repository is `https://testfactory.sh` on Vercel Hobby. The app is protected by email/password sign-in in production and keeps mutable data out of the repository.

## What It Does

- Dashboard runs: launch ad hoc smoke prompts against a deployment URL with optional run-time credentials.
- Reusable tests: save project definitions and structured test steps, then rerun them without replanning.
- PR preview automation: accept signed GitHub App webhooks, resolve the matching READY Vercel preview, run selected saved tests, and update GitHub checks/comments.
- PR-aware drafts: inspect pull request context and generate app-only draft user-flow tests that can be promoted into reusable tests.
- Failure repair prompts: turn redacted failure evidence and repo snippets into a copyable prompt for the coding agent that owns the target repo.

## Local Development

```bash
npm install
npm run install:browsers
cp .env.example .env
npm run dev
```

Open `http://localhost:4317`.

Use `Demo` mode for a no-network walkthrough. Use `Browser` mode for real sites; Browser mode requires `ANTHROPIC_API_KEY`.

## Production Deployment

The Vercel deployment uses:

- `api/index.ts` as the Express serverless entrypoint.
- `vercel.json` rewrites so `/api/*` reaches the function and all other routes reach the Vite app.
- Email/password sign-in through `TEST_FACTORY_ADMIN_EMAIL`, `TEST_FACTORY_ADMIN_PASSWORD_HASH`, and `TEST_FACTORY_SESSION_SECRET`.
- Private Vercel Blob persistence when `BLOB_READ_WRITE_TOKEN` and `TEST_FACTORY_STORAGE=blob` are configured.
- `@sparticuz/chromium` plus `playwright-core` for serverless Browser-mode runs.
- Hosted-target protections that block localhost, private IPs, internal hostnames, and metadata services on Vercel.

Generate a password hash:

```bash
npm run hash:admin-password -- '<password>'
```

Set `TEST_FACTORY_ADMIN_EMAIL` to the sign-in email address and set `TEST_FACTORY_ADMIN_PASSWORD_HASH` to the generated hash. Do not store the raw password in environment variables. Session cookies are bound to the configured email and password hash without storing either value in the cookie payload, so a credential reset invalidates existing signed sessions.

Recommended Vercel production variables:

- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL`
- `QA_SMOKE_BROWSER_RUNTIME=serverless`
- `QA_SMOKE_PUBLIC_URL=https://testfactory.sh`
- `QA_SMOKE_SECRET_KEY`
- `TEST_FACTORY_ADMIN_EMAIL`
- `TEST_FACTORY_ADMIN_PASSWORD_HASH`
- `TEST_FACTORY_SESSION_SECRET`
- `TEST_FACTORY_STORAGE=blob`
- `TEST_FACTORY_BLOB_PREFIX=test-factory`
- `BLOB_READ_WRITE_TOKEN`
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

The canonical hostname is `testfactory.sh`; `www.testfactory.sh` redirects to the apex host.

## Security Model

Production API routes are sign-in protected except health, login/session, and GitHub setup/webhook endpoints. Authenticated unsafe methods require the `X-Test-Factory-CSRF: 1` header.

Run credentials are accepted only when starting a run. Passwords are never stored in saved profiles, project definitions, reusable tests, logs, API responses, GitHub comments, or repair prompts. Claude receives credential presence metadata, not password values.

GitHub App manifest credentials, Vercel API tokens, and deployment-protection bypass secrets are encrypted in the secret store. Public project responses expose only redacted booleans such as `vercelConnected`, `bypassConfigured`, and `githubInstalled`.

`.env`, `.env.*`, `.qa-smoke/`, local build output, coverage, and Vercel project metadata are ignored by git and by `.vercelignore`.

This repository intentionally has no open-source license. Public visibility does not grant reuse rights beyond what GitHub's terms allow for viewing and forking.

## Scripts

```bash
npm run dev             # API + Vite UI on one local port
npm run build           # production frontend + server compile
npm run start           # serve compiled local build
npm run typecheck       # client and server TypeScript checks
npm test                # unit, component, and API tests
npm run audit:release   # publishable-file secret-pattern audit
npm audit               # dependency vulnerability audit
npm run install:browsers # install Chromium for local Browser mode
```

## GitHub App Setup

On `/integrations`, create or connect a GitHub App for the selected project. The app requests Checks write, Issues write, Pull requests read, and Contents read permissions.

Configure the GitHub App URLs to:

- Setup URL: `https://testfactory.sh/api/github/setup`
- Webhook URL: `https://testfactory.sh/api/github/webhook`

Matching PR webhooks create a queued check, wait for the matching Vercel preview by head SHA then branch, run selected saved tests, and finish success, failure, or neutral. If GitHub denies check or comment writeback, Test Factory records the warning without changing the underlying smoke result.

## Data Storage

Local development stores project/test data in `.qa-smoke/data.json` and encrypted integration secrets in `.qa-smoke/secrets.json`.

Hosted Vercel deployments should use private Vercel Blob storage. Run snapshots strip credentials before persistence, and screenshot payloads are served back only through authenticated API routes.
