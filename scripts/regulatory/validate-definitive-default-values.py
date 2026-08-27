from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
import json
import re
import sys


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

REPORT_OUTPUT = (
    ROOT
    / "data"
    / "validation"
    / "definitive-default-values-validation.json"
)


EXPECTED_DATASET_ID = (
    "cbam-default-values-2026-definitive-corrected"
)

EXPECTED_SHEETS = 122

EXPECTED_CODE_LEVELS = {
    "HS4": 4,
    "HS6": 6,
    "CN8": 8,
    "TARIC10": 10,
}

EXPECTED_STATUSES = {
    "AVAILABLE",
    "UNAVAILABLE",
    "REFERENCE_REQUIRED",
    "NOT_APPLICABLE",
    "SOURCE_TEXT",
}

EXPECTED_UNITS = {
    "TCO2E_PER_TONNE",
    "TCO2_PER_TONNE",
    "TCO2_PER_MWH",
}

VALID_ROUTE_CODES = {
    "(A)",
    "(B)",
    "(C)",
    "(C)/(F)",
    "(D)",
    "(E)",
    "(E)/(H)",
    "(F)",
    "(G)",
    "(H)",
    "(J)",
    "(K)",
    "(L)",
}


def load_json(
    path: Path,
):
    if not path.exists():
        raise FileNotFoundError(path)

    with path.open(
        "r",
        encoding="utf-8",
    ) as handle:
        return json.load(handle)


def add_error(
    errors: list[str],
    message: str,
) -> None:
    errors.append(message)


def add_warning(
    warnings: list[str],
    message: str,
) -> None:
    warnings.append(message)

def validate_value(
    record: dict,
    field_name: str,
    errors: list[str],
    warnings: list[str],
) -> None:
    value_object = record.get(field_name)

    if not isinstance(value_object, dict):
        add_error(
            errors,
            f"{field_name}: expected object",
        )
        return

    value = value_object.get("value")
    status = value_object.get("status")
    raw = value_object.get("raw_source_value")

    if status not in EXPECTED_STATUSES:
        add_error(
            errors,
            f"{field_name}: invalid status {status!r}",
        )
        return

    if status == "AVAILABLE":
        if value is None:
            add_error(
                errors,
                f"{field_name}: AVAILABLE requires a numeric value",
            )
            return

        if not isinstance(value, str):
            add_error(
                errors,
                f"{field_name}: AVAILABLE value must be a string",
            )
            return

        try:
            decimal_value = Decimal(value)
        except InvalidOperation:
            add_error(
                errors,
                f"{field_name}: invalid decimal {value!r}",
            )
            return

        if not decimal_value.is_finite():
            add_error(
                errors,
                f"{field_name}: value must be finite",
            )

        if decimal_value < 0:
            add_error(
                errors,
                f"{field_name}: negative emission value {value!r}",
            )

        if raw is None:
            add_warning(
                warnings,
                f"{field_name}: AVAILABLE value has no raw_source_value",
            )

        return

    # Non-AVAILABLE statuses must not contain a numeric value.
    if value is not None:
        add_error(
            errors,
            f"{field_name}: status={status!r} must have value=null",
        )

    # A missing raw source is acceptable for a genuinely unavailable
    # blank source cell. For semantic/reference states, retain a warning.
    if (
        status in {
            "REFERENCE_REQUIRED",
            "NOT_APPLICABLE",
            "SOURCE_TEXT",
        }
        and raw is None
    ):
        add_warning(
            warnings,
            f"{field_name}: status={status!r} "
            "has no raw_source_value",
        )

def validate_record(
    record: dict,
    index: int,
    errors: list[str],
    warnings: list[str],
) -> None:

    required_fields = {
        "dataset_id",
        "origin_country_name",
        "source_sheet",
        "source_row",
        "source_trade_code",
        "normalized_trade_code",
        "code_level",
        "sector",
        "product_name",
        "emission_unit",
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
        "source_production_route_code",
        "production_route",
    }

    missing = required_fields.difference(
        record
    )

    for field in sorted(missing):
        add_error(
            errors,
            f"record[{index}]: missing field "
            f"{field!r}",
        )

    if (
        record.get("dataset_id")
        != EXPECTED_DATASET_ID
    ):
        add_error(
            errors,
            f"record[{index}]: unexpected dataset_id "
            f"{record.get('dataset_id')!r}",
        )

    source_code = record.get(
        "source_trade_code"
    )

    normalized_code = record.get(
        "normalized_trade_code"
    )

    code_level = record.get(
        "code_level"
    )

    if not isinstance(
        normalized_code,
        str,
    ):
        add_error(
            errors,
            f"record[{index}]: normalized_trade_code "
            "must be a string",
        )
    else:

        if not normalized_code.isdigit():
            add_error(
                errors,
                f"record[{index}]: normalized trade "
                f"code is not numeric: {normalized_code!r}",
            )

        expected_length = (
            EXPECTED_CODE_LEVELS.get(
                code_level
            )
        )

        if expected_length is None:
            add_error(
                errors,
                f"record[{index}]: invalid code_level "
                f"{code_level!r}",
            )
        elif len(normalized_code) != expected_length:
            add_error(
                errors,
                f"record[{index}]: code level "
                f"{code_level!r} requires "
                f"{expected_length} digits, got "
                f"{normalized_code!r}",
            )

    if (
        isinstance(source_code, str)
        and isinstance(normalized_code, str)
    ):
        expected_normalized = re.sub(
            r"\s+",
            "",
            source_code.strip(),
        )

        if expected_normalized != normalized_code:
            add_error(
                errors,
                f"record[{index}]: source/normalized "
                "trade code mismatch",
            )

    source_row = record.get(
        "source_row"
    )

    if (
        not isinstance(source_row, int)
        or source_row <= 0
    ):
        add_error(
            errors,
            f"record[{index}]: invalid source_row "
            f"{source_row!r}",
        )

    if not record.get(
        "origin_country_name"
    ):
        add_error(
            errors,
            f"record[{index}]: missing origin country",
        )

    if not record.get(
        "source_sheet"
    ):
        add_error(
            errors,
            f"record[{index}]: missing source sheet",
        )

    if not record.get(
        "product_name"
    ):
        add_error(
            errors,
            f"record[{index}]: missing product name",
        )

    emission_unit = record.get(
        "emission_unit"
    )

    if emission_unit not in EXPECTED_UNITS:
        add_error(
            errors,
            f"record[{index}]: invalid emission unit "
            f"{emission_unit!r}",
        )

    route_code = record.get(
        "source_production_route_code"
    )

    production_route = record.get(
        "production_route"
    )

    if route_code is not None:
        if route_code not in VALID_ROUTE_CODES:
            add_error(
                errors,
                f"record[{index}]: unknown production route "
                f"{route_code!r}",
            )

        if production_route is None:
            add_error(
                errors,
                f"record[{index}]: route code "
                f"{route_code!r} has no normalized route",
            )

    if (
        route_code is None
        and production_route is not None
    ):
        add_error(
            errors,
            f"record[{index}]: normalized route exists "
            "without source route code",
        )

    for field_name in (
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ):
        validate_value(
    record,
    field_name,
    errors,
    warnings,
)


def validate_dataset(
    records: list[dict],
) -> dict:

    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(
        records,
        list,
    ):
        raise ValueError(
            "Processed dataset must be a JSON array."
        )

    if not records:
        add_error(
            errors,
            "Dataset contains zero records.",
        )

    for index, record in enumerate(
        records
    ):
        if not isinstance(
            record,
            dict,
        ):
            add_error(
                errors,
                f"record[{index}]: expected object",
            )
            continue

        validate_record(
            record,
            index,
            errors,
            warnings,
        )

    source_identity = Counter()

    for record in records:

        identity = (
            record.get("source_sheet"),
            record.get("source_row"),
        )

        source_identity[
            identity
        ] += 1

    duplicate_source_rows = {
        identity: count
        for identity, count
        in source_identity.items()
        if count > 1
    }

    for identity, count in (
        duplicate_source_rows.items()
    ):
        add_error(
            errors,
            f"duplicate source location: "
            f"{identity!r} occurs {count} times",
        )

    regulatory_identity = Counter()

    for record in records:

        identity = (
            record.get(
                "dataset_id"
            ),
            record.get(
                "origin_country_name"
            ),
            record.get(
                "normalized_trade_code"
            ),
            record.get(
                "source_production_route_code"
            ),
            record.get(
                "product_name"
            ),
        )

        regulatory_identity[
            identity
        ] += 1

    duplicate_regulatory_records = {
        identity: count
        for identity, count
        in regulatory_identity.items()
        if count > 1
    }

    for identity, count in (
        duplicate_regulatory_records.items()
    ):
        add_error(
            errors,
            f"duplicate regulatory identity: "
            f"{identity!r} occurs {count} times",
        )

    sheets = {
        record.get(
            "source_sheet"
        )
        for record in records
    }

    if len(sheets) != EXPECTED_SHEETS:
        add_warning(
            warnings,
            f"Expected {EXPECTED_SHEETS} "
            f"data sheets but found {len(sheets)}.",
        )

    code_level_counts = Counter(
        record.get(
            "code_level"
        )
        for record in records
    )

    unit_counts = Counter(
        record.get(
            "emission_unit"
        )
        for record in records
    )

    status_counts = {}

    for field_name in (
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ):
        status_counts[
            field_name
        ] = Counter(
            record.get(
                field_name,
                {},
            ).get(
                "status"
            )
            for record in records
        )

    route_counts = Counter(
        record.get(
            "source_production_route_code"
        )
        for record in records
        if record.get(
            "source_production_route_code"
        )
    )

    reference_records = [
        record
        for record in records
        if any(
            record.get(field, {}).get("status")
            == "REFERENCE_REQUIRED"
            for field in (
                "direct_emissions",
                "indirect_emissions",
                "total_emissions",
            )
        )
    ]

    all_three_reference = [
        record
        for record in reference_records
        if all(
            record.get(field, {}).get("status")
            == "REFERENCE_REQUIRED"
            for field in (
                "direct_emissions",
                "indirect_emissions",
                "total_emissions",
            )
        )
    ]

    summary = {
        "record_count": len(records),
        "sheet_count": len(sheets),
        "code_level_counts": dict(
            code_level_counts
        ),
        "unit_counts": dict(
            unit_counts
        ),
        "status_counts": {
            field: dict(counter)
            for field, counter
            in status_counts.items()
        },
        "production_route_counts": dict(
            route_counts
        ),
        "reference_required_records": len(
            reference_records
        ),
        "reference_required_all_three": len(
            all_three_reference
        ),
        "duplicate_source_rows": len(
            duplicate_source_rows
        ),
        "duplicate_regulatory_records": len(
            duplicate_regulatory_records
        ),
        "error_count": len(errors),
        "warning_count": len(warnings),
    }

    return {
        "status": (
            "VALID"
            if not errors
            else "INVALID"
        ),
        "summary": summary,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> None:

    records = load_json(
        INPUT
    )

    result = validate_dataset(
        records
    )

    REPORT_OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    REPORT_OUTPUT.write_text(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        "=== DEFINITIVE CBAM DEFAULT VALUE VALIDATION ==="
    )
    print(
        f"Status: {result['status']}"
    )
    print(
        f"Records: "
        f"{result['summary']['record_count']}"
    )
    print(
        f"Schemas/sheets: "
        f"{result['summary']['sheet_count']}"
    )
    print(
        f"Errors: "
        f"{result['summary']['error_count']}"
    )
    print(
        f"Warnings: "
        f"{result['summary']['warning_count']}"
    )
    print(
        f"Reference-required records: "
        f"{result['summary']['reference_required_records']}"
    )
    print(
        f"Duplicate source rows: "
        f"{result['summary']['duplicate_source_rows']}"
    )
    print(
        f"Duplicate regulatory records: "
        f"{result['summary']['duplicate_regulatory_records']}"
    )
    print(
        f"Validation report: "
        f"{REPORT_OUTPUT}"
    )

    if result["errors"]:
        print()
        print(
            "First 20 validation errors:"
        )

        for error in result["errors"][:20]:
            print(
                f"- {error}"
            )

        sys.exit(1)


if __name__ == "__main__":
    main()