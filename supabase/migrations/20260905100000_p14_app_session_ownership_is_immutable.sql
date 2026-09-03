-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-04): a session belongs to the identity it
-- was created for, and nothing may move it.
--
-- ------------------------------------------------------------
-- THE FINDING, reproduced end to end before this was written
--
-- 20260905090000 moved the provider credentials out of the browser and
-- left it holding an opaque identifier. That closed credential theft.
-- It did not make the identifier UNFIXABLE, and an opaque session
-- identifier has to be both:
--
--   1. attacker signs in normally and keeps their own identifier T
--   2. T is planted as an ordinary, non-httpOnly cookie in a signed-out
--      victim's browser -- a signed-out browser holds no httpOnly
--      cookie of that name, so there is nothing for the browser to
--      refuse, and any script on the origin can write one
--   3. the victim signs in normally, through the real sign-in form
--   4. persistAppSession found a live row for T and UPDATEd it,
--      including user_id -> victim
--   5. the identifier was NOT rotated: the victim's cookie was still T
--   6. the attacker replays T and is the victim
--
-- Measured: "identifier ROTATED on authentication: false", the row's
-- owner became the victim, and the replaying browser rendered
-- "Signed in as <victim>". Full account takeover, inside whatever
-- organisation the victim belongs to, through the supported UI.
--
-- ------------------------------------------------------------
-- WHY A TRIGGER AND NOT ONLY THE APPLICATION FIX
--
-- The application fix (app-session-store.ts) is the real one: the
-- authentication path no longer reassigns ownership, it retires the
-- supplied identifier and mints a fresh one.
--
-- This exists so that the invariant is not merely a promise the
-- application keeps. "user_id never changes" is the whole security
-- property; a future refactor, a well-meant upsert, or a second writer
-- added later would silently reopen exactly the takeover above, and no
-- behavioural test would necessarily notice. Here it is impossible
-- rather than avoided -- and it binds the service role too, which is
-- the only role that can reach this table at all.
--
-- token_hash is covered by the same rule and for the same reason:
-- moving a live session onto a different cookie is the same defect
-- wearing the other hat.
-- ============================================================

create or replace function app.enforce_app_session_ownership_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.user_id is distinct from old.user_id then
        raise exception
            'app_sessions: a session belongs to the identity it was created for. Authentication must retire this session and create a new one, never move this one to user %.',
            new.user_id
            using errcode = '42501';
    end if;

    if new.token_hash is distinct from old.token_hash then
        raise exception
            'app_sessions: a session is identified by the cookie it was created with. Moving a live session onto a different identifier is the same reassignment as changing its owner.'
            using errcode = '42501';
    end if;

    -- Not security, but the same class of quiet corruption: a session
    -- that appears to predate itself makes every expiry and audit
    -- question unanswerable.
    if new.created_at is distinct from old.created_at then
        raise exception
            'app_sessions: created_at is a fact about when this session began.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_app_session_ownership_is_immutable() is
    'A browser session may be refreshed, revoked or expired, but never reassigned. P14 session-fixation remediation, 20260905100000.';

drop trigger if exists app_sessions_ownership_is_immutable
    on public.app_sessions;

create trigger app_sessions_ownership_is_immutable
    before update on public.app_sessions
    for each row
    execute function app.enforce_app_session_ownership_is_immutable();
