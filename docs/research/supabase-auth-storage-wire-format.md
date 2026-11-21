# Supabase Auth, Storage and Edge Functions: wire format and stand-in contract

Researched 21 November 2026. Scope: what the apps must call, and what `tools/dev-api` must imitate.

Fact-checked 21 November 2026 against the installed packages, the Auth and Storage server sources and the documentation pages. What changed is listed under "Corrections after fact-check" at the end, followed by "Implementation risks".

## Bottom line

The installed clients (`@supabase/supabase-js`, `auth-js`, `storage-js`, `functions-js` 2.119.2 and `@supabase/ssr` 0.12.7) and the Auth server source (supabase/auth v2.198.0, 13 Nov 2026) agree on a small, stable HTTP surface, documented below endpoint by endpoint. For this project the safest designs are: **token-hash e-mail links** (`/auth/confirm?token_hash=…&type=…` then `verifyOtp`) for password reset, sign-up confirmation and e-mail change, because they work with server-only cookies and across devices; **TOTP MFA via `challengeAndVerify` inside one Server Action**, which returns a *new* token pair carrying `aal: "aal2"` that the existing `private.staff_session_ok()` already reads; **Storage through signed upload URLs or direct uploads under RLS on `storage.objects`**, with buckets and policies created in SQL migrations; and **Edge Functions written as a web-standard `(Request) => Response` handler** exported as `export default { fetch }`, which also runs under Node 22 for tests. Five things will bite on first contact with real Supabase and are not visible in the stand-in today: (1) every Auth call is made from the Next.js server, so Auth's per-IP rate limits and the MFA "same IP" check see the server, not the shopper, and the documented fix (`Sb-Forwarded-For`) requires a secret key; (2) the built-in SMTP only mails organisation members at 2 messages/hour, so a custom SMTP provider is a hard prerequisite; (3) with e-mail confirmation on, `signUp` returns no session and never reports "already registered"; (4) a user with a verified factor cannot change password or e-mail from an `aal1` session, which includes the session a recovery link creates; (5) the stand-in's refresh tokens are strictly single-use and its `session_id` changes on every refresh, both unlike the real server.

Conventions used below:

| Alias | Path |
| --- | --- |
| `AUTHJS` | `node_modules/.pnpm/@supabase+auth-js@2.119.2/node_modules/@supabase/auth-js/src` |
| `SSR` | `node_modules/.pnpm/@supabase+ssr@0.12.7_@supabase+supabase-js@2.119.2/node_modules/@supabase/ssr/src` |
| `SBJS` | `node_modules/.pnpm/@supabase+supabase-js@2.119.2/node_modules/@supabase/supabase-js/src` |
| `STJS` | `node_modules/.pnpm/@supabase+storage-js@2.119.2/node_modules/@supabase/storage-js/src` |
| `FNJS` | `node_modules/.pnpm/@supabase+functions-js@2.119.2/node_modules/@supabase/functions-js/src` |
| `GOTRUE` | `https://raw.githubusercontent.com/supabase/auth/master/internal` (v2.198.0 per its CHANGELOG, fetched 21 Nov 2026; line numbers as of that fetch) |
| `STORAGE` | `https://raw.githubusercontent.com/supabase/storage/master/src` (fetched 21 Nov 2026) |

Anything marked **UNVERIFIED** could not be confirmed from a primary source.

---

## 0. What every request carries

| Item | Value | Source |
| --- | --- | --- |
| Base paths | `/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`, `/realtime/v1` | `SBJS/SupabaseClient.ts:327-331` |
| `apikey` header | always the project key (`sb_publishable_…`) | `SBJS/lib/fetch.ts:86-88` |
| `Authorization` | `Bearer <user access token>` when signed in; otherwise `Bearer <the same API key>` for Auth, REST and Storage; **omitted** for Functions when the key is a new-format key | `SBJS/lib/fetch.ts:77-95`, `SBJS/SupabaseClient.ts:371-387`, `681-684` |
| `X-Supabase-Api-Version` | `2024-01-01` on every Auth request | `AUTHJS/lib/fetch.ts:186-188`, `AUTHJS/lib/constants.ts:33-39` |
| `X-Client-Info` | `supabase-ssr/0.12.7 createServerClient` | `SSR/createServerClient.ts:158-163` |
| Auth body content type | `application/json;charset=UTF-8`; `GET` has no body | `AUTHJS/lib/fetch.ts:156-162` |
| `redirectTo` / `emailRedirectTo` | sent as query string `?redirect_to=…`, never in the body | `AUTHJS/lib/fetch.ts:194-199` |

Gateway behaviour (documented for the self-hosted Envoy gateway; that page states parity with the hosted platform only for CORS, so treat the rest as a close model of the hosted gateway, not a guarantee): `apikey` is required on `/auth/v1/*` and `/rest/v1/*` (401 without); `/auth/v1/verify`, `/auth/v1/callback`, `/auth/v1/authorize` and `/auth/v1/.well-known/jwks.json` are open; `/storage/v1/*` and `/functions/v1/*` do their own authorisation. An `Authorization` header that is absent or starts with `Bearer sb_` is replaced by an internal `anon`/`service_role` JWT; a real user JWT passes through unchanged. Source: https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys and https://supabase.com/docs/guides/self-hosting/self-hosted-envoy. **Consequence for the stand-in:** `Authorization: Bearer sb_publishable_…` means "visitor" (already handled, `tools/dev-api/src/context.ts:124-127`).

### Server client facts (`@supabase/ssr` 0.12.7)

| Fact | Detail | Source |
| --- | --- | --- |
| Forced auth options | `flowType: "pkce"`, `autoRefreshToken: false`, `detectSessionInUrl: false`, `persistSession: true`, `skipAutoInitialize: true` | `SSR/createServerClient.ts:165-175` |
| Session cookie name | `sb-<first label of the API hostname>-auth-token` (locally `sb-127-auth-token`); split into `.0`, `.1`… above 3180 characters | `SBJS/SupabaseClient.ts:334`, `SSR/utils/chunker.ts:6` |
| Cookie value | `base64-` + base64url(JSON session) | `SSR/cookies.ts:24`, `592-596` |
| Default cookie options | `path=/`, `sameSite=lax`, `httpOnly=false`, `maxAge` 400 days (the project overrides to `httpOnly`, `packages/next-kit/src/server/supabase.ts:38-43`) | `SSR/utils/constants.ts:3-10` |
| When cookies are written | on `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`, `PASSWORD_RECOVERY`, `SIGNED_OUT`, `MFA_CHALLENGE_VERIFIED`; plus immediately whenever a `*-code-verifier` key is stored | `SSR/createServerClient.ts:187-212`, `SSR/cookies.ts:480-500` |
| Cache headers | `setAll(cookies, headers)` receives `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache` once per client. **The project's `setAll` ignores the second argument** (`supabase.ts:74-83`, `proxy.ts:30-43`); add it if a CDN ever sits in front of authenticated routes | `SSR/cookies.ts:645-671`, `SSR/types.ts:32-65` |
| PKCE verifier cookies | `<key>-code-verifier` (value `<verifier>` or `<verifier>/recovery`), `<key>-flow-<id>-code-verifier`, `<key>-flows-code-verifier`; at most 5 pending flows | `AUTHJS/lib/helpers.ts:339-388`, `494-510`, `AUTHJS/lib/constants.ts:56` |

Cookies are scoped by host, not port: in local development the four apps on `localhost`/`127.0.0.1` share one `sb-127-auth-token` cookie.

---

## 1. Password recovery, sign-up confirmation, e-mail change, reauthentication

### 1.1 PKCE links versus token-hash links

Because the server client is always PKCE, `resetPasswordForEmail`, `signUp`, `resend` and `updateUser({email})` send a `code_challenge`. The server then stores the one-time token with a `pkce_` prefix (`GOTRUE/api/pkce.go:33-40`, `GOTRUE/api/mail.go:398-437`). Two ways to finish:

| | Default template (`{{ .ConfirmationURL }}`) | Token-hash template (recommended) |
| --- | --- | --- |
| Link | `https://<ref>.supabase.co/auth/v1/verify?token=pkce_<hash>&type=recovery&redirect_to=<url>` | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (or `{{ .RedirectTo }}…`) |
| Hop | Auth `GET /verify` answers `303` to `<redirect_to>?code=<auth_code>` (`GOTRUE/api/verify.go:120-227`, `542-551`) | none; the link lands on the app |
| App call | `exchangeCodeForSession(code)` → `POST /token?grant_type=pkce {auth_code, code_verifier}` | `verifyOtp({ token_hash, type })` → `POST /verify` |
| Needs verifier cookie | **yes**: same browser that requested the e-mail; auth code valid 5 minutes, single use | **no**: works on another device |
| Failure on the link | redirect to `<redirect_to>?error=access_denied&error_code=otp_expired&error_description=…#…` (`verify.go:491-522`) | JSON error from `POST /verify` |

`{{ .TokenHash }}` already includes the `pkce_` prefix when one was stored; pass it through untouched. `POST /verify` with a token hash issues the session directly and does not consult the flow state (`verify.go:229-311`, `651-704`). Token hash = hex SHA-224 of `email + otp` (`GOTRUE/crypto/crypto.go:45-47`). Docs: https://supabase.com/docs/guides/auth/passwords (PKCE tab), https://supabase.com/docs/guides/auth/auth-email-templates.

Template variables: `{{ .ConfirmationURL }}`, `{{ .Token }}` (6-digit code), `{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .RedirectTo }}`, `{{ .Data }}`, `{{ .Email }}`, `{{ .NewEmail }}` (auth-email-templates doc). The project has four apps on different hosts but Auth has one Site URL, so build links from `{{ .RedirectTo }}` and pass `redirectTo: "<this app's origin>/auth/confirm"`; every such URL must be on the redirect allow-list, otherwise Auth falls back to the Site URL (https://supabase.com/docs/guides/auth/redirect-urls).

**Link scanners.** Mail security products prefetch links and consume one-time tokens ("Email prefetching" in the templates doc). Make `GET /auth/confirm` render a page with a button and call `verifyOtp` only from the `POST` (Server Action). This also satisfies the rule that cookies can only be written in an action or route handler.

### 1.2 Password recovery, request by request

**Step 1. Ask for the e-mail** (`AUTHJS/GoTrueClient.ts:4530-4571`)

```http
POST /auth/v1/recover?redirect_to=https%3A%2F%2Fshop.example%2Fauth%2Fconfirm
apikey: sb_publishable_…
Authorization: Bearer sb_publishable_…
X-Supabase-Api-Version: 2024-01-01
Content-Type: application/json;charset=UTF-8

{"email":"ana@example.com","code_challenge":"<43 chars base64url>","code_challenge_method":"s256","gotrue_meta_security":{}}
```

```http
200 OK
{}
```

`200 {}` is returned whether or not the address has an account (`GOTRUE/api/recover.go:52-56`); show one message for both. Client result: `{ data: {}, error: null }`.

| Status | Code | When | Source |
| --- | --- | --- | --- |
| 400 | `validation_failed` | missing or malformed e-mail | `recover.go:18-30`, `mail.go:710-722` |
| 429 | `over_email_send_rate_limit` | same user asked again within `max_frequency` (default 60 s; message "For security purposes, you can only request this after N seconds.") or the project-wide hourly e-mail budget is spent ("email rate limit exceeded") | `mail.go:402-404`, `419-421`, `724-729`; `GOTRUE/conf/configuration.go:1251-1253` |
| 429 | `over_request_rate_limit` | per-IP bucket for `/recover` | `GOTRUE/api/api.go` route table; `GOTRUE/api/middleware.go:123-133` |

**Step 2. The link** lands on `GET /auth/confirm?token_hash=pkce_…&type=recovery` (page with a button).

**Step 3. Exchange** (`AUTHJS/GoTrueClient.ts:2479-2524`)

```http
POST /auth/v1/verify
{"token_hash":"pkce_3f2a…","type":"recovery","gotrue_meta_security":{}}
```

```http
200 OK
{"access_token":"<jwt>","token_type":"bearer","expires_in":3600,"expires_at":1795300000,
 "refresh_token":"<opaque>","user":{…}}
```

The client saves the session and emits `PASSWORD_RECOVERY` (`GoTrueClient.ts:2508-2514`), which makes `@supabase/ssr` write the cookies. Send only `token_hash` and `type`: adding `email`, `phone` or a body `redirect_to` gives `400 validation_failed` "Only the token_hash and type should be provided" (`verify.go:83-87`). `verifyOtp` spreads its whole argument into the body (`GoTrueClient.ts:2489-2492`), so any extra top-level key such as `email` reaches the server and triggers that 400: pass exactly `{ token_hash, type }`. (`options.redirectTo` would travel as the `?redirect_to=` query string, not in the body, and the server ignores unknown body keys such as `options`, `GOTRUE/api/helpers.go:86-98`; the `VerifyTokenHashParams` type has no `options` field in any case, `AUTHJS/lib/types.ts:896-902`.)

| Status | Code | Message | Source |
| --- | --- | --- | --- |
| 403 | `otp_expired` | "Email link is invalid or has expired" (unknown, already used, or older than the OTP expiry) | `verify.go:670-701` |
| 403 | `user_banned` | "User is banned" | `verify.go:677-679` |
| 400 | `validation_failed` | missing `type`, both or neither of `token`/`token_hash`, unsupported type | `verify.go:51-92`, `268-269` |
| 429 | `over_request_rate_limit` | per-IP bucket for `/verify` | `api.go` route table |

A recovery link also confirms an unconfirmed address, and since v2.198.0 clears a password that was set before confirmation (`verify.go:370-407`). The token is single-use: verifying clears all one-time tokens of the user (`GOTRUE/models/user.go:721-728`).

**Step 4. Set the password** (`AUTHJS/GoTrueClient.ts:3422-3472`)

```http
PUT /auth/v1/user
Authorization: Bearer <access_token from step 3>
{"password":"new-password","code_challenge":null,"code_challenge_method":null}
```

```http
200 OK
{"id":"…","aud":"authenticated","role":"authenticated","email":"ana@example.com", …}
```

Client emits `USER_UPDATED` and rewrites the cookie. Server side effects: every **other** session of the user is signed out and all pending confirmation/recovery/e-mail-change tokens are cleared (`GOTRUE/models/user.go:497-526`, `GOTRUE/api/user.go:206-216`).

| Status | Code | When | Source |
| --- | --- | --- | --- |
| 422 | `weak_password` | shorter than the minimum, missing required character classes, or leaked (body also has `weak_password.reasons`: `length`, `characters`, `pwned`) | `GOTRUE/api/password.go:29-79`, `GOTRUE/api/errors.go:106-149` |
| 400 | `validation_failed` | longer than 72 bytes (the message says "characters") | `password.go:14`, `32-38` |
| 422 | `same_password` | new password equals the current one | `user.go:196-198` |
| 401 | `insufficient_aal` | user has a verified MFA factor and the session is `aal1` ("AAL2 session is required to update email or password when MFA is enabled.") | `user.go:106-110` |
| 400 | `reauthentication_needed` | secure password change is on and the session is older than 24 h and no `nonce` was sent | `user.go:153-160` |
| 422 | `reauthentication_not_valid` | wrong or expired `nonce` | `GOTRUE/api/reauthenticate.go:69-99` |
| 400 | `current_password_required` / `current_password_invalid` | "require current password" is on (skipped inside a recovery session) | `user.go:171-187`; codes in `GOTRUE/api/apierrors/errorcode.go:75-76` (not in the auth-js `ErrorCode` union, they arrive as plain strings) |
| 401 | `no_authorization` | no Bearer token | `GOTRUE/api/auth.go:99-107` |
| 403 | `bad_jwt`, `session_not_found`, `user_not_found`, `user_banned` | token invalid/expired, session gone, user gone or banned | `auth.go:42-61`, `109-190` |
| 429 | `over_request_rate_limit` | `PUT /user` has its own per-IP bucket | `api.go` (`limiterOpts.User`) |

**Staff with MFA:** a recovery session is `aal1`, so the "choose a new password" screen must first run the TOTP challenge (section 2) for anyone who has a verified factor, or `PUT /user` fails with `401 insufficient_aal`.

### 1.3 Sign-up with e-mail confirmation

Request (`AUTHJS/GoTrueClient.ts:1035-1102`): `POST /auth/v1/signup?redirect_to=…` with body `{"email","password","data":{…},"gotrue_meta_security":{},"code_challenge","code_challenge_method"}`.

| Situation | HTTP | Body | Client result |
| --- | --- | --- | --- |
| New address, confirmation required | 200 | the **User object at top level**, no `access_token`; `confirmation_sent_at` set, no `email_confirmed_at`, `identities` has one entry | `{ user, session: null }` (`AUTHJS/lib/fetch.ts:253-267`) |
| New address, autoconfirm | 200 | session object (`access_token`, `refresh_token`, `user`) | `{ user, session }` |
| Address already **confirmed**, confirmation required | 200 | a **fake** user: random `id`, `identities: []`, `role: ""`, no e-mail is sent | looks like success; detect with `data.user.identities.length === 0` (`GOTRUE/api/signup.go:281-301`, `349-378`) |
| Address already confirmed, autoconfirm | 422 | `user_already_exists`, "User already registered" | `error.code === "user_already_exists"` (`signup.go:293-295`) |
| Address exists but unconfirmed | 200 or 429 | confirmation re-sent, or `over_email_send_rate_limit` within 60 s | `signup.go:228-253`, `mail.go:319-358` |
| Weak password | 422 | `weak_password` | as above |
| Sign-ups disabled | 422 | `signup_disabled` | `signup.go:115-117` |

Consequences for existing code: `passwordSignUp` only maps `user_already_exists` (`packages/next-kit/src/server/actions.ts:115-123`), which will never fire once confirmation is on; and consent is recorded only when a session comes back (`actions.ts:124-134`), so with confirmation on it must be recorded after the confirm step instead.

Signing in before confirming: `400 email_not_confirmed` "Email not confirmed", returned only after the password itself was correct (`GOTRUE/api/token.go:208-216`).

Confirm: link `…/auth/confirm?token_hash={{ .TokenHash }}&type=email`, then `verifyOtp({ token_hash, type: "email" })` → same `POST /verify` as above, `200` session, event `SIGNED_IN`. Type `email` accepts a confirmation or a magic-link token; `signup` accepts only a confirmation token (`verify.go:656-663`).

Resend (`AUTHJS/GoTrueClient.ts:2736-2787`):

```http
POST /auth/v1/resend?redirect_to=…
{"email":"ana@example.com","type":"signup","gotrue_meta_security":{},"code_challenge":"…","code_challenge_method":"s256"}
```

`200 {}` also when the address is unknown or already confirmed (`GOTRUE/api/resend.go:93-121`). Errors: `400 validation_failed` (type not one of `signup`, `email_change`, `sms`, `phone_change`), `429 over_email_send_rate_limit`, `429 over_request_rate_limit`. Password-reset e-mails are "resent" by calling `resetPasswordForEmail` again.

### 1.4 E-mail change

`updateUser({ email: "new@example.com" }, { emailRedirectTo })` → `PUT /auth/v1/user?redirect_to=…` with `{"email":"new@example.com","code_challenge":"…","code_challenge_method":"s256"}` (a PKCE challenge is generated only when `email` is present, `GoTrueClient.ts:3441-3443`). Response `200` User with `new_email` and `email_change_sent_at`; `email` is unchanged until confirmed.

| Detail | Source |
| --- | --- |
| `422 email_exists` if another account has the address | `user.go:134-140` |
| `401 insufficient_aal` for MFA users on `aal1` | `user.go:106-110` |
| `429 over_email_send_rate_limit` within 60 s of the last change e-mail | `mail.go:524-530` |
| "Secure email change" (server default on; `auth.email.double_confirm_changes`) sends one link to the current and one to the new address | `mail.go:532-545`; `configuration.go:686` |
| Confirm each with `verifyOtp({ token_hash, type: "email_change" })`. The first returns `200 {"msg":"Confirmation link accepted. Please proceed to confirm link sent to the other email","code":"200"}` which the client surfaces as `{ user: null, session: null, error: null }`; the second returns a session with the new address | `verify.go:39`, `294-299`, `553-649`; `AUTHJS/lib/fetch.ts:263-266` |

Which template variable carries which mailbox's hash when both e-mails are sent is **UNVERIFIED** (the server comment at `mail.go:823-833` describes a swap); test against the local stack's mail catcher before writing the template.

### 1.5 Reauthentication and current password

| Setting (config key) | Effect | Calls |
| --- | --- | --- |
| `auth.email.secure_password_change` (default off) | password change needs a `nonce` when the session was created more than 24 h ago | `reauthenticate()` → `GET /auth/v1/reauthenticate` with the user token → `200 {}`, e-mails a 6-digit code; then `updateUser({ password, nonce })` (`GoTrueClient.ts:2653-2675`, `reauthenticate.go:17-67`, `user.go:153-165`) |
| `auth.email.require_current_password` (default off) | password change needs `current_password`; skipped in a recovery session | `updateUser({ password, current_password })` (`AUTHJS/lib/types.ts:536-545`, `user.go:171-187`) |

Neither is required for the recovery flow. "Recovery session" on the server means any session whose `amr` contains `otp`, `magiclink` or `recovery` (`GOTRUE/models/sessions.go:114-127`, `GOTRUE/models/factor.go:66-73`); every session created by `POST /verify` carries `otp`, so a session born from a sign-up confirmation link also skips the current-password check. The password-reset guide writes `currentPassword`; the installed client's type and the password-security guide use **`current_password`**, which is what the server parses (`user.go:21`).

---

## 2. MFA with TOTP

### 2.1 Endpoints

All require `Authorization: Bearer <user access token>`; anonymous users get `403 no_authorization` (`api.go` `/factors` routes, `GOTRUE/api/auth.go:70-77`). On the three `/factors/{id}…` routes an id that is unknown or belongs to another user answers `404 mfa_factor_not_found` "Factor not found", and an id that is not a UUID answers `404 validation_failed` "factor_id must be an UUID" (`GOTRUE/api/admin.go:75-94`).

| Client call | HTTP | Request body | Success body | Source |
| --- | --- | --- | --- | --- |
| `mfa.enroll({ factorType: "totp", friendlyName, issuer })` | `POST /auth/v1/factors` | `{"friendly_name":"…","factor_type":"totp","issuer":"Yuntera"}` | `{"id":"<uuid>","type":"totp","friendly_name":"…","totp":{"qr_code":"<svg …>","secret":"<base32>","uri":"otpauth://totp/…"}}` (client prefixes `qr_code` with `data:image/svg+xml;utf-8,`) | `GoTrueClient.ts:5864-5903`; `GOTRUE/api/mfa.go:33-52`, `263-335` |
| `mfa.challenge({ factorId })` | `POST /auth/v1/factors/{id}/challenge` | `{"factorId":"<uuid>"}` | `{"id":"<challenge uuid>","type":"totp","expires_at":1795300300}` | `GoTrueClient.ts:6006-6037`; `mfa.go:459-490` |
| `mfa.verify({ factorId, challengeId, code })` | `POST /auth/v1/factors/{id}/verify` | `{"challenge_id":"<uuid>","code":"123456"}` | `{"access_token","token_type":"bearer","expires_in","expires_at","refresh_token","user"}` | `GoTrueClient.ts:5913-5992`; `mfa.go:625-758` |
| `mfa.challengeAndVerify({ factorId, code })` | the two calls above, in sequence | | as verify | `GoTrueClient.ts:6092-6107` |
| `mfa.unenroll({ factorId })` | `DELETE /auth/v1/factors/{id}` | none | `{"id":"<uuid>"}` | `GoTrueClient.ts:5837-5856`; `mfa.go:1056-1130` |
| `mfa.listFactors()` | `GET /auth/v1/user` | none | reads `user.factors[]`; returns `{ all, totp, phone, webauthn, recovery_code }` where the typed buckets hold **verified** factors only | `GoTrueClient.ts:6112-6146` |
| `mfa.getAuthenticatorAssuranceLevel()` | **no request** (decodes the stored access token; with a `jwt` argument it calls `GET /user`) | | `{ currentLevel, nextLevel, currentAuthenticationMethods }`; `nextLevel` is `aal2` when `session.user.factors` has a verified factor | `GoTrueClient.ts:6151-6227` |

Factor object in `user.factors`: `{"id","friendly_name"?, "factor_type":"totp","status":"unverified"|"verified","created_at","updated_at","last_challenged_at"}` (`AUTHJS/lib/types.ts:466-489`; `GOTRUE/models/factor.go`).

### 2.2 Errors

| Status | Code | When | Source |
| --- | --- | --- | --- |
| 422 | `mfa_factor_name_conflict` | another factor of the user has the same `friendly_name`, **including two empty names** | `mfa.go:100-116` |
| 422 | `too_many_enrolled_mfa_factors` | 10 factors (default) | `mfa.go:124-130`; `configuration.go:221-222` |
| 403 | `insufficient_aal` | enrolling a further factor from an `aal1` session when one is already verified | `mfa.go:132-134` |
| 422 | `mfa_totp_enroll_not_enabled` / `mfa_totp_verify_not_enabled` | TOTP switched off | `mfa.go:351-355`, `607-611` |
| 422 | `mfa_verification_failed` | "Invalid TOTP code entered" | `mfa.go:677-688` |
| 422 | `mfa_challenge_expired` | challenge older than 300 s | `mfa.go:587-592`; `configuration.go:218` |
| 422 | `mfa_ip_address_mismatch` | verify came from a different IP than the challenge, **or the challenge was already verified** | `mfa.go:583-585` |
| 422 | `mfa_factor_not_found` | challenge id unknown for this factor | `mfa.go:575-581` |
| 422 | `insufficient_aal` | unenrolling a verified factor from `aal1` | `mfa.go:1072-1074` |
| 400 | `validation_failed` | empty `code`, unknown `factor_type` | `mfa.go:1029-1031`, `367-369` |
| 429 | `over_request_rate_limit` | challenge and verify: 15 per minute per IP, burst 30 | `GOTRUE/api/apilimiter/apilimiter.go:207-215`; `configuration.go:220` |

Unverified factors are deleted after 300 s, and after a successful verify the other unverified factors of the same type are removed (`mfa.go:101-103`, `737-739`; `configuration.go:219`). On an enrolment page that can be reloaded, unenroll stale `unverified` entries from `listFactors().all` first or give each attempt a unique `friendlyName`, otherwise the second `enroll` within five minutes fails with `mfa_factor_name_conflict`.

### 2.3 What a successful verify does

1. Marks the challenge verified and the factor `verified` (`mfa.go:702-709`).
2. Adds the `totp` method to the **same** session, sets its level to `aal2`, and issues a **new access token and a new refresh token**; the refresh-token counter jumps by 2 so the pre-MFA refresh token can never mint `aal2` tokens (`GOTRUE/api/token.go:377-480`).
3. Invalidates every other session of the user whose level is below `aal2` (`mfa.go:734-736`).
4. Client stores the new pair and emits `MFA_CHALLENGE_VERIFIED` (`GoTrueClient.ts:5971-5975`); `@supabase/ssr` writes cookies on that event (`SSR/createServerClient.ts:202`). It must therefore run in a Server Action or route handler.

The level belongs to the session row, so later refreshes keep `aal2` and the `amr` list (`GOTRUE/tokens/service.go:671-760`, `GOTRUE/models/sessions.go:390-418`). After `unenroll` the server downgrades the user's sessions to `aal1`, but the JWT already issued says `aal2` until it is refreshed; call `refreshSession()` for an immediate downgrade (https://supabase.com/docs/guides/auth/auth-mfa).

### 2.4 Claims

Access token payload (claims struct `GOTRUE/tokens/service.go:78-91`; reference https://supabase.com/docs/guides/auth/jwt-fields):

```json
{
  "iss": "https://<ref>.supabase.co/auth/v1", "aud": "authenticated",
  "sub": "<user uuid>", "role": "authenticated", "iat": 1795296400, "exp": 1795300000,
  "email": "staff@example.com", "phone": "", "is_anonymous": false,
  "session_id": "<session uuid, stable for the life of the session>",
  "aal": "aal2",
  "amr": [ { "method": "totp", "timestamp": 1795296460 }, { "method": "password", "timestamp": 1795296400 } ],
  "app_metadata": { "provider": "email", "providers": ["email"] },
  "user_metadata": { "full_name": "…" }
}
```

`amr` is ordered most recent first. Methods the server treats as second factors: `totp`, `mfa/phone`, `mfa/webauthn`, `mfa/recovery_code` (`GOTRUE/models/amr.go`). A session created by `POST /verify` carries method `otp`. Header: `{"alg":"ES256"|"RS256"|"HS256","kid":"…","typ":"JWT"}`.

### 2.5 Enforcing `aal2` in Postgres

The project already does the right thing: `private.staff_session_ok()` compares `(select auth.jwt()) ->> 'aal'` with `'aal2'` when `require_staff_mfa` is set (`supabase/migrations/20261121080100_identity.sql:155-166`), and `is_staff()` / `has_staff_role()` include it. The documented alternative for table-level enforcement is a **restrictive** policy:

```sql
create policy "staff tables need a second factor" on public.some_table
  as restrictive to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
```

Without `as restrictive` it would be OR-ed with other policies and enforce nothing (auth-mfa guide). "Only users who enrolled" variant: compare against `auth.mfa_factors where user_id = auth.uid() and status = 'verified'` (same guide). To require a *recent* second factor, read `jsonb_path_query((select auth.jwt()), '$.amr[0]')`.

Screen-level gating: after password sign-in call `listFactors()` (one `GET /user`); if there is a verified TOTP factor and the token says `aal1`, redirect to the code screen rather than showing an error (auth-mfa guide, "Server-Side Rendering"). `getAuthenticatorAssuranceLevel()` alone reads `session.user` from the cookie, which can be stale.

### 2.6 TOTP parameters

| Parameter | Value | Source |
| --- | --- | --- |
| Algorithm / digits / period | HMAC-SHA1, 6 digits, 30 s | `mfa.go:643-648` |
| Accepted window | current step ±1 (`Skew: 1`) | `mfa.go:645` |
| Secret | 20 random bytes, base32 **without padding** (32 characters) | pquerna/otp `totp/totp.go` (`SecretSize` default 20, `b32NoPadding`) |
| URI | `otpauth://totp/<issuer>:<account e-mail>?algorithm=SHA1&digits=6&issuer=<issuer>&period=30&secret=<base32>` | same file; `mfa.go:286-289` |
| Issuer default | host of the Auth Site URL when `issuer` is not sent | `mfa.go:270-279` |
| QR code | SVG markup of the URI, error correction H | `mfa.go:294-301` |
| Challenge lifetime | 300 s | `configuration.go:218` |

Recovery (backup) codes exist in the client and server but are flagged experimental and "not yet publicly available to projects" (`AUTHJS/lib/types.ts:1416-1428`). Plan the lost-phone procedure without them: let staff enrol a second TOTP factor, and have an admin remove factors (Auth admin API `DELETE /admin/users/{id}/factors/{factor_id}`, `api.go` admin routes, needs a secret key).

---

## 3. auth-js behaviours a stand-in must respect

### 3.1 Error body and status mapping

Because the client sends `X-Supabase-Api-Version: 2024-01-01`, the real server answers errors as:

```http
HTTP/1.1 422 Unprocessable Entity
X-Supabase-Api-Version: 2024-01-01
x-sb-error-code: same_password
Content-Type: application/json

{"code":"same_password","message":"New password should be different from the old password."}
```

Weak password adds `"weak_password":{"reasons":["length"]}`. Without the request header the legacy shape is used: `{"code":422,"error_code":"same_password","msg":"…"}` (`GOTRUE/api/errors.go:76-79`, `106-205`; `GOTRUE/api/apierrors/apierrors.go:48-55`; `GOTRUE/api/apiversions.go`).

Client parsing (`AUTHJS/lib/fetch.ts:79-146`): reads `data.code` as the error code **only if the response carries `X-Supabase-Api-Version` ≥ 2024-01-01**, otherwise `data.error_code`; message from `msg`, `message`, `error_description` or `error`, in that order. So the stand-in's current legacy bodies work, but a body with a string `code` and no response header would lose its code.

| Response | Client error |
| --- | --- |
| fetch throws, or status 500-504 / 520-530 | `AuthRetryableFetchError` (session is kept) |
| code `weak_password` | `AuthWeakPasswordError` with `.reasons` |
| code `session_not_found` | `AuthSessionMissingError`; `getUser()` then removes the local session (`GoTrueClient.ts:3274-3281`) |
| anything else non-2xx | `AuthApiError { status, code, message }` |

Codes the apps should branch on (full union: `AUTHJS/lib/error-codes.ts:6-95`): `invalid_credentials` (400), `email_not_confirmed` (400), `user_already_exists` (422), `email_exists` (422), `weak_password` (422), `same_password` (422), `otp_expired` (403), `over_email_send_rate_limit` / `over_request_rate_limit` (429), `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired`, `user_banned` (400 on the token endpoint), `insufficient_aal`, `mfa_*`, `reauthentication_needed`, `validation_failed`, `signup_disabled`, `email_address_not_authorized` (built-in SMTP refusing a non-member address; `400`, `GOTRUE/api/mail.go:773-790`).

### 3.2 `getClaims()` (`AUTHJS/GoTrueClient.ts:6752-6860`)

1. No argument: calls `getSession()`, which refreshes first if the token expires within 90 s (`AUTHJS/lib/constants.ts:4-13`).
2. Decodes the three base64url parts; rejects a missing or past `exp` (`AUTHJS/lib/helpers.ts:185-217`, `534-542`).
3. If `alg` starts with `HS`, or there is no `kid`, or WebCrypto is missing: falls back to `GET /user`.
4. Otherwise finds the key by `kid` in a process-wide cache (per storage key, 10 minutes), else `GET /auth/v1/.well-known/jwks.json` and expects `{"keys":[…]}` (`GoTrueClient.ts:236`, `277-291`, `6649-6685`; `constants.ts:58`). If the fetched set is empty or has no key with that `kid`, it also falls back to `GET /user` (`GoTrueClient.ts:6672-6685`, `6801-6824`), so a stand-in whose JWKS `kid` does not match the token header silently turns every `getClaims()` into a network call.
5. Verifies with `crypto.subtle`; supported `alg`: `ES256` (P-256) and `RS256` only (`helpers.ts:544-562`).

**It validates the signature and `exp` only**, not `iss`, `aud`, `role` or `nbf`. That is acceptable because PostgREST and the database re-verify, and the project reads roles from the database (`packages/next-kit/src/server/session.ts`). The real JWKS response has `Cache-Control: public, max-age=600` and excludes symmetric keys (`GOTRUE/api/jwks.go`); Supabase also edge-caches it for 10 minutes, so a rotated key can take up to about 20 minutes to be picked up (https://supabase.com/docs/guides/auth/signing-keys).

### 3.3 Refresh tokens

Request: `POST /auth/v1/token?grant_type=refresh_token` with `{"refresh_token":"…"}`; success is a full session (`GoTrueClient.ts:4833-4878`). Refresh tokens of 12 characters must match `^[a-z0-9]{12}$`; longer ones are a signed structure; shorter is `400 validation_failed` (`GOTRUE/api/token_refresh.go:18-39`).

Server rules (`GOTRUE/tokens/service.go:194-420`; https://supabase.com/docs/guides/auth/sessions):

| Case | Result |
| --- | --- |
| Current token | new access + refresh token, same `session_id`, same `aal`/`amr` |
| Already-used token, within the **reuse interval** (10 s on the platform and in the CLI, `auth.refresh_token_reuse_interval`; the Auth server's own default is 0, `GOTRUE/conf/configuration.go:935`, so it only exists where it is configured) | accepted again |
| Already-used token that is the **parent of the currently active** token | accepted; returns the active token (covers "response was lost") |
| Any other reuse | `400 refresh_token_already_used`; with rotation on, the whole token family is revoked (session ends) |
| Unknown token | `400 refresh_token_not_found` "Invalid Refresh Token: Refresh Token Not Found" |
| Session row gone (signed out, password changed elsewhere, MFA invalidated it) | `400 session_not_found` |
| Timebox / inactivity exceeded | `400 session_expired` |
| User banned | `400 user_banned` |

Client rules (`GoTrueClient.ts:5050-5230`): concurrent refreshes in one client share one request; a retryable failure keeps the session; a non-retryable failure removes the session **only if the access token has really expired**; failures are cached per refresh token for 60 s; after the request it re-reads storage and discards the result if storage changed meanwhile (`AuthRefreshDiscardedError`, status 409).

Why the reuse interval matters here: on one page load the proxy (`packages/next-kit/src/server/proxy.ts`) and a Server Component can each create a client holding the same cookie. If the proxy's cookie write is lost or races, the second client presents the just-used token. Real Supabase tolerates that for 10 s; the stand-in deletes the token immediately (`tools/dev-api/src/routes/auth.ts:125`) and the user is signed out.

### 3.4 `GET /user`, `PUT /user`, `/logout`

| Call | Request | Response |
| --- | --- | --- |
| `getUser()` | `GET /auth/v1/user`, Bearer user token | `200` User object at top level (`GoTrueClient.ts:3247-3288`, `fetch.ts:288-291`). `400 validation_failed` if the token's `aud` differs (`user.go:64-79`) |
| `updateUser(attrs)` | `PUT /auth/v1/user` with `{...attrs, code_challenge, code_challenge_method}`; accepted keys `email`, `password`, `current_password`, `nonce`, `data`, `phone`, `channel` | `200` User. `data` is **merged** into `user_metadata` key by key; a `null` value deletes the key (`GOTRUE/models/user.go:230-243`). `app_metadata` needs admin: `403 not_admin` (`user.go:18-29`, `100-104`) |
| `signOut({ scope })` | `POST /auth/v1/logout?scope=global\|local\|others`, Bearer user token, no body | `204` no content (`AUTHJS/GoTrueAdminApi.ts:140-164`; `GOTRUE/api/logout.go:21-73`). Unknown scope: `400 validation_failed` |

User object fields (`GOTRUE/models/user.go` JSON tags): `id`, `aud`, `role`, `email`, `email_confirmed_at?`, `invited_at?`, `phone`, `phone_confirmed_at?`, `confirmation_sent_at?`, `confirmed_at?`, `recovery_sent_at?`, `new_email?`, `email_change_sent_at?`, `new_phone?`, `reauthentication_sent_at?`, `last_sign_in_at?`, `app_metadata`, `user_metadata`, `factors?`, `identities`, `created_at`, `updated_at`, `banned_until?`, `deleted_at?`, `is_anonymous`. Identity: `identity_id`, `id`, `user_id`, `identity_data`, `provider`, `last_sign_in_at`, `created_at`, `updated_at`, `email`.

Sign-out semantics changed in the installed client (`AUTHJS/migrations/sign-out-global-keeps-session.md`, `GoTrueClient.ts:4107-4180`):

| Scope | Server | Client |
| --- | --- | --- |
| `global` (**default**) | deletes all sessions of the user | clears local session only if the server answered 2xx, 401, 403 or 404; **on a network error or 5xx the user stays signed in** and the error is returned |
| `local` | deletes this session | clears local session first, then calls the server |
| `others` | deletes all but this one | local session untouched |

`endSession()` calls `signOut()` with the default scope (`actions.ts:138-142`): it signs the person out of every device and app, and can leave the cookie in place if Auth is unreachable. A "Sign out" button normally wants `{ scope: "local" }`. Access tokens already issued stay valid until `exp`.

### 3.5 Rate limits

Server defaults (`GOTRUE/conf/configuration.go:489-499`, `GOTRUE/api/apilimiter/apilimiter.go:192-240`; docs https://supabase.com/docs/guides/auth/rate-limits). All per-IP buckets hold 30 tokens (burst) and answer `429 {"code":"over_request_rate_limit","message":"Request rate limit reached"}`.

| Endpoint | Limited by | Default |
| --- | --- | --- |
| `/signup`, `/recover`, `/resend`, `/otp`, `/magiclink`, `PUT /user` | IP | 30 per 5 minutes each |
| `/verify` | IP | 30 per 5 minutes |
| `/token` (all grant types, including password sign-in) | IP | 150 per 5 minutes |
| `/factors/*/challenge`, `/factors/*/verify` | IP | 15 per minute |
| any e-mail send | project-wide | built-in SMTP: 2 per hour; custom SMTP starts at 30 per hour, adjustable |
| confirmation / recovery / e-mail-change / reauthentication e-mail | same user | once per 60 s → `429 over_email_send_rate_limit` |

**Server-side callers share one IP bucket.** Auth sees the address of the Next.js server. The documented remedy is the `Sb-Forwarded-For` request header carrying the end-user IP; it is honoured only when the feature is enabled on the project **and the request is made with a secret key**, not a publishable or legacy key (rate-limits doc; `GOTRUE/sbff/sbff.go`; `configuration.go:940`). The same address is used for the MFA challenge/verify IP comparison (`GOTRUE/utilities/request.go:48-54`). The project currently keeps secret keys out of the apps, so this is a decision (see the structured summary). How stable a hosting provider's egress IP is between two invocations is **UNVERIFIED**; using `challengeAndVerify` in one action keeps both calls in one invocation.

---

## 4. Storage

### 4.1 Model

| Topic | Fact | Source |
| --- | --- | --- |
| Buckets | rows in `storage.buckets`: `id`, `name`, `public`, `file_size_limit` (bytes), `allowed_mime_types text[]`, `owner_id`, timestamps. Private by default | https://supabase.com/docs/guides/storage/schema/design, …/buckets/fundamentals |
| Objects | rows in `storage.objects`: `id uuid`, `bucket_id`, `name` (full path inside the bucket), `metadata jsonb`, `path_tokens text[]`, `version`, `owner_id text` (the uploader's `sub`; empty when uploaded with a secret key) | schema/design, …/security/ownership |
| **Public bucket** | anyone with the URL can **read**; upload, update, delete, move, copy and list still go through RLS | buckets/fundamentals |
| **Private bucket** | every operation goes through RLS; read with the user's JWT or a signed URL | buckets/fundamentals |
| Do not edit rows by SQL | deleting a row leaves the file (and its bill) behind; only `insert into storage.buckets` is a documented SQL write | schema/design, buckets/creating-buckets |
| Object names | letters, digits, `_ - . ' , ! * & $ @ = ; : + ? ( )` and spaces. Use generated names (uuid or content hash), never user file names | …/uploads/file-limits |
| Size | global limit: Free at most 50 MB, Pro up to 500 GB; per-bucket limit cannot exceed it; standard upload recommended up to 6 MB (hard cap 5 GB), larger via resumable (TUS) | file-limits, …/uploads/standard-uploads |
| Quota | Free 1 GB, Pro 100 GB then $0.0213 per GB-month | https://supabase.com/docs/guides/storage/pricing |

### 4.2 RLS needed per operation

RLS is enabled on `storage.objects` with no policies, so nothing is allowed until policies exist (https://supabase.com/docs/guides/storage/security/access-control). Requirements per client call are stated in the client's own doc comments:

| Client call | `storage.objects` privileges | Source |
| --- | --- | --- |
| `upload` (new file) | `INSERT` | `STJS/packages/StorageFileApi.ts:211-213` |
| `upload` with `upsert: true`, `update` | `SELECT` + `INSERT` + `UPDATE` | same; access-control doc |
| `createSignedUploadUrl` | `INSERT` (checked when the URL is created) | `StorageFileApi.ts:363-367` |
| `uploadToSignedUrl` | none (the token is the authorisation) | `StorageFileApi.ts:266-270` |
| `download`, `createSignedUrl(s)`, `info`, `list` | `SELECT` | `StorageFileApi.ts:694-697`, `902-906` |
| `remove` | `DELETE` + `SELECT` | `StorageFileApi.ts:1173-1177` |
| `getPublicUrl` | none (string building only) | `StorageFileApi.ts:1096-1101` |

Helper functions for policies (https://supabase.com/docs/guides/storage/schema/helper-functions): `storage.foldername(name)` returns the folders as `text[]` (`a/b/c.png` → `{a,b}`), `storage.filename(name)`, `storage.extension(name)`, and `storage.allow_only_operation('object.list')` / `storage.allow_any_operation(array[…])` to tell apart operations that all need `SELECT` (operation names: `STORAGE/http/routes/operations.ts`, e.g. `storage.object.list`, `storage.object.get_authenticated`, `storage.object.sign`, `storage.object.upload`).

### 4.3 Buckets and policies in a migration

```sql
-- Bucket: public read, images only, 5 MiB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: <seller uuid>/<listing uuid>/<random>.<ext>
create policy "sellers add their own product photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and (select private.is_seller_member(private.uuid_or_null((storage.foldername(name))[1])))
  );

create policy "sellers remove their own product photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-photos'
    and (select private.is_seller_member(private.uuid_or_null((storage.foldername(name))[1])))
  );

-- remove() also needs SELECT; restrict it so it cannot be used to list other shops.
create policy "sellers see their own product photo rows" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-photos'
    and (select private.is_seller_member(private.uuid_or_null((storage.foldername(name))[1])))
  );
```

`private.is_seller_member(uuid)` exists (`20261121080100_identity.sql:190`). `private.uuid_or_null(text)` does **not** exist yet: a bare `::uuid` cast on a non-UUID folder raises an error instead of returning false, so add a small safe-cast function. No `SELECT` policy is needed for the public to view images in a public bucket. The local Postgres has no `storage` schema; `supabase/scripts/local-shim.sql` needs a minimal one (tables above plus the three path helpers) for these migrations to apply locally. The `[storage.buckets.<name>]` section of `config.toml` also declares buckets for the local CLI stack (section 6); whether it is applied to a hosted project is **UNVERIFIED**, so keep the SQL as the source of truth.

Allowed MIME types are checked against the **declared** type of the upload (`STORAGE/storage/uploader.ts:608-618`, `644-653`), not the bytes. Treat the bucket rule as a first filter and keep photo moderation in the product flow.

### 4.4 HTTP surface used by `storage-js`

Base: `<SUPABASE_URL>/storage/v1`. Every call carries `apikey` and `Authorization` as in section 0.

| Client call | Method and path | Request | Success body |
| --- | --- | --- | --- |
| `from(b).upload(path, body, opts)` | `POST /object/{bucket}/{path}` | header `x-upsert: false\|true`. **Blob/File/FormData body:** `multipart/form-data` with fields `cacheControl` (seconds, default `3600`), optional `metadata` (JSON string), optional `contentEncoding`, then the file part named `""`. **Other bodies** (ArrayBuffer, Buffer, stream, string): raw body with `cache-control: max-age=3600`, `content-type: <opts.contentType, default text/plain;charset=UTF-8>`, optional `x-metadata: <base64 JSON>`; streams add `duplex: "half"` | `200 {"Id":"<uuid>","Key":"{bucket}/{path}"}` → client `{ id, path, fullPath }` |
| `update(path, body)` | `PUT /object/{bucket}/{path}` | as upload, without `x-upsert` | same |
| `createSignedUploadUrl(path, { upsert })` | `POST /object/upload/sign/{bucket}/{path}` | body `{}`; optional `x-upsert: true` | `200 {"url":"/object/upload/sign/{bucket}/{path}?token=<jwt>","token":"<jwt>"}` → client `{ signedUrl, token, path }` |
| `uploadToSignedUrl(path, token, body)` | `PUT /object/upload/sign/{bucket}/{path}?token=<jwt>` | as upload; `x-upsert` is sent but the choice was fixed when the URL was created | `200 {"Key":"{bucket}/{path}"}` |
| `createSignedUrl(path, expiresIn, { transform, download })` | `POST /object/sign/{bucket}/{path}` | `{"expiresIn":3600,"transform":{…}?}` | `200 {"signedURL":"/object/sign/{bucket}/{path}?token=<jwt>"}`; client prepends the base URL and appends `&download=…` |
| `createSignedUrls(paths, expiresIn)` | `POST /object/sign/{bucket}` | `{"expiresIn":3600,"paths":["a.jpg"]}` | `200 [{"error":null,"path":"a.jpg","signedURL":"/object/sign/…?token=…"}]` |
| `download(path)` | `GET /object/{bucket}/{path}` (with `transform`: `GET /render/image/authenticated/{bucket}/{path}?width=…`) | | file bytes |
| `info(path)` / `exists(path)` | `GET /object/info/{bucket}/{path}` | | JSON metadata; `exists` is false only for code `NoSuchKey` or a bare 404 |
| `remove([paths])` | `DELETE /object/{bucket}` | `{"prefixes":["a.jpg","b.jpg"]}` | `200 [ {FileObject}, … ]` |
| `list(prefix, opts)` | `POST /object/list/{bucket}` | `{"limit":100,"offset":0,"sortBy":{"column":"name","order":"asc"},"prefix":"…"}` | `200 [ … ]` |
| `move` / `copy` | `POST /object/move`, `POST /object/copy` | `{"bucketId","sourceKey","destinationKey","destinationBucket"?}` | `{"message":…}` / `{"Key":…}` |
| `getPublicUrl(path, { transform })` | no request | | `<base>/object/public/{bucket}/{path}` or `<base>/render/image/public/{bucket}/{path}?width=&height=&resize=&quality=&format=origin` |
| bucket admin | `GET /bucket`, `GET /bucket/{id}`, `POST /bucket` `{id,name,type,public,file_size_limit,allowed_mime_types}`, `PUT /bucket/{id}`, `POST /bucket/{id}/empty`, `DELETE /bucket/{id}` | | |

Sources: `STJS/packages/StorageFileApi.ts:24-37` (defaults), `78-148` (upload), `272-330`, `369-406`, `525-553`, `699-749`, `797-841`, `908-934`, `961-1041`, `1103-1134`, `1179-1197`, `1430-1444`, `1519-1549` (multipart layout), `1563-1605`; `STJS/packages/StorageBucketApi.ts:25-39`, `200-231`; `STJS/lib/common/fetch.ts:102-135`; server shapes `STORAGE/http/routes/object/createObject.ts:78-93`, `getSignedUploadURL.ts:92-101`, `uploadSignedObject.ts:103-104`, `getSignedURL.ts:88-92`.

Gotchas:

- With a `Blob`/`File`, the `contentType` option is **not sent**; the stored type is the Blob's own `type` (or a `contentType` form field you add yourself). With a `Buffer` or stream, forgetting `contentType` stores `text/plain` and an image-only bucket rejects it. (`StorageFileApi.ts:103-119`, `1519-1549`; `STORAGE/storage/uploader.ts:608`, `644`.)
- Signed upload URLs are documented as valid for 2 hours on the hosted platform (`StorageFileApi.ts:333-335`; https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl). The lifetime is a server setting, not a request parameter, and the open-source Storage server defaults it to **60 seconds** (`UPLOAD_SIGNED_URL_EXPIRATION_TIME`, `STORAGE/config.ts:512-517`); what the local CLI stack uses is **UNVERIFIED**. Create the URL immediately before the upload and never store it. The token is a JWT signed by Storage with payload `{ owner, url: "<bucket>/<path>", upsert, scope: "upload", exp }` (`STORAGE/storage/object.ts:1976-2005`, `STORAGE/internal/auth/jwt.ts:48-49`; download tokens carry `scope: "download"`). The uploader needs no session, so a browser or phone can `PUT` the file directly while the Server Action only creates the URL after checking who is asking. This suits the "no token in the browser" design.
- Since 2.119.2 a path that escapes the bucket (`../other/x`) fails locally without a request (`STJS/migrations/url-path-boundaries.md`).
- Duplicate path without upsert is a conflict; use fresh names instead of overwriting, because CDN and browsers keep the old bytes (standard-uploads doc).
- The current server also returns a `version` field next to `Id`/`Key` on upload responses (`createObject.ts:90-94`, `uploadSignedObject.ts:103-106`); storage-js ignores it.
- `createSignedUploadUrl` runs the same permission probe as a real upload, as the caller, at signing time (`object.ts:1987-1995`, `STORAGE/storage/uploader.ts:90-128`); with `upsert: true` the probe is an upsert, so the caller then also needs `SELECT` and `UPDATE`.

Error body (`STORAGE/internal/errors/storage-error.ts:90-97` `render()`, `STORAGE/http/error-handler.ts:71-87`):

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"statusCode":"404","code":"NoSuchKey","error":"not_found","message":"Object not found"}
```

Three things in that example are easy to get wrong:

- **The HTTP status is 400 for every error that is not a 500.** Each Storage error is built with `userStatusCode = httpStatusCode === 500 ? 500 : 400` (`storage-error.ts:19-23`) and the application registers the error handler without the option that would honour the real status (`STORAGE/app.ts:110`, `error-handler.ts:73-79`). The real status travels as the **string** `statusCode` in the body. Whether the hosted platform overrides this was not tested against a live project (**UNVERIFIED**); the source is unambiguous.
- **`error` is a legacy label, not the code**, wherever the server defines one: `not_found` (NoSuchKey), `Bucket not found` (NoSuchBucket), `Unauthorized` (AccessDenied), `Duplicate` (KeyAlreadyExists and ResourceAlreadyExists), `invalid_mime_type` (InvalidMimeType), `Payload too large` (EntityTooLarge). Only errors without a label repeat the code there (`error-handler.ts:81-86`, `STORAGE/internal/errors/codes.ts`).
- **`code` is the only stable field.** Client: `StorageApiError { status: <HTTP status>, statusCode: <body.statusCode>, code: <body.code>, message }` (`STJS/lib/common/fetch.ts:51-92`). Branch on `error.code`; never on `error.status`, and treat `error.statusCode` as a hint.

Codes to expect. "Body `statusCode`" is what the current server source sends; the documentation table (https://supabase.com/docs/guides/storage/debugging/error-codes) disagrees on three rows, shown in the last column:

| `code` | Body `statusCode` (server source, `codes.ts`) | Docs table | When |
| --- | --- | --- | --- |
| `NoSuchBucket` | 404 | 404 | bucket missing; also a private bucket requested through `/object/public/…` (the route looks the bucket up with `public = true`, `getPublicObject.ts:59-61`, `STORAGE/storage/database/pg.ts:693-717`) |
| `NoSuchKey` | 404 | 404 | object missing or hidden by RLS |
| `AccessDenied` | 403 | 403 | RLS refused the write ("new row violates row-level security policy", `STORAGE/storage/database/errors.ts:18-24`) |
| `KeyAlreadyExists` | 409 | 409 | **duplicate upload without upsert** (`uploader.ts:277-279`, `STORAGE/storage/database/pg.ts:1727-1730`) |
| `ResourceAlreadyExists` | 409 | 409 | other unique violations (for example creating a bucket that exists). Treat both codes as "duplicate" in app code |
| `EntityTooLarge` | 413 | 413 | over the bucket or global size limit |
| `InvalidMimeType` | **415** | 400 | declared type not in `allowed_mime_types` ("mime type X is not supported") |
| `InvalidKey` | 400 | 400 | object name with forbidden characters |
| `InvalidJWT` | **400** | 401 | `Authorization` token, or a signed-URL token, fails verification |
| `InvalidSignature` | **400** | 403 | signed-URL token is valid but for another path or the wrong scope (upload vs download) (`object.ts:2030-2040`) |
| `ExpiredToken` | 400 | not listed | signed-URL token past `exp` ("The provided token has expired.", `object.ts:2042-2044`; an expired JWT may already be reported as `InvalidJWT` by the verification step) |
| `SlowDown` | 429 on the database-connection path (`error-handler.ts:60-68`) | 503 | throttling |

### 4.5 Serving, cache and image transformations

| Topic | Fact | Source |
| --- | --- | --- |
| Browser cache | `cacheControl: "<seconds>"` at upload becomes `Cache-Control: max-age=<seconds>`; client default 3600; if nothing is sent the server stores `no-cache` | `StorageFileApi.ts:33-37`, `110`; `uploader.ts:609`, `645` |
| CDN | all objects are served through a CDN; public buckets cache far better than private ones (per-user checks) | https://supabase.com/docs/guides/storage/cdn/fundamentals |
| Smart CDN | Pro and above: cached "as long as possible" and invalidated automatically within about 60 s of update/delete; browsers still keep their copy until `max-age` ends | https://supabase.com/docs/guides/storage/cdn/smart-cdn |
| Signed URLs | each token is its own cache key; expiry of the token does not purge an edge-cached response. Reuse a signed URL rather than minting one per request | smart-cdn |
| Immutable names | for product photos use a new path per version and a long `cacheControl` (for example one year) | smart-cdn ("upload the new asset to a different path") |
| Image transformations | **Pro plan and above**, toggled in Storage settings; 100 origin images per month included on Pro and Team, then **$5 per 1,000 origin images**; the count resets each billing cycle (how an "origin image" is counted is defined on the linked usage page, which was not opened) | https://supabase.com/docs/guides/storage/serving/image-transformations ("Pricing"), storage/pricing |
| Transformation options | `width`, `height` 1-2500; `resize` `cover` (default) / `contain` / `fill`; `quality` 20-100 (default 80); automatic WebP unless `format=origin`; source at most 25 MB and 50 megapixels | image-transformations ("Limits", "Transformation options"); `STJS/lib/types.ts:480-509` |
| Next.js | custom loader returning `https://<ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=…&quality=…` | image-transformations ("Next.js loader") |
| Free plan | no transformations: serve `object/public/...` originals, so resize before upload or accept originals | image-transformations (plan note) |

---

## 5. Edge Functions

| Topic | Fact | Source |
| --- | --- | --- |
| Layout | `supabase/functions/<name>/index.ts`; one `deno.json` per function (import maps are legacy); shared code in `supabase/functions/_shared/`; tests in `supabase/functions/tests/` | https://supabase.com/docs/guides/functions/dependencies, …/development-environment, …/quickstart |
| Runtime | Supabase Edge Runtime (Deno-compatible), TypeScript; `npm:`, `jsr:` and `node:` specifiers work. Deno **major version 2**: the CLI config template sets `[edge_runtime] deno_version = 2` ("The Deno major version to use"). The exact minor version on the hosted platform is **UNVERIFIED** (the note's earlier `deno_core 0.324.0` pin was not re-checked) | quickstart, dependencies; `https://raw.githubusercontent.com/supabase/cli/v2.90.0/pkg/config/templates/config.toml:364-373` |
| Entry point | `Deno.serve(handler)` or **`export default { fetch: handler }`**; the docs call the second "portable across Edge Functions, Cloudflare Workers, and Bun" | https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys (Step 4, Option 2) |
| Secrets | `Deno.env.get("NAME")`. Local: `supabase/functions/.env` (git-ignored) or `[edge_runtime.secrets]` in `config.toml`. Production: dashboard or `supabase secrets set --env-file .env`; available without redeploy. Names must not start with `SUPABASE_`; at most 100 secrets, 48 KiB each | https://supabase.com/docs/guides/functions/secrets, …/limits |
| Injected variables | `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (**JSON objects keyed by key name**, e.g. `JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!).default`), `SUPABASE_JWKS`; legacy `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; hosted only: `SB_REGION`, `SB_EXECUTION_ID`, `DENO_DEPLOYMENT_ID` | functions/secrets ("Default secrets") |
| `verify_jwt` | default `true`: the platform rejects requests without a valid user JWT in `Authorization` (HS256 or signing-key JWTs) with 401 before the code runs. The auth-headers page says the check also lets through `sb_` keys on either header for migration, so it authenticates nobody by itself; the key-migration page says the opposite for `Authorization: Bearer sb_…` (rejected with "Invalid JWT"). The two pages disagree, so do not depend on either: set `[functions.<name>] verify_jwt = false` for provider webhooks and key-only callers, send keys on `apikey` only, and check in code | https://supabase.com/docs/guides/functions/auth-headers, …/function-configuration, https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys ("Edge Functions") |
| Elevated database access | call the Data API with a **secret key on the `apikey` header only** (a `Bearer sb_secret_…` is not a JWT), or connect with `SUPABASE_DB_URL`. Secret keys map to the `service_role` Postgres role (bypasses RLS, still needs `GRANT EXECUTE`). `@supabase/server`'s `withSupabase({ auth })` wraps this; modes `user`, `secret`, `publishable`, `none` | migrating-to-new-api-keys; https://supabase.com/docs/guides/functions/auth; https://supabase.com/docs/guides/getting-started/api-keys |
| Limits | memory 256 MB; CPU time 2 s (time actually on the CPU, async I/O excluded); wall clock 150 s (Free) / 400 s (paid); response must start within 150 s or 504; bundle 20 MB when bundled by the CLI (5 MB when bundled server-side through the dashboard or Management API); **outgoing ports 25 and 587 are blocked** (send mail through an HTTP API, not SMTP); HTML responses rewritten to `text/plain` without a custom domain; no `sharp`/libvips | functions/limits |
| Price | 500,000 invocations on Free, 2 million on Pro, then $2 per million | https://supabase.com/docs/guides/functions/pricing |
| Client call | `supabase.functions.invoke(name, { body })` → `POST /functions/v1/<name>`; JSON bodies get `Content-Type: application/json`; a response header `x-relay-error: true` means the platform, not the function, failed | `FNJS/FunctionsClient.ts` (`invoke`) |

### 5.1 Webhook handler that also runs under Node 22

Keep the logic in a module that touches only web-standard globals (`Request`, `Response`, `fetch`, `crypto.subtle`, `TextEncoder`), all of which Node 22 has, and keep Deno-only code (`Deno.env`, `npm:` imports) in a thin entry file.

```ts
// supabase/functions/payment-webhook/handler.ts  (no Deno.*, no npm: imports)
export interface Env { webhookSecret: string; supabaseUrl: string; secretKey: string }

const hexToBytes = (hex: string) =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 1. Read the raw bytes ONCE, before any parsing. The signature covers these bytes.
  const raw = new Uint8Array(await req.arrayBuffer());

  // 2. HMAC-SHA256 over the raw body; crypto.subtle.verify compares in constant time.
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.webhookSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = hexToBytes(req.headers.get("x-signature") ?? "");
  if (!(await crypto.subtle.verify("HMAC", key, signature, raw))) {
    return new Response("bad signature", { status: 400 });
  }

  // 3. Only now parse, and hand the event to a database function (idempotent on the event id).
  const event = JSON.parse(new TextDecoder().decode(raw));
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/record_payment_event`, {
    method: "POST",
    headers: { apikey: env.secretKey, "content-type": "application/json" },
    body: JSON.stringify({ p_event: event }),
  });
  return res.ok ? Response.json({ received: true }) : new Response("try again", { status: 500 });
}
```

```ts
// supabase/functions/payment-webhook/index.ts  (Deno entry; nothing to test here)
import { handle } from "./handler.ts";
export default {
  fetch: (req: Request) => handle(req, {
    webhookSecret: Deno.env.get("PAYMENT_WEBHOOK_SECRET")!,
    supabaseUrl: Deno.env.get("SUPABASE_URL")!,
    secretKey: JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!).default,
  }),
};
```

```toml
# supabase/config.toml
[functions.payment-webhook]
verify_jwt = false
```

A Node test imports `handle` and calls it with `new Request(url, { method: "POST", body, headers })` and a stubbed `fetch`. The header name, encoding (hex or base64) and whether a timestamp is part of the signed string depend on the gateway; add a timestamp tolerance check if the provider signs one. The Supabase example for Stripe shows the same two rules, read `await req.text()` first and use the async WebCrypto verifier (functions/auth, "External webhooks"). The database function must be granted to `service_role` and revoked from `anon`/`authenticated`.

### 5.2 Scheduling with `pg_cron` + `pg_net`

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<a secret key>', 'secret_key');

select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/notify-outbox',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')),
    body    := '{}'::jsonb) as request_id;
$$);
```

The function needs `verify_jwt = false` and must check the key itself (`auth: 'secret'`). The decrypted key sits in `net.http_request_queue` until the request is sent, readable by any role that can log in to the database. Source: https://supabase.com/docs/guides/functions/schedule-functions. Vault secrets are data, not migrations: creating them is a deploy step for the owner.

---

## 6. Project configuration as code, and API keys

### 6.1 `supabase/config.toml`

Keys and defaults from the CLI configuration reference (https://supabase.com/docs/guides/local-development/cli/config). The repository has no `config.toml` yet.

```toml
[auth]
site_url = "https://<shop host>"                       # default "http://localhost:3000"
additional_redirect_urls = [                           # exact URLs; wildcards * and ** allowed
  "https://<shop host>/auth/confirm", "https://<seller host>/auth/confirm",
  "https://<ops host>/auth/confirm",  "https://<field host>/auth/confirm"]
jwt_expiry = 3600                                      # seconds, max 604800
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10                      # seconds
enable_signup = true
minimum_password_length = 8            # CLI default 6; "Minimum 6, recommended 8 or more"
password_requirements = ""             # "" | letters_digits | lower_upper_letters_digits | lower_upper_letters_digits_symbols

[auth.rate_limit]
email_sent = 2                 # per hour; only adjustable with custom SMTP
sign_in_sign_ups = 30          # per 5 min per IP
token_verifications = 30       # per 5 min per IP
token_refresh = 150            # per 5 min per IP

[auth.email]
enable_signup = true
enable_confirmations = true    # CLI default false; decide (section 1.3)
double_confirm_changes = true
secure_password_change = false
require_current_password = false
max_frequency = "1m"
otp_length = 6                 # 6 to 10
otp_expiry = 3600              # seconds

[auth.email.smtp]              # host, port, user, pass, admin_email, sender_name
pass = "env(SMTP_PASSWORD)"    # never a literal

[auth.email.template.recovery]       # types: invite, confirmation, recovery, magic_link, email_change, reauthentication
subject = "Restablezca su contraseña"
content_path = "./supabase/templates/recovery.html"

[auth.email.notification.password_changed]   # also email_changed, mfa_factor_enrolled, mfa_factor_unenrolled, …
enabled = true

[auth.mfa]
max_enrolled_factors = 10
[auth.mfa.totp]
enroll_enabled = true          # CLI default false; hosted projects have TOTP on by default
verify_enabled = true

[auth.sessions]                # Pro plan and above
# timebox = "24h"
# inactivity_timeout = "8h"

[storage]
file_size_limit = "50MiB"
[storage.buckets.product-photos]
public = true
file_size_limit = "5MiB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp"]

[edge_runtime.secrets]
PAYMENT_WEBHOOK_SECRET = "env(PAYMENT_WEBHOOK_SECRET)"

[functions.payment-webhook]
verify_jwt = false

[local_smtp]                   # local mail catcher (web UI on 54324); called [inbucket] before CLI 2.108
enabled = true
```

Notes:

- Password strength (minimum length, required character classes, leaked-password check) is documented as a dashboard setting; the leaked-password check needs Pro (https://supabase.com/docs/guides/auth/password-security). The `config.toml` keys are `[auth] minimum_password_length` (default 6) and `password_requirements` (default `""`; values `letters_digits`, `lower_upper_letters_digits`, `lower_upper_letters_digits_symbols`); they are missing from the reference page but present in the CLI's own config template (`https://raw.githubusercontent.com/supabase/cli/v2.90.0/pkg/config/templates/config.toml:173-178`; the template of the newest CLI release was not opened, so re-check with `supabase init` output). No key for the leaked-password check was found (**UNVERIFIED**). The server caps passwords at 72 bytes (bcrypt) and counts the minimum in characters, not bytes, since v2.198.0 (`GOTRUE/api/password.go:14`, `32-45`; CHANGELOG).
- Hosted settings can be applied without the dashboard through the Management API: `PATCH https://api.supabase.com/v1/projects/<ref>/config/auth` with keys such as `mailer_subjects_recovery`, `mailer_templates_recovery_content`, `rate_limit_otp`, `rate_limit_verify`, `rate_limit_token_refresh`, `rate_limit_email_sent`, `security_sb_forwarded_for_enabled` (auth-email-templates and rate-limits docs). Whether `supabase config push` covers all of these is **UNVERIFIED**.
- `content_path` base directory: the documentation shows both `"./supabase/templates/invite.html"` and `"./templates/password_changed_notification.html"` in the same guide (https://supabase.com/docs/guides/local-development/customizing-email-templates), so which directory the path is relative to is **UNVERIFIED**; confirm with `supabase start` before relying on it. Template changes need a restart of the local containers (same page).
- Built-in SMTP: refuses addresses that are not members of the Supabase organisation ("Email address not authorized") and is limited to 2 messages per hour. Custom SMTP lifts the restriction and starts at 30 per hour (https://supabase.com/docs/guides/auth/auth-smtp).

### 6.2 API keys today

| Key | Form | Maps to | Where |
| --- | --- | --- | --- |
| Publishable | `sb_publishable_<22 chars>_<8-char checksum>` | `anon` role, or `authenticated` when a user JWT is also sent | anything shipped: browsers, the Next.js apps, mobile apps |
| Secret | `sb_secret_<…>` | `service_role` (bypasses RLS) | servers you control, Edge Functions, cron. Rejected with 401 when the `User-Agent` looks like a browser. Several named keys can exist and be revoked independently |
| `anon` / `service_role` (legacy) | long JWT starting `eyJ` | same roles | **deprecated "by the end of 2026"**; do not start with them |

Rules: new keys are not JWTs; put them in `apikey`. supabase-js copies the publishable key into `Authorization` when there is no session and the gateway tolerates that, but a hand-written `Bearer sb_secret_…` (for example from `pg_net`) is rejected. Edge Functions do not validate the `apikey` of new keys for you. Sources: https://supabase.com/docs/guides/getting-started/api-keys, https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys, https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys. User tokens are signed with rotatable signing keys (ES256 recommended) published at the JWKS endpoint; verify with `getClaims()` (https://supabase.com/docs/guides/auth/signing-keys). The stand-in's ES256 key and `sb_publishable_local_development_only` key already follow this model (`tools/dev-api/src/context.ts:18-19`, `39-56`).

---

## 7. Checklist: what `tools/dev-api` must implement to be a faithful stand-in

### 7.1 Differences to fix in what exists today

| # | Today (`tools/dev-api/src/routes/auth.ts` = `A`, `tools/dev-api/src/context.ts` = `C`; the stand-in was split into these files after the first draft of this note) | Real behaviour | Why it matters |
| --- | --- | --- | --- |
| 1 | Refresh token deleted on first use (`A:125`); tokens live in an in-memory map and die with the process (`A:20-21`) | reuse allowed for 10 s; parent-of-active accepted; otherwise `refresh_token_already_used` and the session ends | false sign-outs locally, or bugs that only appear in production |
| 2 | New `session_id` on every token (`A:63`) | one id per session, kept across refresh and MFA | logout scopes, MFA, "other sessions" logic |
| 3 | `aal` defaults to `aal1`, no `amr`, no `phone` claim (`A:58-68`; `issueSession(user, extra)` already accepts claim overrides) | `aal`/`amr` from the session; `phone: ""` | staff MFA cannot be tested |
| 4 | `POST /logout` answers 204 and revokes nothing, no auth (`A:183-186`) | needs a Bearer token; revokes per `scope`; 401/403 otherwise | signed-out refresh tokens keep working |
| 5 | Sign-up always confirms and signs in (`A:136-171`); short password or bad e-mail → `422 validation_failed` (`A:142-148`) | confirmation mode returns a bare user; weak password → `422 weak_password` with reasons; bad e-mail → `400 validation_failed` | confirmation flow untestable; wrong error branch |
| 6 | Errors always in legacy shape `{code:<number>,error_code,msg}` | versioned shape when the request has `X-Supabase-Api-Version` (section 3.1) | both parse today; the new shape is what production sends |
| 7 | Bad token on an Auth route → `401 {code:"PGRST301"}` (`C:135-137`); `GET /user` without a user → `401 no_authorization` (`A:176-178`) | `403 bad_jwt` on Auth routes (the PostgREST answer is right only for `/rest/v1`) | `signOut` and `getUser` branch on status and code |
| 8 | Unknown `grant_type` → `validation_failed` (`A:129-133`) | `400 invalid_credentials` "unsupported_grant_type" | minor |
| 9 | No `Cache-Control` on JWKS | `public, max-age=600` | minor |
| 10 | `publicUser` has `identities: []` and no `factors` (`A:40-53`) | one `email` identity; `factors` when present | the empty-identities check for "already registered" (section 1.3) would misfire |
| 11 | CORS allow-list already has `x-upsert` and `cache-control` but lacks `x-metadata`, `content-encoding`, `x-region`; nothing exposed (`C:69-75`) | gateway allows all headers | only matters once a browser uploads directly |

### 7.2 State to add

New route groups go in `tools/dev-api/src/routes/<area>.ts` and are registered in `routes/index.ts`; `context.ts` already offers `readBody(req, limit)` and `sendBytes(...)` for Storage (`C:84-104`). Persist in the local database (shim tables named like the real ones, so SQL that reads `auth.mfa_factors` or `auth.sessions` also works locally): `auth.sessions (id, user_id, aal, created_at, refreshed_at)`, `auth.refresh_tokens (token, session_id, parent, revoked, updated_at)`, `auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)`, `auth.mfa_challenges (id, factor_id, ip_address, created_at, verified_at)`, `auth.mfa_amr_claims (session_id, authentication_method, created_at, updated_at)`, one-time tokens `(user_id, token_type, token_hash, relates_to, created_at)`, and a `storage` schema (section 4.3). Add a development-only outbox, for example `GET /dev/mail?to=<address>`, returning the last message with its `token`, `token_hash` and link so browser tests can follow e-mail links. Make "confirm e-mail" and "require current password" switchable by environment variable.

### 7.3 Auth endpoints

Every error: `{"code":"<error_code>","message":"…"}` plus response header `X-Supabase-Api-Version: 2024-01-01` when the request sent that header, else `{"code":<status>,"error_code":"…","msg":"…"}`. "Session JSON" means `{"access_token","token_type":"bearer","expires_in":3600,"expires_at":<unix>,"refresh_token","user":{…}}`.

| Endpoint | Request | Success | Errors to imitate |
| --- | --- | --- | --- |
| `GET /auth/v1/.well-known/jwks.json` | | `200 {"keys":[{kty,crv,x,y,kid,alg:"ES256",use:"sig"}]}`, `Cache-Control: public, max-age=600` | |
| `POST /auth/v1/signup?redirect_to=` | `{email,password,data,code_challenge?,code_challenge_method?}` | autoconfirm: session JSON. Confirm mode: `200` user JSON (no tokens), store a `confirmation` token, write the mail. Existing confirmed + confirm mode: `200` fake user with `identities: []` | `400 validation_failed` (e-mail), `422 weak_password` + `weak_password.reasons`, `422 user_already_exists` (autoconfirm only), `429 over_email_send_rate_limit` (< 60 s) |
| `POST /auth/v1/token?grant_type=password` | `{email,password}` | session JSON (new session row, `aal1`, `amr` `password`) | `400 invalid_credentials` "Invalid login credentials"; `400 email_not_confirmed` (after the password matched); `400 validation_failed` "missing email or phone" |
| `POST /auth/v1/token?grant_type=refresh_token` | `{refresh_token}` | session JSON, same `session_id`, `aal`, `amr` | rules of section 3.3: `400 refresh_token_not_found`, `400 refresh_token_already_used`, `400 session_not_found` |
| `POST /auth/v1/token?grant_type=pkce` | `{auth_code,code_verifier}` | session JSON | `404 flow_state_not_found`, `422 flow_state_expired` (5 min), `400 bad_code_verifier` (only needed if default templates are used) |
| `POST /auth/v1/recover?redirect_to=` | `{email,code_challenge?,code_challenge_method?}` | `200 {}` always; if the user exists store a `recovery` token (prefix `pkce_` when a challenge was sent) and write the mail | `400 validation_failed`, `429 over_email_send_rate_limit` |
| `POST /auth/v1/resend?redirect_to=` | `{email,type:"signup"\|"email_change"}` | `200 {}` | `400 validation_failed`, `429 over_email_send_rate_limit` |
| `POST /auth/v1/verify` | `{token_hash,type}` or `{email,token,type}`; types `signup`, `email`, `recovery`, `magiclink`, `invite`, `email_change` | session JSON (`amr` `otp`); marks the address confirmed; consumes the token. First of two e-mail-change confirmations: `200 {"msg":"Confirmation link accepted. Please proceed to confirm link sent to the other email","code":"200"}` | `403 otp_expired` "Email link is invalid or has expired"; `400 validation_failed` (extra fields with `token_hash`) |
| `GET /auth/v1/verify?token=&type=&redirect_to=` | | `303` to `redirect_to#access_token=…` (implicit) or `redirect_to?code=…` (token starts `pkce_`); errors as `?error=access_denied&error_code=otp_expired&error_description=…` | optional; only for default templates |
| `GET /auth/v1/user` | Bearer user token | `200` user JSON incl. `factors`, `identities` | `401 no_authorization` (no Bearer); `403 bad_jwt`; `403 session_not_found`; `403 user_not_found` |
| `PUT /auth/v1/user?redirect_to=` | Bearer; `{password?,email?,data?,nonce?,current_password?}` | `200` user JSON; password change deletes the user's other sessions; `data` merged into metadata; e-mail change sets `new_email` and writes mail | `422 weak_password`, `422 same_password`, `401 insufficient_aal` (verified factor + `aal1`), `422 email_exists`, `400 current_password_required`, `400 reauthentication_needed` |
| `GET /auth/v1/reauthenticate` | Bearer | `200 {}`; writes a 6-digit code to the outbox | `429 over_email_send_rate_limit` |
| `POST /auth/v1/logout?scope=` | Bearer | `204`; delete this session (`local`), all (`global`, default) or all others (`others`) | `401 no_authorization`, `403 bad_jwt`, `403 session_not_found`, `400 validation_failed` (scope) |
| `POST /auth/v1/factors` | Bearer; `{factor_type:"totp",friendly_name?,issuer?}` | `200 {"id","type":"totp","friendly_name","totp":{"qr_code":"<svg>","secret":"<base32 32 chars>","uri":"otpauth://totp/…"}}` | `422 mfa_factor_name_conflict`, `422 too_many_enrolled_mfa_factors`, `403 insufficient_aal` |
| `POST /auth/v1/factors/{id}/challenge` | Bearer; `{factorId}` (ignore body) | `200 {"id","type":"totp","expires_at":<now+300>}` | unknown or foreign factor id: `404 mfa_factor_not_found` "Factor not found"; non-UUID id: `404 validation_failed` (same on verify and delete) |
| `POST /auth/v1/factors/{id}/verify` | Bearer; `{challenge_id,code}` | session JSON: **new** access and refresh token, same `session_id`, `aal: "aal2"`, `amr` with `totp` first; factor → `verified`; delete the user's other `aal1` sessions; the pre-verify refresh token stops working | `422 mfa_verification_failed` "Invalid TOTP code entered"; `422 mfa_challenge_expired`; `422 mfa_ip_address_mismatch` (also for a reused challenge); `400 validation_failed` (empty code) |
| `DELETE /auth/v1/factors/{id}` | Bearer | `200 {"id"}`; sessions back to `aal1` (next token) | `422 insufficient_aal` (verified factor from `aal1`) |

TOTP check: RFC 6238, SHA-1, 6 digits, 30 s, accept steps −1, 0, +1 (Node's `crypto.createHmac("sha1", key)` over the 8-byte big-endian counter; base32-decode the secret first).

### 7.4 Storage endpoints

Authorise exactly like `callRpc` does (`tools/dev-api/src/rpc.ts:127-135`): run the `insert` / `select` / `update` / `delete` on `storage.objects` in a transaction as `anon` or `authenticated` with `request.jwt.claims` set, so the real policies decide; write the bytes to a git-ignored directory only after the row operation succeeded. Enforce `file_size_limit` and `allowed_mime_types` from `storage.buckets`. Error response, as the real server sends it (section 4.4): **HTTP 400** (500 only for internal errors) with body `{"statusCode":"<n>","code":"<Code>","error":"<legacy label or Code>","message":"…"}`. The numbers in the "Errors" column below are the body `statusCode`, not the HTTP status.

| Endpoint | Request | Success | Errors |
| --- | --- | --- | --- |
| `POST /storage/v1/object/{bucket}/{path}` | `x-upsert`; multipart (`cacheControl`, `metadata?`, file part) **or** raw body with `content-type`, `cache-control: max-age=N`, `x-metadata?` | `200 {"Id":"<uuid>","Key":"bucket/path"}`; set `owner_id` = `sub` | `NoSuchBucket` 404; `AccessDenied` 403 (RLS); `KeyAlreadyExists` 409 (no upsert); `EntityTooLarge` 413; `InvalidMimeType` 415; `InvalidJWT` 400 |
| `PUT /storage/v1/object/{bucket}/{path}` | as above | same | `NoSuchKey` 404 |
| `POST /storage/v1/object/upload/sign/{bucket}/{path}` | `{}`, `x-upsert?` | `200 {"url":"/object/upload/sign/{bucket}/{path}?token=<jwt>","token":"<jwt>"}`; requires the INSERT policy to pass for the caller; token = stand-in-signed JWT `{url: "bucket/path", owner, upsert, scope: "upload", exp}`; make the lifetime configurable (hosted: 2 h per docs; open-source server default 60 s) | `AccessDenied` 403; `KeyAlreadyExists` 409 |
| `PUT /storage/v1/object/upload/sign/{bucket}/{path}?token=` | as upload; no session needed | `200 {"Key":"bucket/path"}` | bad signature: `InvalidJWT` 400; token for another path or a download token: `InvalidSignature` 400; expired: `ExpiredToken` 400 (or `InvalidJWT`) |
| `GET /storage/v1/object/public/{bucket}/{path}` | none | bytes with stored `Content-Type` and `Cache-Control` | `NoSuchBucket`/`NoSuchKey` 404; a bucket that is not public answers `NoSuchBucket` 404 |
| `GET /storage/v1/object/{bucket}/{path}` | Bearer | bytes (SELECT policy) | `NoSuchKey` 404 (also when RLS hides the row) |
| `POST /storage/v1/object/sign/{bucket}/{path}` | `{expiresIn}` | `200 {"signedURL":"/object/sign/{bucket}/{path}?token=<jwt>"}` | `NoSuchKey` 404 |
| `POST /storage/v1/object/sign/{bucket}` | `{expiresIn,paths}` | `200 [{"error":null,"path","signedURL"}]` | |
| `GET /storage/v1/object/sign/{bucket}/{path}?token=` | none | bytes | as for the signed upload route: `InvalidJWT` 400, `InvalidSignature` 400 (wrong path or an upload token), `ExpiredToken` 400 |
| `GET /storage/v1/object/info/{bucket}/{path}` | Bearer | JSON metadata (`id`, `version`, `name`, `bucket_id`, `created_at`, `size`, `cache_control`, `content_type`, `content_encoding`, `etag`, `last_modified`; `STJS/lib/types.ts` `FileObjectV2`) | `NoSuchKey` 404 |
| `DELETE /storage/v1/object/{bucket}` | `{prefixes:[…]}` | `200 [ {name, id, bucket_id, …} ]` for rows actually deleted (RLS-filtered) | |
| `POST /storage/v1/object/list/{bucket}` | `{prefix,limit,offset,sortBy}` | `200 [ … ]` | |
| `GET /storage/v1/render/image/public/{bucket}/{path}?width=…` | none | serve the original bytes unchanged (documented as a stand-in shortcut) | |

Raise the body limit for Storage routes (Auth and RPC keep 1 MB, which matches Auth's own limit, `GOTRUE/api/api.go` `limitRequestBody(1 << 20)`).

### 7.5 Edge Functions

`POST /functions/v1/<name>`: import `supabase/functions/<name>/handler.ts` and call its exported handler with a web `Request` built from the incoming message, passing environment values from the process. Apply `verify_jwt` from `config.toml`: when true, answer `401` unless `Authorization` holds a verifiable user JWT or the request carries the project's `sb_` key (supabase-js sends only `apikey`, no `Authorization`, when there is no session and the key is new-format, `SBJS/lib/fetch.ts:77-95`, and the platform check lets such requests through per the auth-headers page). This keeps one code path for local runs, tests and production.

---

## Sources

Installed packages (read on disk):

- `AUTHJS/GoTrueClient.ts`, `AUTHJS/GoTrueAdminApi.ts`, `AUTHJS/lib/fetch.ts`, `AUTHJS/lib/helpers.ts`, `AUTHJS/lib/constants.ts`, `AUTHJS/lib/error-codes.ts`, `AUTHJS/lib/errors.ts`, `AUTHJS/lib/types.ts`, and `…/auth-js/migrations/lockless-coordination.md`, `…/auth-js/migrations/sign-out-global-keeps-session.md`
- `SSR/createServerClient.ts`, `SSR/cookies.ts`, `SSR/types.ts`, `SSR/utils/constants.ts`, `SSR/utils/chunker.ts`, `…/ssr/CHANGELOG.md`
- `SBJS/SupabaseClient.ts`, `SBJS/lib/fetch.ts`, `SBJS/lib/constants.ts`
- `STJS/packages/StorageFileApi.ts`, `STJS/packages/StorageBucketApi.ts`, `STJS/StorageClient.ts`, `STJS/lib/common/fetch.ts`, `STJS/lib/types.ts`, `…/storage-js/migrations/url-path-boundaries.md`
- `FNJS/FunctionsClient.ts`

Repository files: `tools/dev-api/src/server.ts`, `tools/dev-api/src/context.ts`, `tools/dev-api/src/routes/{index,auth,rest}.ts`, `tools/dev-api/src/rpc.ts`, `supabase/scripts/local-shim.sql`, `supabase/migrations/20261121080100_identity.sql`, `packages/next-kit/src/server/{supabase,session,proxy,actions}.ts`.

Supabase Auth server, `https://raw.githubusercontent.com/supabase/auth/master/` (v2.198.0): `CHANGELOG.md`, `internal/api/{api,auth,errors,apiversions,helpers,recover,verify,user,password,reauthenticate,signup,resend,token,token_refresh,logout,mfa,mail,pkce,jwks,middleware}.go`, `internal/api/apierrors/{apierrors,errorcode}.go`, `internal/api/apilimiter/apilimiter.go`, `internal/tokens/service.go`, `internal/models/{user,sessions,amr,factor,identity}.go`, `internal/conf/configuration.go`, `internal/crypto/crypto.go`, `internal/sbff/sbff.go`, `internal/utilities/request.go`; added by the fact-check: `internal/api/admin.go` (`loadFactor`), `internal/api/helpers.go` (`retrieveRequestParams`).

Other source: `https://raw.githubusercontent.com/pquerna/otp/master/totp/totp.go`; Supabase Storage server `https://raw.githubusercontent.com/supabase/storage/master/src/`: `http/routes/operations.ts`, `http/error-handler.ts`, `internal/errors/{render,storage-error}.ts`, `http/routes/object/{createObject,getSignedUploadURL,uploadSignedObject,getSignedURL,deleteObjects}.ts`, `storage/uploader.ts`, `config.ts`; added by the fact-check: `app.ts`, `internal/errors/codes.ts`, `internal/auth/jwt.ts`, `storage/object.ts`, `storage/database/{pg,errors}.ts`, `http/routes/object/{getPublicObject,getSignedObject}.ts`; `https://raw.githubusercontent.com/supabase/edge-runtime/main/Cargo.toml` (not re-opened by the fact-check); Supabase CLI config template `https://raw.githubusercontent.com/supabase/cli/v2.90.0/pkg/config/templates/config.toml`; https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl.

Supabase documentation (opened 21 Nov 2026; the last group through the Supabase docs search tool, the rest as `<url>.md`):

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/local-development/customizing-email-templates
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/auth/jwt-fields
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys
- https://supabase.com/docs/guides/self-hosting/self-hosted-envoy
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/security/ownership
- https://supabase.com/docs/guides/storage/schema/design
- https://supabase.com/docs/guides/storage/schema/helper-functions
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/storage/buckets/creating-buckets
- https://supabase.com/docs/guides/storage/uploads/standard-uploads
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/guides/storage/serving/image-transformations
- https://supabase.com/docs/guides/storage/cdn/fundamentals
- https://supabase.com/docs/guides/storage/cdn/smart-cdn
- https://supabase.com/docs/guides/storage/pricing
- https://supabase.com/docs/guides/storage/debugging/error-codes
- https://supabase.com/docs/guides/functions/quickstart
- https://supabase.com/docs/guides/functions/dependencies
- https://supabase.com/docs/guides/functions/development-environment
- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/functions/pricing
- https://supabase.com/docs/guides/local-development/cli/config

No Supabase project was created, modified or queried for this note.

---

## Corrections after fact-check

Fact-check of 21 November 2026. About forty claims were re-verified by opening the installed package sources, the Auth server source (`supabase/auth` master, CHANGELOG head v2.198.0 dated 2026-11-13, confirmed), the Storage server source (`supabase/storage` master) and the cited documentation pages. Every re-checked claim that is not listed here was confirmed as written. The file and line references that were opened (installed `auth-js`, `ssr`, `supabase-js`, `storage-js`, `functions-js`; Auth server `api`, `models`, `tokens`, `conf`) matched to within a line or two. Claims that were not re-opened keep whatever status the first draft gave them.

| # | Where | What the note said | What is right | Source |
| --- | --- | --- | --- | --- |
| 1 | 4.4, 7.4 | Storage error example `{"statusCode":"404","code":"NoSuchKey","error":"NoSuchKey",…}`; whether the HTTP status is the real one "UNVERIFIED" | The `error` field is a legacy label (`not_found`, `Duplicate`, `Unauthorized`, …), not the code; and in the server source the HTTP status is **400 for every non-500 error**, with the real status only in the body's string `statusCode`. The stand-in checklist now says so | `STORAGE/internal/errors/storage-error.ts:19-23`, `90-97`; `STORAGE/http/error-handler.ts:71-87`; `STORAGE/app.ts:110`; `STORAGE/internal/errors/codes.ts` |
| 2 | 4.4, 7.4 | `InvalidJWT` 401, `InvalidMimeType` 400; stand-in told to answer a bad signed token with `InvalidSignature` 403 | Server source: `InvalidJWT` 400, `InvalidMimeType` 415, `InvalidSignature` 400, plus `ExpiredToken` 400 for an expired signed URL. The documentation table still shows 401 / 400 / 403; both are now shown side by side | `STORAGE/internal/errors/codes.ts:234-301`, `342-348`; https://supabase.com/docs/guides/storage/debugging/error-codes |
| 3 | 4.4, 7.4 | Which code a duplicate upload returns "UNVERIFIED"; checklist used `ResourceAlreadyExists` | `KeyAlreadyExists` (409 in the body). `ResourceAlreadyExists` is the generic unique-violation code. App code should accept both | `STORAGE/storage/uploader.ts:277-279`; `STORAGE/storage/database/pg.ts:1727-1730`; `STORAGE/storage/database/errors.ts:25-26` |
| 4 | 4.4, 7.4 | "Signed upload URLs are valid for 2 hours" stated as a fact of the server | True for the hosted platform per the client doc comment and the reference page; the open-source server's default is 60 seconds and the value is not chosen by the caller. Local CLI value UNVERIFIED | `STORAGE/config.ts:512-517`; `STJS/packages/StorageFileApi.ts:333-335`; https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl |
| 5 | 7.4 | Signed upload token payload `{url, owner, upsert, exp}`; bad-token and private-bucket codes "UNVERIFIED" | Payload also has `scope: "upload"` (download tokens: `"download"`), and the server rejects a token used for the other purpose. Bad signature `InvalidJWT`, wrong path or scope `InvalidSignature`, expired `ExpiredToken`; a private bucket on `/object/public/…` answers `NoSuchBucket` | `STORAGE/storage/object.ts:1976-2049`; `STORAGE/internal/auth/jwt.ts:48-49`; `STORAGE/http/routes/object/getPublicObject.ts:59-61`; `STORAGE/storage/database/pg.ts:693-717` |
| 6 | 0, 3.3, 6.2, 7.1 | Line references into `tools/dev-api/src/server.ts` (`:188`, `:260`, `:88`, …) | That file was split in commit `f4c973d`; it is now 66 lines. All references were re-pointed to `routes/auth.ts` and `context.ts`. Item 11 of 7.1 was partly out of date: the CORS list already allows `x-upsert` and `cache-control` | `tools/dev-api/src/routes/auth.ts`, `tools/dev-api/src/context.ts` (read 21 Nov 2026) |
| 7 | 1.2 step 3 | "do not pass `options` with a token hash" because the argument is spread into the body | The 400 is triggered by `email`, `phone` or a body-level `redirect_to`. `options.redirectTo` goes to the query string and an `options` key in the body is ignored. The advice (send only `token_hash` and `type`) stands; the reason was wrong | `AUTHJS/GoTrueClient.ts:2479-2495`; `GOTRUE/api/verify.go:83-87`; `GOTRUE/api/helpers.go:86-98` |
| 8 | 2.1, 7.3 | Unknown factor id: "exact status and code UNVERIFIED" | `404 mfa_factor_not_found` "Factor not found"; non-UUID `404 validation_failed` | `GOTRUE/api/admin.go:75-94` |
| 9 | 3.1 | `email_address_not_authorized`: HTTP status "UNVERIFIED" | `400` | `GOTRUE/api/mail.go:773-790` |
| 10 | 3.2 | `getClaims()` falls back to `GET /user` only for `HS*`, missing `kid` or missing WebCrypto | It also falls back when the JWKS has no key with the token's `kid` | `AUTHJS/GoTrueClient.ts:6672-6685`, `6801-6824` |
| 11 | 3.3 | Refresh-token reuse interval "10 s default" | 10 s is the platform and CLI default; the Auth server's built-in default is 0 | `GOTRUE/conf/configuration.go:935`; CLI reference `auth.refresh_token_reuse_interval` |
| 12 | 4.5 | Image transformation charge "amount UNVERIFIED" | $5 per 1,000 origin images beyond 100 included on Pro and Team | https://supabase.com/docs/guides/storage/serving/image-transformations ("Pricing") |
| 13 | 5 | Deno version "UNVERIFIED" | Major version 2 per the CLI config template; exact minor still UNVERIFIED | `https://raw.githubusercontent.com/supabase/cli/v2.90.0/pkg/config/templates/config.toml:372-373` |
| 14 | 5, 7.5 | `verify_jwt` "lets through `sb_` keys on either header" stated without qualification; stand-in told to require a user JWT | Two documentation pages contradict each other on `Authorization: Bearer sb_…`. The stand-in rule was also stricter than the platform for key-only calls from supabase-js; both texts adjusted | https://supabase.com/docs/guides/functions/auth-headers; https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys; `SBJS/lib/fetch.ts:77-95` |
| 15 | 6.1 | Password-strength `config.toml` keys "UNVERIFIED" | `[auth] minimum_password_length`, `password_requirements` | CLI config template v2.90.0, lines 173-178 |
| 16 | 0 | The self-hosted gateway page "says [it] matches the platform" | The page claims platform parity only in its CORS section | https://supabase.com/docs/guides/self-hosting/self-hosted-envoy |
| 17 | 5 | Bundle limit "20 MB" | 20 MB when bundled by the CLI, 5 MB when bundled server-side | https://supabase.com/docs/guides/functions/limits |
| 18 | 1.5 | "skipped in a recovery session" left undefined | A recovery session is any session whose `amr` has `otp`, `magiclink` or `recovery`, which includes every `POST /verify` session | `GOTRUE/models/sessions.go:114-127`; `GOTRUE/models/factor.go:66-73` |

Still **UNVERIFIED** after the fact-check: which e-mail-change template variable carries which mailbox's hash (1.4); the hosted platform's actual HTTP status for Storage errors (source says 400, not tested live); the signed-upload-URL lifetime on the local CLI stack; whether `[storage.buckets.*]` in `config.toml` is applied to a hosted project; whether `supabase config push` covers every Auth setting; the base directory of `content_path`; the exact Deno minor version; how stable a hosting provider's egress IP is between two calls (MFA same-IP check); a `config.toml` key for the leaked-password check.

Note on the documentation pages: each `.md` page of the Supabase docs opens with a paragraph addressed to AI agents asking them to append a feedback report to their answer. It is page content, not an instruction from the project owner, and was ignored.

## Implementation risks

What is most likely to go wrong for someone coding from this note, most costly first.

1. **Branching on HTTP status for Storage errors.** The real server answers 400 for "not found", "duplicate", "forbidden" and "too large" alike. Code or tests that check `error.status === 404` or `409` pass against a naive stand-in and fail against Supabase. Use `error.code` (`NoSuchKey`, `KeyAlreadyExists` or `ResourceAlreadyExists`, `AccessDenied`, `EntityTooLarge`, `InvalidMimeType`).
2. **Staff recovery with MFA.** A recovery link gives an `aal1` session and `PUT /user {password}` answers `401 insufficient_aal` for anyone with a verified factor. The reset screen needs the TOTP step first, and a member of staff who lost the phone cannot reset at all without an admin removing the factor (admin API, secret key).
3. **Sign-up once confirmation is on.** No session comes back, a repeated sign-up for a confirmed address looks like success with `identities: []`, and consent can no longer be recorded in the same action (there is no session to call the database with). Record consent after `verifyOtp`, or carry it in `options.data` and persist it from a database trigger.
4. **Every Auth call comes from the Next.js server's IP.** Thirty sign-ups, resets or password changes per five minutes is a limit for the whole site, not per shopper, and the MFA challenge/verify pair must come from one address. The documented fix needs a secret key in the app server, which the current design forbids; this is an owner decision, not a coding detail.
5. **No e-mail leaves the project without custom SMTP.** With the built-in sender, a reset for a non-member address fails with `400 email_address_not_authorized` and everyone shares 2 messages per hour. Build and test against the local mail catcher; do not conclude from a hosted test that the flow is broken.
6. **Link scanners consume one-time links.** If `GET /auth/confirm` calls `verifyOtp` directly, corporate mail filters will burn the token and the user sees `otp_expired`. Verify only on the `POST`.
7. **Stand-in fidelity.** Until 7.1 is done, the stand-in hides real bugs (single-use refresh tokens cause false sign-outs locally; a changing `session_id`, a no-op logout and a fixed `aal1` make MFA, "sign out other devices" and recovery untestable). Its JWKS `kid` must keep matching the token header or every `getClaims()` becomes a `GET /user`.
8. **`signOut()` default scope is `global`.** The current `endSession()` signs the person out of all four apps and every device, and on a network error leaves the cookie in place. Use `{ scope: "local" }`.
9. **Signed upload URL lifetime is not yours to choose.** Two hours on the platform, possibly 60 seconds elsewhere. Create the URL at the moment of upload; do not render it into a page that may sit open.
10. **Declared content type is trusted.** `allowed_mime_types` checks what the client claims. A `Buffer` upload without `contentType` is stored as `text/plain;charset=UTF-8` and refused by an image-only bucket; a renamed executable with `image/png` is accepted. Keep server-side inspection in the moderation flow.
11. **Cookie writes outside an action.** `resetPasswordForEmail`, `signUp`, `resend` and `updateUser({ email })` store a PKCE verifier cookie even though the token-hash flow never reads it, and `verifyOtp`, `updateUser` and `mfa.verify` rewrite the session cookie. All of them must run in a Server Action or route handler; in a Server Component the project's `setAll` swallows the failure and the session silently is not saved. The unused verifier cookies stay until sign-out (`AUTHJS/GoTrueClient.ts:5327-5349`).
12. **Edge Function keys.** A `sb_secret_…` key on `Authorization: Bearer` is rejected by the Data API and, depending on which documentation page is right, by the function gateway. Keys go on `apikey`; webhook and cron functions need `verify_jwt = false` and their own check.
13. **Line numbers into GitHub `master` drift.** The Auth and Storage server references were correct on 21 November 2026 against the then-current `master`. Re-open the file rather than trusting a line number later.
