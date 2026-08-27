from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

OUTPUT = (
    ROOT
    / "data"
    / "validation"
    / "definitive-code-reconciliation.json"
)


EXPECTED_LEVEL_LENGTHS = {
    "HS4": 4,
    "HS6": 6,
    "CN8": 8,
    "TARIC10": 10,
}

EXPECTED_TARIC_CODES = {
    "2507008080",
    "2523100010",
    "2523100090",
    "2523900010",
    "2523900090",
}


def load_records() -> list[dict]:
    if not INPUT.exists():
        raise FileNotFoundError(INPUT)

    with INPUT.open(
        "r",
        encoding="utf-8",
    ) as handle:
        records = json.load(handle)

    if not isinstance(records, list):
        raise ValueError(
            "Input must contain a JSON array."
        )

    return records


def main() -> None:
    records = load_records()

    errors: list[str] = []
    warnings: list[str] = []

    # ---------------------------------------------------------
    # Country-scoped code collections
    # ---------------------------------------------------------

    country_codes = defaultdict(
        lambda: defaultdict(set)
    )

    for index, record in enumerate(records):

        country = record.get(
            "origin_country_name"
        )

        level = record.get(
            "code_level"
        )

        code = record.get(
            "normalized_trade_code"
        )

        if level not in EXPECTED_LEVEL_LENGTHS:
            errors.append(
                f"record[{index}]: unknown code level "
                f"{level!r}"
            )
            continue

        expected_length = EXPECTED_LEVEL_LENGTHS[level]

        if not isinstance(code, str):
            errors.append(
                f"record[{index}]: code is not a string"
            )
            continue

        if not code.isdigit():
            errors.append(
                f"record[{index}]: code is not numeric "
                f"{code!r}"
            )
            continue

        if len(code) != expected_length:
            errors.append(
                f"record[{index}]: {level} requires "
                f"{expected_length} digits; got {code!r}"
            )
            continue

        country_codes[country][level].add(code)

    # ---------------------------------------------------------
    # TARIC validation
    # ---------------------------------------------------------

    taric_codes = {
        record.get("normalized_trade_code")
        for record in records
        if record.get("code_level") == "TARIC10"
    }

    unexpected_taric = (
        taric_codes
        - EXPECTED_TARIC_CODES
    )

    if unexpected_taric:
        for code in sorted(
            unexpected_taric
        ):
            errors.append(
                f"Unexpected TARIC10 code: {code}"
            )

    missing_expected_taric = (
        EXPECTED_TARIC_CODES
        - taric_codes
    )

    if missing_expected_taric:
        for code in sorted(
            missing_expected_taric
        ):
            warnings.append(
                f"Expected TARIC10 code not present: {code}"
            )

    # ---------------------------------------------------------
    # Reference-row semantics
    #
    # An HS4 REFERENCE_REQUIRED row must have at least one
    # more-specific source row beneath that prefix in the same
    # country.
    # ---------------------------------------------------------

    reference_rows = []

    for record in records:

        is_reference = any(
            record.get(
                field,
                {},
            ).get("status")
            == "REFERENCE_REQUIRED"
            for field in (
                "direct_emissions",
                "indirect_emissions",
                "total_emissions",
            )
        )

        if not is_reference:
            continue

        reference_rows.append(
            record
        )

        if record.get(
            "code_level"
        ) != "HS4":
            errors.append(
                "REFERENCE_REQUIRED record is not HS4: "
                f"{record.get('normalized_trade_code')!r}"
            )
            continue

        country = record[
            "origin_country_name"
        ]

        prefix = record[
            "normalized_trade_code"
        ]

        descendants = []

        for child_level in (
            "HS6",
            "CN8",
            "TARIC10",
        ):
            for child_code in country_codes[
                country
            ][child_level]:

                if child_code.startswith(
                    prefix
                ):
                    descendants.append(
                        child_code
                    )

        if not descendants:
            errors.append(
                "REFERENCE_REQUIRED HS4 has no "
                "more-specific source records: "
                f"country={country!r}, "
                f"code={prefix!r}"
            )

    # ---------------------------------------------------------
    # Reference rows must have all three fields marked as
    # REFERENCE_REQUIRED.
    # ---------------------------------------------------------

    for record in reference_rows:

        statuses = [
            record.get(
                field,
                {},
            ).get("status")
            for field in (
                "direct_emissions",
                "indirect_emissions",
                "total_emissions",
            )
        ]

        if statuses != [
            "REFERENCE_REQUIRED",
            "REFERENCE_REQUIRED",
            "REFERENCE_REQUIRED",
        ]:
            errors.append(
                "Reference row does not have "
                "REFERENCE_REQUIRED for all emission fields: "
                f"{record.get('origin_country_name')!r} / "
                f"{record.get('normalized_trade_code')!r}"
            )

    # ---------------------------------------------------------
    # Same code should not have multiple descriptions inside
    # the same country.
    # ---------------------------------------------------------

    country_code_descriptions = defaultdict(set)

    for record in records:

        identity = (
            record.get(
                "origin_country_name"
            ),
            record.get(
                "code_level"
            ),
            record.get(
                "normalized_trade_code"
            ),
        )

        country_code_descriptions[
            identity
        ].add(
            record.get(
                "product_name"
            )
        )

    description_conflicts = {
        identity: sorted(
            descriptions
        )
        for identity, descriptions
        in country_code_descriptions.items()
        if len(descriptions) > 1
    }

    if description_conflicts:
        for identity, descriptions in (
            list(
                description_conflicts.items()
            )[:100]
        ):
            errors.append(
                "Description conflict for "
                f"{identity!r}: "
                f"{descriptions!r}"
            )

    # ---------------------------------------------------------
    # Country/code/route identity duplicates
    # ---------------------------------------------------------

    identity_counter = Counter()

    for record in records:

        identity = (
            record.get(
                "origin_country_name"
            ),
            record.get(
                "code_level"
            ),
            record.get(
                "normalized_trade_code"
            ),
            record.get(
                "source_production_route_code"
            ),
        )

        identity_counter[
            identity
        ] += 1

    duplicates = {
        identity: count
        for identity, count
        in identity_counter.items()
        if count > 1
    }

    if duplicates:
        for identity, count in list(
            duplicates.items()
        )[:100]:
            errors.append(
                "Duplicate country/code/route identity "
                f"{identity!r}: {count}"
            )

    # ---------------------------------------------------------
    # Route inventory
    # ---------------------------------------------------------

    route_counts = Counter(
        record.get(
            "source_production_route_code"
        )
        for record in records
        if record.get(
            "source_production_route_code"
        )
    )

    # ---------------------------------------------------------
    # Summary
    # ---------------------------------------------------------

    level_counts = Counter(
        record.get(
            "code_level"
        )
        for record in records
    )

    unique_codes_by_level = {
        level: len(
            {
                record.get(
                    "normalized_trade_code"
                )
                for record in records
                if record.get(
                    "code_level"
                ) == level
            }
        )
        for level in EXPECTED_LEVEL_LENGTHS
    }

    result = {
        "status": (
            "VALID"
            if not errors
            else "INVALID"
        ),

        "record_count": len(records),

        "level_counts": dict(
            level_counts
        ),

        "unique_codes_by_level": (
            unique_codes_by_level
        ),

        "taric_codes": sorted(
            taric_codes
        ),

        "reference_required_records": len(
            reference_rows
        ),

        "route_counts": dict(
            route_counts
        ),

        "description_conflicts": len(
            description_conflicts
        ),

        "duplicate_country_code_route": len(
            duplicates
        ),

        "errors": errors,
        "warnings": warnings,
    }

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT.write_text(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        "=== DEFINITIVE CODE RECONCILIATION ==="
    )

    print(
        f"Status: {result['status']}"
    )

    print(
        f"Records: {len(records)}"
    )

    print()
    print(
        "Levels:"
    )

    for level in (
        "HS4",
        "HS6",
        "CN8",
        "TARIC10",
    ):
        print(
            f"  {level}: "
            f"{level_counts.get(level, 0)}"
        )

    print()
    print(
        "Unique codes:"
    )

    for level in (
        "HS4",
        "HS6",
        "CN8",
        "TARIC10",
    ):
        print(
            f"  {level}: "
            f"{unique_codes_by_level[level]}"
        )

    print()
    print(
        "Reference-required records:",
        len(reference_rows),
    )

    print(
        "Unexpected TARIC codes:",
        len(unexpected_taric),
    )

    print(
        "Missing expected TARIC codes:",
        len(missing_expected_taric),
    )

    print(
        "Description conflicts:",
        len(description_conflicts),
    )

    print(
        "Duplicate country/code/route identities:",
        len(duplicates),
    )

    print()
    print(
        f"Warnings: {len(warnings)}"
    )

    print(
        f"Errors: {len(errors)}"
    )

    print(
        f"Report: {OUTPUT}"
    )

    if errors:
        print()
        print(
            "First 20 errors:"
        )

        for error in errors[:20]:
            print(
                f"- {error}"
            )

        raise SystemExit(1)


if __name__ == "__main__":
    main()