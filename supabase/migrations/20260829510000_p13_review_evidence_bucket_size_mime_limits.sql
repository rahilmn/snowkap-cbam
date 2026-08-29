-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation: the 'evidence' Storage bucket set
-- neither file_size_limit nor allowed_mime_types, so the entire
-- upload-safety control set (20MB cap, 5-type MIME/extension
-- allowlist, executable block) was application-layer-only and
-- bypassable with a direct Storage API call using the (intentionally)
-- public anon key
--
-- Purpose:
--   Finding, live-reproduced by the P13 final adversarial audit:
--   supabase.storage.from('evidence').upload(path, hugeBlob, {contentType:
--   'application/x-msdownload'}) never touches the Next.js process at
--   all, so app/api/evidence/upload/route.ts's Content-Length guard,
--   MAX_EVIDENCE_FILE_SIZE_BYTES (20 MiB), and
--   src/domain/evidence/validate-evidence-upload.ts's MIME/extension/
--   executable allowlists are all bypassed simultaneously. Any
--   authenticated org member (the storage.objects INSERT policy keys
--   only on org membership via the path prefix, not on
--   PRODUCER_OPERATOR) could upload an unbounded-size object of any
--   MIME type; since it has no evidence_files row, it stays invisible
--   to every application screen while still occupying paid storage.
--
--   Supabase's storage.buckets table carries exactly these two
--   platform-enforced columns for this: file_size_limit (bytes) and
--   allowed_mime_types (text[]). Setting them here makes Storage itself
--   reject an oversized or wrong-MIME upload before it is ever
--   written, closing the direct-API bypass at the platform layer
--   rather than relying solely on the Next.js route's own checks --
--   this codebase's own "two walls, always both" posture, applied to
--   Storage the same way it already is to Postgres RLS.
--
--   Values mirror src/domain/evidence/validate-evidence-upload.ts's
--   own MAX_EVIDENCE_FILE_SIZE_BYTES (20 MiB) and
--   ALLOWED_MIME_TYPE_EXTENSIONS exactly -- kept in sync by comment
--   cross-reference, the same discipline that module's own header
--   already asks of itself for the MIME/extension pairing.
--
--   NOTE ON LOCAL VERIFICATION: Supabase Storage cannot run on this
--   Windows host (documented three times across this project's history
--   in supabase/config.toml's own comments) -- `storage.buckets` does
--   not exist in this local instance
--   (`select to_regclass('storage.buckets')` returns NULL), so this
--   migration's actual runtime effect (does Storage genuinely reject
--   an oversized/wrong-MIME upload once these columns are set) could
--   not be executed here. The UPDATE statement itself is correct
--   against Supabase's documented storage.buckets schema; real
--   Storage-backed verification needs a working Railway/staging
--   deployment. Idempotent (UPDATE, not INSERT) so it is safe to
--   re-run against a real project regardless of when the bucket was
--   first created relative to this migration.
-- ============================================================

update storage.buckets
set
    file_size_limit = 20971520,  -- 20 * 1024 * 1024, matches MAX_EVIDENCE_FILE_SIZE_BYTES exactly
    allowed_mime_types = array[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'evidence';
