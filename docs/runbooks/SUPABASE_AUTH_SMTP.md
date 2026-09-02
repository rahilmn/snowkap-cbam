# Supabase Auth custom SMTP — exact configuration requirements

**Status as of 2026-09-03: PASS. Custom SMTP is configured, and real
transactional email has been delivered AND consumed in production for
both sign-up confirmation and password recovery.**

Do not change the SMTP configuration on the strength of this document.
It is a record of what is already working plus the procedure to
reproduce it, not an open action.

---

## 0. Current state (verified)

| Field | Value | State |
|---|---|---|
| Host | `smtp.resend.com` | correct |
| Port | `587` (STARTTLS) | correct |
| Username | `resend` (the literal string) | correct |
| Password | Resend API key | correct |
| Sender email | `noreply@snowkap.co.in` | correct — the only verified Resend domain |
| Sender name | `Snowkap CBAM` | fine |

Evidence: Resend's own send log shows delivered sign-up confirmation,
password-recovery and team-invitation mail from this product; the
delivered links point at the production origin; and both link types have
been followed to a real established session. Recorded in
`docs/plans/P13_RELEASE_READINESS_REPORT.md` §61-§63.

### Corrections to earlier revisions of this runbook

Two diagnoses in this file's history were wrong, and are recorded here
rather than deleted, because both cost real time:

1. **"The sender domain is wrong (`snowkap.com`, not `snowkap.co.in`)."**
   Incorrect. The dashboard already had `noreply@snowkap.co.in`. The
   `snowkap.com` rejection observed at the time came from a *control*
   send issued by hand, not from Supabase's configuration.

2. **"The PORT is wrong — 465 vs 587 STARTTLS."** Incorrect as the root
   cause. `535 Invalid username` persisted across *both* ports. The
   actual root cause was the **username**: Resend's SMTP username is the
   literal string `resend`, and the project had something else. Port 587
   is still the correct value and is what is configured, but changing
   the port is not what fixed delivery.

The root cause was found in the hosted project's own Auth log, which
returned `535 "Invalid username"` on every `/signup` and `/recover` — an
SMTP AUTH rejection, not a transport or sender problem. The lesson worth
keeping: read the Auth service log before theorising about transport.

---

## 3. What to configure

**Supabase Dashboard → Project Settings → Authentication → SMTP Settings**
→ *Enable Custom SMTP*.

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` (STARTTLS) |
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
