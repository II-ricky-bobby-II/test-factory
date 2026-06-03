# Auth Flow Security Check

Date: 2026-06-02

Scope: production sign-in, session cookies, protected API middleware, run credential handling, and integration-secret persistence.

## Controls Verified

- Sign-in requires the configured email plus a scrypt password hash. The raw password is not stored in app data, project data, run data, logs, reports, or docs.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. The cookie payload stores only an account marker, an opaque credential-version HMAC, and an expiry timestamp; it does not store the configured email, password hash, or raw password.
- Credential resets invalidate existing signed sessions because the session credential version is derived from the configured email and password hash.
- Repeated failed sign-in attempts are rate-limited per source address and email.
- Protected API routes require a valid session. Unsafe protected methods also require `X-Test-Factory-CSRF: 1`.
- Run-time credentials are stripped from public run payloads and persisted run snapshots.
- GitHub App manifest credentials, Vercel API tokens, and deployment-protection bypass secrets are stored through `SecretStore`, which persists AES-256-GCM ciphertext, IV, and tag rather than plaintext.
- Hosted persistence uses private Vercel Blob objects for run snapshots, screenshots, and encrypted secret records.

## Storage Boundary

Application storage paths do not store raw credentials or integration secrets unencrypted. Deployment secrets remain environment variables managed by the runtime provider. Local `.env` files are plaintext developer configuration and must stay gitignored; the app no longer writes generated GitHub App secrets into `.env`.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run audit:release`
- Auth cookie regression test decodes the signed payload and asserts it does not contain the configured email or password hash marker.
- Secret store regression test verifies persisted secret files do not contain plaintext secret values.
