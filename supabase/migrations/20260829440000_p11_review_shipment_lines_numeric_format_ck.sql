-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: shipment_lines'
-- net_mass_tonnes/quantity_mwh carried no canonical-form CHECK,
-- unlike emission_data's matching columns
--
-- Purpose:
--   Finding #9 (BLOCKING per two independent reviewers -- root-caused
--   to a decimal.ts contract bug, fixed in the same review): a
--   regulated numeric that decimal.js reads one way, JS Number() reads
--   a DIFFERENT way, and Postgres reads a THIRD way is exactly what
--   CLAUDE.md's "never invent, never substitute" rule forbids. The
--   domain-layer half of this fix (src/domain/shared/decimal.ts's
--   parseDecimalString, now enforcing a strict canonical-decimal
--   grammar and returning the trimmed, not raw, value) closes the
--   application-layer entry point; this migration closes the DATABASE
--   half specifically named by the finding -- emission_data already
--   carries `direct_specific ~ '^-?[0-9]+(\.[0-9]+)?$'`
--   (emission_data_direct_specific_numeric_ck, 20260829230000), but
--   shipment_lines.net_mass_tonnes/quantity_mwh only ever had a
--   `> 0` numeric-cast CHECK (shipment_lines_net_mass_positive_ck /
--   shipment_lines_quantity_mwh_positive_ck, 20260828150000) -- and
--   `::numeric` in Postgres accepts a far wider grammar than this
--   codebase's own canonical form (leading/trailing whitespace,
--   scientific notation, ...), so those two CHECKs alone never caught
--   any of the non-canonical forms live-reproduced against this exact
--   table ('1e40', '0x10'... wait, Postgres ::numeric does NOT accept
--   hex/binary/octal -- those were rejected by the numeric cast itself;
--   the live-reproduced ACCEPTED cases against shipment_lines were
--   '1e40', '1_0', '  42  ', and a 200-digit integer, all of which
--   `::numeric` parses without complaint). This migration mirrors
--   emission_data_direct_specific_numeric_ck's exact grammar onto both
--   columns, byte-for-byte, so this table now enforces the same
--   canonical form the domain layer enforces, independent of which
--   layer a future write path happens to go through (this is a
--   product-schema table, not the protected regulatory zone itself,
--   but the same "one canonical reading for any stored regulated
--   numeric" principle applies).
--
--   Deliberately does NOT touch the existing `> 0` CHECKs
--   (shipment_lines_net_mass_positive_ck /
--   shipment_lines_quantity_mwh_positive_ck) -- those already reject
--   the '-100'/'0' cases live-reproduced as correctly ERRORing;
--   nothing about this migration weakens them, it only adds the
--   grammar constraint alongside.
-- ============================================================


alter table public.shipment_lines
    add constraint shipment_lines_net_mass_format_ck
        check (
            net_mass_tonnes is null
            or net_mass_tonnes ~ '^-?[0-9]+(\.[0-9]+)?$'
        );

alter table public.shipment_lines
    add constraint shipment_lines_quantity_mwh_format_ck
        check (
            quantity_mwh is null
            or quantity_mwh ~ '^-?[0-9]+(\.[0-9]+)?$'
        );

comment on constraint shipment_lines_net_mass_format_ck on public.shipment_lines is
    '2026-08-29 (P11 mandatory review, finding #9): same canonical-'
    'decimal grammar as emission_data_direct_specific_numeric_ck '
    '(20260829230000) and src/domain/shared/decimal.ts''s '
    'CANONICAL_DECIMAL_PATTERN (same review) -- see this migration''s '
    'header comment for the live-reproduced non-canonical values '
    '(''1e40'', ''1_0'', ''  42  '', a 200-digit integer) that '
    'shipment_lines_net_mass_positive_ck''s `::numeric` cast alone '
    'never rejected.';

comment on constraint shipment_lines_quantity_mwh_format_ck on public.shipment_lines is
    '2026-08-29 (P11 mandatory review, finding #9): the identical fix '
    'as shipment_lines_net_mass_format_ck above, applied to '
    'quantity_mwh -- the mandatory reviewer confirmed live that this '
    'column carries the SAME gap '
    '(shipment_lines_quantity_mwh_positive_ck only ever cast to '
    '::numeric, never checked canonical form), which the sweep''s own '
    'report named only for net_mass_tonnes.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
