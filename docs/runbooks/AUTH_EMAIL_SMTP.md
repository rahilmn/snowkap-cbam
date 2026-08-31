# Runbook — Supabase Auth transactional email (SMTP)

**Status: OWNER ACTION REQUIRED. This is a release blocker.**

Written 2026-08-30 after live verification of the Railway deployment found
that **no real user can complete signup today**. Everything below is the
exact configuration required; none of it can be completed from the
repository, because it needs an email provider account, DNS records on a
Snowkap-controlled domain, and Supabase dashboard access.

---

## 1. The problem, and the evidence for it

Probing the hosted project's Auth API directly:

```
POST /auth/v1/signup   (valid address)
-> {"code":429,"error_code":"over_email_send_rate_limit",
    "msg":"email rate limit exceeded"}
```

That response, on a **first** attempt for a **new** address, establishes
two things:

1. **Email confirmation is enabled** — Auth is trying to send a
   confirmation email at all.
2. **No custom SMTP is configured** — it is falling back to Supabase's
   built-in shared sender.

Supabase's built-in sender is explicitly documented as **not for
production**: it is heavily rate-limited (a handful of messages per hour,
project-wide) and, on most plans, **only delivers to addresses belonging to
members of the Supabase organization**. A real customer signing up receives
nothing.

A separate, benign observation from the same probing session, recorded so
it is not mistaken for a defect later: addresses at `@example.com` are
rejected with `email_address_invalid`. That is Supabase's own blocklist for
reserved test domains, not a bug in this application.

### What is NOT the problem

- The application code is fine. Sign-in, password reset, and invitation
  flows are all implemented and unit-tested.
- The database schema is fine (all 57 migrations applied, verified).
- This is **not** the previously-known S3 finding. S3 is *"the
  email-confirmation authorization gate is vacuous when confirmations are
  disabled"*. This is the opposite failure: confirmations are **enabled**,
  and signup therefore fails outright for want of a delivery channel. Both
  need to be true at go-live: confirmations ON **and** SMTP configured.

---

## 2. Flows that are broken until this is fixed

Every flow that depends on Supabase Auth delivering an email:

| Flow | Where it lives | Impact today |
|---|---|---|
| Signup confirmation | `app/(auth)/sign-up` | **New users cannot register** |
| Password reset | `app/(auth)/forgot-password`, `/reset-password` | Users cannot recover accounts |
| Team invitation | `app/team/actions.ts` (`inviteMember`) | Invited colleagues never receive the invite |
| Invited-user acceptance | `app/accept-invitation` | Unreachable without the invite email |
| Email change confirmation | Supabase Auth built-in | Unreachable |

Note that **sharing-grant invitations are not affected** in the same way:
per `ADR-0012`, the cross-org sharing bootstrap resolves on a plain
`invited_email` text match and does not send an email at all. That is a
separate, already-disclosed design limitation — do not expect fixing SMTP
to change it.

---

## 3. Target architecture

```
Supabase Auth
  -> custom SMTP (transactional provider)
    -> verified Snowkap sending domain (SPF + DKIM + DMARC)
```

Requirements the provider must satisfy:

- Transactional (not marketing) sending, with per-message delivery logs
- Domain authentication via DKIM, not just a verified single sender
- A dedicated API key scoped to sending only
- Throughput comfortably above the expected signup + invitation rate

Any of Resend, SendGrid, Amazon SES, Postmark, or Mailgun meet this. The
choice is an owner decision — this runbook does not prescribe one, and the
configuration below is provider-agnostic apart from the host/port values.

---

## 4. What the owner must do

### Step 1 — Choose a sending domain

Use a Snowkap-controlled domain, e.g. `mail.snowkap.com` or the apex
`snowkap.com`. **Do not** use the Railway-generated
`*.up.railway.app` hostname: it is not a domain Snowkap controls, DKIM
cannot be published for it, and mail from it will be filtered.

### Step 2 — Create the provider account and verify the domain

Add the DNS records the provider issues. Typically:

| Record | Purpose |
|---|---|
| `TXT` (SPF) | authorises the provider to send for the domain |
| `CNAME` x2–3 (DKIM) | cryptographic signing of outbound mail |
| `TXT` (DMARC) | policy for handling failures; start at `p=none`, tighten later |

Wait for the provider to report the domain as fully verified before
continuing. A partially-verified domain will appear to work and then land
in spam.

### Step 3 — Configure SMTP in Supabase

Supabase dashboard → **Project Settings → Authentication → SMTP Settings**
→ enable **Custom SMTP**, then set:

| Field | Value |
|---|---|
| Sender email | e.g. `no-reply@mail.snowkap.com` (must be on the verified domain) |
| Sender name | `Snowkap CBAM` |
| Host | provider's SMTP host |
| Port | `587` (STARTTLS) — prefer over 465 unless the provider requires it |
| Username | provider-issued |
| Password | provider-issued API key — **paste directly into Supabase; never commit it, never place it in `.env`, never paste it into a chat or issue** |

The SMTP credential lives **only** in Supabase's own configuration. It is
not an application environment variable: nothing in this repository reads
it, and it must not be added to `.env`, `.env.example`, or Railway.

### Step 4 — Keep confirmations ON and rate limits intact

Under **Authentication → Sign In / Providers → Email**, leave **Confirm
email** enabled. Do **not** disable it to make testing easier: six RLS
policies and three RPCs in this schema trust `email_confirmed_at`, and
GoTrue stamps that field at signup with no verification when confirmations
are off — which is precisely finding S3.

Likewise leave Supabase's Auth rate limits at their defaults or higher.
They are anti-abuse controls, not an obstacle.

### Step 5 — Set the redirect URLs

**Authentication → URL Configuration**:

- **Site URL**: `https://snowkap-cbam-production.up.railway.app` (or the
  final custom domain once one exists)
- **Redirect allow-list**: include `<site>/auth/callback`

This matters for correctness, not just convenience: `app/auth/callback`
handles the PKCE `?code=` shape that `resetPasswordForEmail` produces. If
the redirect URL is not allow-listed, reset links fail as "invalid or
expired" even with SMTP working perfectly.

Also set **`APP_URL`** in Railway to the same origin, with no trailing
slash. `getAppOrigin()` (`app/team/actions.ts`) prefers it unconditionally
when building invitation links; unset, it falls back to request headers and
team invitations can be generated pointing at `localhost:3000`.

---

## 5. Verification — required before this blocker is cleared

**Do not mark this resolved on configuration alone.** Supabase will happily
accept SMTP settings that silently fail to deliver. An external, end-to-end
delivery test is mandatory:

1. **Signup**: register a brand-new account at
   `https://<deployed-origin>/sign-up` using a **real mailbox on a domain
   you control**, not a `@example.com` address and not a Supabase org
   member's address (a member address can succeed via the built-in sender
   and produce a false pass).
2. Confirm the email **arrives in the inbox, not spam**. Check the
   provider's delivery log for an accepted/delivered event.
3. Click the confirmation link and confirm it lands signed-in on the app,
   with `email_confirmed_at` set:
   ```sql
   select email, email_confirmed_at is not null as confirmed
   from auth.users where email = '<test address>';
   ```
4. **Password reset**: run `/forgot-password` for the same address; confirm
   the email arrives and the PKCE link completes a password change.
5. **Team invitation**: invite a second real address from
   `/team`; confirm arrival and that `/accept-invitation` completes and
   creates the membership.
6. Re-run signup once more to confirm no rate-limit error recurs.

Record the outcome — including the provider, the sending domain, and the
date — in `docs/plans/P13_RELEASE_READINESS_REPORT.md`. Until steps 1–6
have actually been performed against the live deployment, the correct
status remains **RELEASE BLOCKED**, and no report should describe signup as
working.

---

## 6. Interim position for testing (what is being done today, and why it is not a fix)

Until SMTP exists, test accounts are provisioned with the service-role
admin API and `email_confirm: true`:

```
POST {SUPABASE_URL}/auth/v1/admin/users
  { "email": "...", "password": "...", "email_confirm": true }
```

This is the same mechanism this repository's own integration suites already
use to seed users (`tests/integration/*-isolation.test.ts`). It bypasses
email entirely **without weakening any production Auth setting** —
confirmations stay on, rate limits stay on, no policy changes.

It is explicitly **not** a fix and must never be described as one: it
requires the service-role key, so it is unavailable to a real user, and it
proves nothing about deliverability. Any statement that "signup works" that
rests on admin-provisioned users is false.
