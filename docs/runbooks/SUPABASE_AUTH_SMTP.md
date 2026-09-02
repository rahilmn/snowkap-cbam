# Supabase Auth custom SMTP — exact configuration requirements

**Status as of 2026-09-02: NOT CONFIGURED. This is a release blocker.**

Every transactional auth email the product sends — sign-up
confirmation, password reset, and team invitation — currently fails to
deliver. **No real user can complete registration or recover an
account.**

This runbook is dashboard-only work. It cannot be done from this
repository or by an automated session: Supabase Auth SMTP settings live
in the hosted dashboard / Management API, and this project's MCP
integration returns *"You do not have permission to perform this
action"* for every project-level read.

---

## 1. Evidence that it is not configured

Not inferred from missing config — measured:

| Probe | Result |
|---|---|
| Real production password-reset form, submitted in a browser | **"Something went wrong. Please try again."** |
| Resend account send log (`GET /emails`), whole account | **Zero** sends from this product, ever. Most recent send on the account is unrelated and days old. |
| `POST /auth/v1/recover` directly | `over_email_send_rate_limit` (HTTP 429) after ~**2** attempts |

The 429 at two attempts is the signature of Supabase's **built-in**
email service (~2/hour). A project on custom SMTP does not throttle at
two. Combined with zero Resend sends, the conclusion is that Auth is
still relaying through the built-in sender.

---

## 2. The single most likely cause of a previous silent failure

The Resend account has exactly **one verified domain**:

```
snowkap.co.in   status: verified
```

Resend **rejects any sender outside a verified domain.** If Supabase's
SMTP sender address is not on `snowkap.co.in`, every send fails at
Resend and never appears in its log — which is exactly the observed
state.

---

## 3. What to configure

**Supabase Dashboard → Project Settings → Authentication → SMTP Settings**
→ *Enable Custom SMTP*.

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (the literal string — Resend's SMTP username is always this) |
| Password | your Resend **API key** |
| Sender email | an address **on `snowkap.co.in`**, e.g. `noreply@snowkap.co.in` |
| Sender name | e.g. `Snowkap CBAM` |

> **The API key is a secret.** It is not recorded in this repository, in
> this runbook, or in any commit. It lives only in the gitignored `.env`
> (as `RESEND_API_KEY`) and in the Resend dashboard. Paste it directly
> into the Supabase field — do not put it in a chat message, a ticket,
> a screenshot, or any source file. It is **not** a `NEXT_PUBLIC_*`
> variable and must never become one.

Then, in the same section, **raise the Auth email rate limit** above the
built-in default (2/hour), which otherwise throttles legitimate signups
even once SMTP works.

---

## 4. Also required, and already satisfied

**Authentication → URL Configuration** must name the deployment origin:

- **Site URL:** `https://snowkap-cbam-production.up.railway.app`
- **Redirect URLs:** must include
  `https://snowkap-cbam-production.up.railway.app/**`

The application now sends an explicit `emailRedirectTo` on sign-up
(commit `3ba9710`) built from `APP_URL`, and `APP_URL` is **verified
configured** on Railway — `/api/health` reports `"app_url": "ok"`.

**Caveat, stated because it cannot be verified from outside:** GoTrue
does **not** reject a `redirect_to` that is missing from the allowlist —
it silently falls back to Site URL. This was confirmed with a control
probe: a deliberately non-allowlisted URL also returned HTTP 200. So the
allowlist cannot be checked via the API. **The host in the delivered
email is the only ground truth** — check it before clicking.

---

## 5. What the application detects, and what it cannot

| Condition | Detected? |
|---|---|
| `APP_URL` unset in production | **Yes** — `checkAppUrl()` degrades `/api/health` to 503. Since `railway.json` sets `healthcheckPath` to `/api/health`, a deploy that would email `localhost` links now fails its healthcheck. |
| Redirect-URL allowlist wrong | **No** — GoTrue substitutes silently; nothing observable. |
| Custom SMTP not configured | **No, and deliberately not attempted.** The only way to detect it from the application is to send an email and observe the outcome, which would mean either emitting real mail on a health probe or embedding SMTP credentials in the app. Both are worse than the gap. This stays an owner-verified configuration step. |

---

## 6. Verification — the only thing that counts

**Do not mark SMTP verified because the settings are saved.** It is
verified when, and only when, a real external email has been delivered
*and consumed*:

1. Sign up at `https://snowkap-cbam-production.up.railway.app/sign-up`
   with a **brand-new address you control**.
2. Confirm the email arrives. **Check the link's host before clicking.**
3. Click it; confirm a session is established as that new user.
4. Complete onboarding and organization creation; reach the dashboard.
5. Sign out.
6. Request a password reset; confirm that email arrives.
7. Follow the link, set a new password.
8. Sign in with the new password.

Do **not** use the Supabase Admin API to confirm the user, and do **not**
disable email confirmation — both would bypass the exact path under test.

Record the outcome in the release report. Until step 2 succeeds against a
real inbox, SMTP status remains **NOT VERIFIED**.
