# Security

## Supported Deployment

This repository is intended for an owner-operated deployment at `https://testfactory.sh`. Production API access is protected by email/password sign-in and signed session cookies.

## Sensitive Data Handling

- Do not commit `.env`, `.env.*`, `.qa-smoke/`, `.vercel/`, build output, coverage output, or logs.
- Rotate any secret that is accidentally pasted into an issue, PR, build log, chat transcript, or public commit.
- Use `npm run hash:admin-password -- '<password>'` to generate `TEST_FACTORY_ADMIN_PASSWORD_HASH`; do not store the raw password in environment variables.
- Set `TEST_FACTORY_ADMIN_EMAIL` to the sign-in email address. Signed sessions are bound to the configured email and password hash without storing either value in the cookie payload, so credential resets revoke existing sessions.
- Set `QA_SMOKE_SECRET_KEY` for hosted deployments so encrypted integration secrets remain stable across serverless instances.
- Store generated GitHub App credentials, Vercel API tokens, and deployment-protection bypass secrets only through the encrypted secret store or provider-managed environment variables.
- Use private Vercel Blob storage for hosted persistence.

## Reporting

This is a personal public repository without a formal vulnerability disclosure program. If you find an issue, report it privately to the repository owner instead of opening a public issue with exploit details.

## Release Checklist

Before pushing or deploying:

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
npm run audit:release
```

Confirm that `.env`, `.qa-smoke/`, `.vercel/`, and generated output are untracked and ignored before publishing.
