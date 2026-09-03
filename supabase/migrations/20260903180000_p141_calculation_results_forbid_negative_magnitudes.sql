-- ============================================================
-- Snowkap CBAM
-- P14.1 (2026-09-03): calculation_results accepts NEGATIVE quantities,
-- emissions, certificate counts and liability amounts.
--
-- FOUND BY the P14.1 adversarial re-check of the filing path, alongside
-- the output-forgery blocker, and reproduced live inside a real
-- BEGIN ... ROLLBACK transaction: a member-inserted row carrying
-- `embedded_emissions_tco2e = '-500000'` was accepted by
-- `record_declaration_filed` and summed verbatim into `filed_snapshot`.
--
-- THE CAUSE. `calculation_results_numeric_format_ck` (20260829200000)
-- reuses the DecimalString shape:
--
--     '^-?[0-9]+(\.[0-9]+)?$'
--            ^^ this
--
-- That regex is correct for `src/domain/shared/decimal.ts`, which is a
-- general decimal type and must keep accepting negatives. It is wrong
-- for these four columns, where a negative value has no meaning that
-- this product can represent:
--
--   * `quantity` is a net mass in tonnes or an energy quantity in MWh.
--   * `embedded_emissions_tco2e` is embedded emissions. CBAM has no
--     concept of a good that removes emissions on import, and the
--     engine cannot produce one: it multiplies a non-negative quantity
--     by a non-negative specific-emissions factor.
--   * `certificates_due` is a count of certificates.
--   * `liability_amount` is a money amount owed.
--
-- A negative in any of them is not a small number, it is a number that
-- SUBTRACTS from a declaration's total. One forged line could cancel
-- out several honest ones, and the filed snapshot would still add up
-- internally.
--
-- WHY THIS IS A SEPARATE MIGRATION from the write-model change that
-- lands beside it. They fix different things and should be revertable
-- separately: the write model decides WHO may write a result, this
-- decides WHAT SHAPE a result may have. Even with every write arriving
-- through the trusted path, the database should refuse to store a
-- negative embedded-emissions figure -- the constraint is the statement
-- of what the column means, not a second lock on the door.
--
-- Verified before applying: all 21 existing rows locally are
-- non-negative in all four columns, so this validates against existing
-- data rather than needing a NOT VALID staging step.
-- ============================================================

alter table public.calculation_results
    drop constraint if exists calculation_results_numeric_format_ck;

alter table public.calculation_results
    add constraint calculation_results_numeric_format_ck
    check (
        -- Same shape as before, minus the optional leading '-'. Kept as
        -- one constraint with the original name so the "form of a
        -- decimal string" rule stays in a single place rather than
        -- being split across two constraints that could drift.
        quantity ~ '^[0-9]+(\.[0-9]+)?$'
        and embedded_emissions_tco2e ~ '^[0-9]+(\.[0-9]+)?$'
        and (certificates_due is null
             or certificates_due ~ '^[0-9]+(\.[0-9]+)?$')
        and (liability_amount is null
             or liability_amount ~ '^[0-9]+(\.[0-9]+)?$')
    );

comment on constraint calculation_results_numeric_format_ck
    on public.calculation_results is
    '2026-09-03 (P14.1). A canonical non-negative decimal string. The '
    'leading-minus branch was removed after a live probe filed '
    'embedded_emissions_tco2e = ''-500000'' into an immutable '
    'filed_snapshot: a negative here subtracts from a declaration total '
    'rather than merely understating one line. The domain''s '
    'DecimalString type still permits negatives, correctly -- it is a '
    'general decimal, while these four columns are a mass, an emissions '
    'figure, a certificate count and a money amount owed, none of which '
    'this product can represent below zero.';
