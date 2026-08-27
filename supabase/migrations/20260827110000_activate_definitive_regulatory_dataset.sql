-- ============================================================
-- Snowkap CBAM
-- Activate validated definitive regulatory dataset
-- ============================================================

begin;

do $$
declare
    v_dataset_id uuid;
    v_status text;
begin
    select
        id,
        status
    into
        v_dataset_id,
        v_status
    from public.regulatory_datasets
    where dataset_type = 'DEFAULT_EMISSION_VALUES'
      and version = '2026-definitive-corrected'
    limit 1;

    if v_dataset_id is null then
        raise exception
            'Validated regulatory dataset 2026-definitive-corrected was not found';
    end if;

    if v_status <> 'DRAFT' then
        raise exception
            'Expected dataset status DRAFT, found %',
            v_status;
    end if;

    if (
        select count(*)
        from public.default_emission_values
        where dataset_id = v_dataset_id
    ) <> 12540 then
        raise exception
            'Expected exactly 12540 emission rows for dataset %, but count differs',
            v_dataset_id;
    end if;

    update public.regulatory_datasets
    set status = 'ACTIVE'
    where id = v_dataset_id;

    if not found then
        raise exception
            'Failed to activate dataset %',
            v_dataset_id;
    end if;
end $$;

commit;