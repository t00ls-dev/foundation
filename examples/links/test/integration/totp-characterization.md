# TOTP characterization — Better Auth 1.7.7 / D1

This is the evidence baseline for a future opt-in integration. TOTP is **not
enabled in Links** by this change. Production auth, schema, migrations and UI
are unchanged.

## Approved policy

- TOTP protects password login.
- Magic Link and Google OAuth remain alternative login methods without a local
  TOTP challenge. This is not account-wide MFA; no custom provider MFA is
  planned.
- No recovery-code experience in Links. Use an empty backup-code generator and
  block the backup-code HTTP endpoints in the later integration.
- Enrollment/UI and production activation belong to subsequent PRs.

## Harness and reproduction

```sh
pnpm --filter @t00ls-dev/example-links exec vitest run --config vitest.integration.config.ts test/integration/totp-characterization.test.ts
```

`test/totp-harness.ts` uses public `better-auth`, `better-auth/adapters/drizzle`
and `better-auth/plugins` exports. Every test creates a disposable real
Miniflare D1, applies the existing migrations, then adds a **test-only** DDL
superset for the plugin and optional database rate limiter. This is not a
proposed production migration and does not modify migration files.

All identities, verification, enrollment, password changes/resets and sessions
are created or observed through public HTTP/API calls. No auth-table fixture
inserts, state updates or direct reads are used. SQL execution failures use the
existing `faultD1Queries` proxy over real D1, not an adapter mock. A fresh auth
instance per request preserves the app's lifetime model.

Only Date is faked; real timers and I/O continue to drive Miniflare. An
independent RFC 6238 HMAC-SHA1 reference derives codes from the public URI. A
cookie jar applies all Set-Cookie headers in order, including deletions.
Assertions avoid printing codes, URIs, tokens or cookies.

Magic Link and verification/reset emails are captured in memory. Google uses the
real Google provider, authorization/state/PKCE, callback and account-linking
path, with a local RSA-signed ID token and intercepted token/JWKS endpoints. No
Google network requests or auth-table fixtures are required. This does not test
Google's consent, delivery or provider-side MFA policy.

## Confirmed contracts

The suite contains 39 cases, including parameterized provider,
password-operation and failure-stage cases.

| Area                | Observation                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pending enrollment  | Does not enable 2FA or rotate the session; bad password/code is rejected. Password login remains usable until confirmation. An unconfirmed secret alone cannot create a session.                                               |
| Enrollment restart  | Replaces pending setup; confirmed setup rejects reenrollment with `TOTP_ALREADY_ENABLED`. Public URI retrieval requires the correct password.                                                                                  |
| Confirmation        | Enables the user and rotates the current browser's cookie/session. The old session is revoked on the healthy path; other sessions retain their IDs and see the updated flag.                                                   |
| Confirmation JSON   | Returns the old session token and pre-update user snapshot (`twoFactorEnabled: false`), despite the replacement cookie being valid and authoritative state being enabled. Do not treat this body as the post-mutation session. |
| Issuer              | Top-level `issuer: "Links"` affects enrollment URI, but `getTOTPURI` returns the same secret with issuer `Better Auth` in this configuration. Later configure `appName` consistently or use the enrollment URI.                |
| Password challenge  | Returns `twoFactorRedirect: true` and `twoFactorMethods: ["totp"]`, with no authenticated browser session until completion.                                                                                                    |
| Challenge lifetime  | Expires after 600 seconds; a completed challenge cannot be reused. Two concurrent uses produce exactly one successful session.                                                                                                 |
| Existing session    | Takes precedence over the challenge cookie. A different authenticated account is not switched by verifying the pending account's code; its unrelated challenge remains usable separately.                                      |
| TOTP window/replay  | Accepts previous/current/next 30-second periods, rejects offsets of two periods, preserves leading zero. The same code may complete another independent challenge in the accepted window.                                      |
| Providers           | Magic Link and Google callback log in to the same enabled identity without TOTP. A subsequent password login still challenges, including for a Google-linked account.                                                          |
| First password      | Magic-Link-only/Google-only identities cannot enroll under default policy until public reset establishes a password. Identity is preserved; subsequent password login challenges after enrollment.                             |
| Passwordless option | `allowPasswordless: true` still requires password for credential accounts, but permits passwordless setup/disable for users without one. Keep the default policy for Links.                                                    |
| Disable             | Password alone suffices, even on a one-day-old session. Missing/wrong password is rejected. Healthy disable rotates current session, retains other sessions, removes secret and permits ordinary password login.               |
| Reauthentication    | Authenticated TOTP verification does not rotate an already-enabled session or change its creation timestamp. No reusable freshness/step-up grant is established.                                                               |
| Password change     | With `revokeOtherSessions: true`, revokes old/current and other sessions, issues usable replacement, keeps TOTP and requires challenge with new password.                                                                      |
| Password reset      | Keeps existing sessions and TOTP; issues no login cookie. Old password fails and new password requires challenge.                                                                                                              |
| Origin              | Cross-origin enrollment, verification and disable fail without changing enabled state.                                                                                                                                         |

## Recovery, OTP and trusted devices

`backupCodeOptions.customBackupCodesGenerate: () => []` returns an empty array
and supports confirmation/disable. Omitting it returns ten default codes.
`disabledPaths` makes generation/verification HTTP routes return 404, but does
not block trusted server API invocation. Public server backup verification also
rejects a code when the stored list is empty. Do not expose the generation/view
server APIs in the future wrapper.

OTP is not configured without `sendOTP`. Trusted devices are still implemented:
direct `trustDevice: true` creates a trust cookie that survives sign-out and
skips the next password challenge. An explicit server-side guard is required if
trusted devices remain out of scope; hiding a checkbox is insufficient.

## Lockout and rate limiting

- Five wrong codes consume a challenge's attempt budget; the sixth request
  invalidates it, including a sixth request containing the correct code.
- Ten account failures across independent challenges persist in D1 across auth
  instances and lock verification for 900 seconds. Concurrent failures across
  ten challenges count toward the same lock. Successful login resets the budget.
- Authenticated-session verification does not use this account lockout budget.
  Magic Link is still usable during lockout under the approved provider policy.
- With rate limiting explicitly enabled, the default backend is **memory**,
  shared across auth instances in the same module/process without touching D1. A
  new instance is not a new Worker isolate; cross-isolate durability is not
  established.
- Explicit `storage: "database"` enforces the plugin's three requests per
  path/IP per ten seconds, including concurrent requests and new auth instances.
  The fourth receives 429 and `X-Retry-After`; advancing the clock restores
  access.
- D1 rate-limit failure prevents disable. Failure-counter write errors prevent
  login; restoring D1 allows retry. These are distinct from the durable account
  lock and challenge budget.

## Partial failures and indeterminate results

The test transport catches errors from `onAPIError.throw: true`, returning a
test-only 500 without cookies. It does **not** claim to validate Foundation's
production error sanitizer or its logout confirmation wrapper.

| Injected failure                         | Durable effects observed through public APIs after D1 recovery                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation: session creation           | User enabled, secret still unconfirmed, original session retained. Password challenge advertises no available method; secret cannot complete login. Magic Link plus authenticated confirmation can finish setup. |
| Confirmation: mark verified              | User enabled and original session revoked, secret still unconfirmed; no usable browser replacement cookie from the failed transport. Same challenge rejection and alternative-login recovery.                    |
| Confirmation: old-session deletion       | Throws after replacement creation; old session remains, user enabled, setup still pending. Public session listing shows old plus replacement; recovery through authenticated confirmation is possible.           |
| Disable: secret deletion                 | User already disabled; original session and secret remain. Password login no longer challenges. Retrying disable can complete cleanup.                                                                           |
| Disable: replacement creation            | User disabled and secret deleted; original session retained. Password login no longer challenges. Retry can finish rotation.                                                                                     |
| Disable: old-session deletion            | Throws after replacement creation; both sessions remain durable, user disabled. Retry can finish cleanup/rotation.                                                                                               |
| Challenge: session creation              | Challenge consumed before error; no browser session. Retrying verification fails; a new password login/challenge is necessary.                                                                                   |
| Password-login: pre-challenge revocation | Throws before producing a challenge; no response cookie forwarded by test transport. Public session listing shows an orphan durable session in addition to the preexisting session.                              |
| Lost confirmation response               | Mutation commits and revokes original session, but browser misses replacement cookie. Alternative Magic Link login observes enabled state and password+TOTP remains usable.                                      |

## Recommendations and remaining boundaries for PR 2

1. Integrate opt-in only; keep production activation/enrollment endpoints
   blocked until the full flow is ready. Preserve Foundation and
   Account/Security contracts.
2. Treat cookies plus authoritative session resolution as mutation evidence,
   never the confirmation JSON token/user. Report indeterminate results without
   automatic retries. Plan explicit recovery for enabled-user/unverified-secret
   states.
3. Empty backup generator and disabled HTTP paths must travel together. Guard
   trusted-device requests and excluded OTP endpoints on the server.
4. Choose the rate-limit backend explicitly. D1 storage needs its own schema in
   the later migration if chosen; native memory does not provide distributed
   limits.
5. Preserve documented other-session semantics. Reauthentication beyond
   per-action password validation requires a separate approved policy and server
   enforcement.
6. Set a consistent app name/issuer. Record that the approved provider policy
   does not represent account-wide MFA.
7. This suite is an isolated Better Auth/D1 contract. It does not validate the
   eventual production migration, Foundation wrapper, UI/session-generation
   races, Cloudflare production cookies/cache, multi-isolate rate limiting,
   restart of a Worker process, or competing successful/failed account-lock
   resets. Add focused integration/E2E coverage when those actual changes are
   made.
