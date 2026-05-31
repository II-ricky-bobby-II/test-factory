# Public Release Audit

Date: 2026-05-31

Scope: repository files intended for the public `II-ricky-bobby-II/test-factory` GitHub repository and the `testfactory.sh` Vercel deployment.

## Summary

No blocking release findings remain from the pre-publication audit.

The release adds production owner login, CSRF confirmation for authenticated mutations, private hosted persistence, hosted-target SSRF protections, CI, Dependabot, environment templates, git/Vercel ignore rules, and a repeatable release audit script.

## Security Review

Reviewed surfaces:

- Owner authentication and session-cookie behavior.
- Public API allowlist.
- GitHub webhook signature verification and setup callbacks.
- Vercel preview/bypass-secret handling.
- Run credential handling and persistence boundaries.
- Blob persistence paths and screenshot serving.
- Hosted target validation for server-side browser runs.
- GitHub publication hygiene and ignored local files.

Controls verified:

- Production auth is enabled when running on Vercel or with production/auth environment variables.
- Protected unsafe API methods require `X-Test-Factory-CSRF: 1`.
- Webhooks remain public but require `GITHUB_WEBHOOK_SECRET` signature verification.
- Run credentials are stripped from persisted run snapshots.
- Passwords are not saved in browser profiles.
- Hosted runs reject localhost, private, internal, metadata, and private-resolving hosts.
- `.env`, `.env.*`, `.qa-smoke/`, `.vercel/`, build outputs, coverage, reports, logs, and local browser artifacts are excluded from git/Vercel upload.

Residual accepted risks:

- The owner-only preview opener can place a Vercel protection bypass value into the operator browser URL when a bypass secret is configured. This is intentional for manual preview access and remains behind owner login.
- GitHub manifest credential persistence writes to local `.env`; on hosted Vercel this should be treated as a local-development convenience, not as a durable production configuration path.
- Browser automation against third-party targets is intentionally powerful. Hosted target validation limits network-abuse classes but does not replace operator judgment about which public targets are safe to test.

## Audits Run

```text
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
npx --yes depcheck --json
npm run audit:release
```

Results:

- TypeScript: passed.
- Tests: 102 passed across 16 files.
- Production build: passed.
- Dependency audit: 0 vulnerabilities.
- Dependency usage audit: no unused dependencies, unused dev dependencies, or missing dependencies reported.
- Release secret-pattern scan: passed.

## Publication Checklist

- Public repo name: `test-factory`.
- GitHub owner: `II-ricky-bobby-II`.
- Visibility: public.
- License: intentionally absent.
- Canonical production domain: `testfactory.sh`.
- `www.testfactory.sh`: redirect to apex.
- Required production secrets: configure in Vercel only, never commit.
- DNS provider: keep Namecheap DNS and add only the Vercel-required host records.
