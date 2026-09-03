-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-04): the browser must not carry a
-- credential that Supabase Auth will accept.
--
-- ------------------------------------------------------------
-- THE FINDING
--
-- The session cookie this application set was @supabase/ssr's own: a
-- base64 blob containing the whole provider session, including the raw
-- `access_token` and `refresh_token`. Reproduced end to end against a
-- real GoTrue:
--
--   victim signs in through the UI
--     -> cookie sb-<ref>-auth-token, httpOnly, 2635 bytes
--     -> parses to { access_token, refresh_token, user, ... }
--     -> PUT /auth/v1/user {"password": ...} with that bearer token
--        -> 200
--     -> victim's password no longer signs in; the attacker's does
--
-- It needed nothing else. The request was accepted with the anon key,
-- with NO apikey header at all, and with the stolen user token used as
-- the apikey. The stolen refresh_token separately minted fresh
-- sessions on demand, so a shorter access-token lifetime would have
-- mitigated nothing.
--
-- The application's current-password proof was not defeated -- it was
-- bypassed. It guards this product's own endpoints, and the attacker
-- did not need them. `secure_password_change = true` did not help
-- either: it refuses an AGED session and admits a fresh one, and a
-- cookie lifted from a live browser is fresh by definition.
--
-- ------------------------------------------------------------
-- WHAT THIS TABLE IS FOR
--
-- The browser now holds an opaque, randomly generated identifier that
-- means nothing to Supabase. The provider session lives here, on the
-- server, and is looked up by that identifier on each request.
--
--   browser   sb_app_session=<32 random bytes, base64url>
--   server    public.app_sessions.sealed_provider_session
--   provider  Supabase Auth, reachable only from the server
--
-- A stolen opaque identifier still authenticates to THIS application as
-- the user -- that is inherent to any session cookie and is not what
-- this change is about. What it can no longer do is authenticate
-- directly to Supabase Auth, which is what turned session theft into
-- permanent account takeover.
--
-- ------------------------------------------------------------
-- WHY THE STORED SESSION IS SEALED
--
-- `sealed_provider_session` is AES-256-GCM ciphertext, not the session.
-- The key is derived from APP_SESSION_SECRET and never reaches this
-- database, so the row is inert to anyone who obtains the table without
-- also obtaining the application's environment -- a leaked backup, a
-- read replica, a dump handed to a contractor. That is a real and
-- routine exposure in this project specifically: docs/runbooks/
-- BACKUP_RESTORE.md's own drill produces exactly such a dump.
--
-- It is NOT a defence against an attacker who already holds the
-- service-role key, and is not claimed as one.
--
-- ------------------------------------------------------------
-- WHY token_hash RATHER THAN THE TOKEN
--
-- The cookie value itself is never stored. A read of this table -- by
-- any means -- yields no cookie that can be replayed, only the SHA-256
-- of one. Same reasoning the rest of this schema applies to evidence
-- paths and invitation tokens.
-- ============================================================

create table if not exists public.app_sessions (
    id uuid primary key default gen_random_uuid(),

    -- SHA-256 (hex) of the opaque cookie value. Unique, because the
    -- cookie is the lookup key and two sessions sharing one would mean
    -- the generator had collided.
    token_hash text not null unique,

    -- Whose session this is. NOT NULL on purpose: a session whose owner
    -- is unknown cannot be revoked by "sign out my other sessions",
    -- which would be a silently unrevocable credential. The writer
    -- refuses to persist rather than store a null here.
    user_id uuid not null,

    -- AES-256-GCM sealed JSON: the provider cookie entries exactly as
    -- @supabase/ssr produced them. Opaque to this database.
    sealed_provider_session text not null,

    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz
);

comment on table public.app_sessions is
    'Server-side store for browser sessions. The browser holds only an opaque identifier; the Supabase access/refresh tokens live here, sealed, so a stolen browser cookie cannot be presented to Supabase Auth directly. P14 AUTH-1.';

-- Revocation sweeps by user ("sign out everywhere", and the
-- password-change path); the unique index on token_hash already covers
-- per-request lookup.
create index if not exists app_sessions_user_id_idx
    on public.app_sessions (user_id)
    where revoked_at is null;

-- ------------------------------------------------------------
-- REACHABILITY
--
-- RLS on with NO policy at all, and every privilege revoked from both
-- API roles. Two independent layers, deliberately: RLS-with-no-policy
-- denies every row to anon/authenticated, and the absent grants mean
-- PostgREST refuses before RLS is even consulted. service_role
-- bypasses RLS and is the only thing that reads this table.
--
-- This is the same shape app.engine_version uses, for the same reason:
-- a table the application depends on but no client may ever see.
-- ------------------------------------------------------------
alter table public.app_sessions enable row level security;

revoke all on public.app_sessions from anon, authenticated;

-- ------------------------------------------------------------
-- REGISTERED, so the revoke survives.
--
-- seed.sql runs `grant all on all tables in schema public` to replicate
-- the hosted platform's bootstrap, and a dump records the grants that
-- exist and never their absence. Both hand this table straight back
-- unless the revoke is re-asserted. 20260903230000's registry is what
-- makes a forgotten re-assertion fail the build instead of producing a
-- working application with the session store readable by every
-- authenticated caller.
-- ------------------------------------------------------------
insert into app.privilege_invariants (
    object_kind, object_identity, role_name, privilege,
    source_migration, rationale
)
select
    'TABLE',
    'public.app_sessions',
    r.role_name,
    p.privilege,
    '20260905090000',
    'the session store is the credential -- a client that can read it can impersonate every signed-in user'
from (values ('anon'), ('authenticated')) as r(role_name)
cross join (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
) as p(privilege)
where not exists (
    select 1
    from app.privilege_invariants existing
    where existing.object_kind = 'TABLE'
      and existing.object_identity = 'public.app_sessions'
      and existing.role_name = r.role_name
      and existing.privilege = p.privilege
);
