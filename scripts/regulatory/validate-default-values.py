from __future__ import annotations

from collections import Counter
from pathlib import Path
import json
import re


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values.json"
)

WARNINGS_INPUT = (
    ROOT
    / "data"
    / "validation"
    / "default-emission-value-warnings.json"
)

REPORT_OUTPUT = (
    ROOT
    / "data"
    / "validation"
    / "default-emission-values-validation.json"
)


VALID_SECTORS = {
    "CEMENT",
    "FERTILISERS",
    "HYDROGEN",
    "IRON_STEEL",
    "ALUMINIUM",
    "ELECTRICITY",
}


VALID_CODE_TYPES = {
    "HS_HEADING",
    "HS_SUBHEADING",
    "CN",
    "TARIC",
}


VALID_RECORD_LEVELS = {
    "HS_HEADING",
    "HS_SUBHEADING",
    "TRADE_GOOD",
}


VALID_ROUTES = {
    None,
    "GREY_CLINKER",
    "WHITE_CLINKER",
    "CARBON_STEEL_BF_BOF",
    "CARBON_OR_LOW_ALLOY_STEEL_BF_BOF",
    "CARBON_STEEL_SCRAP_EAF",
    "CARBON_OR_LOW_ALLOY_STEEL_SCRAP_EAF",
    "LOW_ALLOY_STEEL_BF_BOF",
    "LOW_ALLOY_STEEL_SCRAP_EAF",
    "PRIMARY_ALUMINIUM",
    "SECONDARY_ALUMINIUM",
}


TRADE_CODE_LENGTHS = {
    "HS_HEADING": 4,
    "HS_SUBHEADING": 6,
    "CN": 8,
    "TARIC": 10,
}


def load_json(path: Path):
    if not path.exists():
        raise FileNotFoundError(path)

    return json.loads(
        path.read_text(encoding="utf-8")
    )


def add_error(
    errors: list[dict],
    code: str,
    message: str,
    record_index: int | None = None,
) -> None:
    errors.append(
        {
            "severity": "ERROR",
            "code": code,
            "message": message,
            "record_index": record_index,
        }
    )


def add_warning(
    warnings: list[dict],
    code: str,
    message: str,
    record_index: int | None = None,
) -> None:
    warnings.append(
        {
            "severity": "WARNING",
            "code": code,
            "message": message,
            "record_index": record_index,
        }
    )


def validate_trade_code(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    code = record.get("trade_code")
    code_type = record.get("trade_code_type")

    if not isinstance(code, str):
        add_error(
            errors,
            "MISSING_TRADE_CODE",
            "trade_code is missing or is not a string",
            index,
        )
        return

    if not code.isdigit():
        add_error(
            errors,
            "INVALID_TRADE_CODE",
            f"Trade code is not numeric: {code!r}",
            index,
        )
        return

    if code_type not in VALID_CODE_TYPES:
        add_error(
            errors,
            "INVALID_TRADE_CODE_TYPE",
            f"Unknown trade_code_type: {code_type!r}",
            index,
        )
        return

    expected_length = TRADE_CODE_LENGTHS[code_type]

    if len(code) != expected_length:
        add_error(
            errors,
            "TRADE_CODE_LENGTH_MISMATCH",
            (
                f"{code_type} expects {expected_length} digits "
                f"but got {code!r}"
            ),
            index,
        )


def validate_required_fields(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    required = [
        "dataset_id",
        "origin_country_name",
        "source_sheet",
        "trade_code",
        "source_trade_code",
        "trade_code_type",
        "sector",
        "product_name",
        "source_row",
        "record_level",
    ]

    for field in required:
        value = record.get(field)

        if value is None or value == "":
            add_error(
                errors,
                "MISSING_REQUIRED_FIELD",
                f"Missing required field: {field}",
                index,
            )


def validate_sector(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    sector = record.get("sector")

    if sector not in VALID_SECTORS:
        add_error(
            errors,
            "INVALID_SECTOR",
            f"Unknown sector: {sector!r}",
            index,
        )


def validate_route(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    route = record.get("production_route")

    if route not in VALID_ROUTES:
        add_error(
            errors,
            "INVALID_PRODUCTION_ROUTE",
            f"Unknown production route: {route!r}",
            index,
        )


def validate_record_level(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    record_level = record.get("record_level")

    if record_level not in VALID_RECORD_LEVELS:
        add_error(
            errors,
            "INVALID_RECORD_LEVEL",
            f"Unknown record level: {record_level!r}",
            index,
        )

    code_type = record.get("trade_code_type")

    expected_level = {
        "HS_HEADING": "HS_HEADING",
        "HS_SUBHEADING": "HS_SUBHEADING",
        "CN": "TRADE_GOOD",
        "TARIC": "TRADE_GOOD",
    }.get(code_type)

    if expected_level != record_level:
        add_error(
            errors,
            "RECORD_LEVEL_MISMATCH",
            (
                f"trade_code_type={code_type!r} "
                f"should have record_level={expected_level!r}, "
                f"got {record_level!r}"
            ),
            index,
        )


def validate_emissions(
    record: dict,
    index: int,
    warnings: list[dict],
) -> None:
    fields = [
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ]

    for field in fields:
        value = record.get(field)

        if value is None:
            add_warning(
                warnings,
                "MISSING_EMISSION_VALUE",
                f"{field} is unavailable",
                index,
            )
            continue

        try:
            float(value)
        except (TypeError, ValueError):
            add_warning(
                warnings,
                "NON_NUMERIC_EMISSION_VALUE",
                f"{field} has non-numeric value: {value!r}",
                index,
            )


def validate_source_row(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    source_row = record.get("source_row")

    if not isinstance(source_row, int):
        add_error(
            errors,
            "INVALID_SOURCE_ROW",
            f"source_row is not an integer: {source_row!r}",
            index,
        )


def duplicate_key(record: dict) -> tuple:
    return (
        record.get("origin_country_name"),
        record.get("trade_code"),
        record.get("trade_code_type"),
        record.get("sector"),
        record.get("product_name"),
        record.get("production_route"),
    )


def main() -> None:
    records = load_json(INPUT)

    source_warnings = (
        load_json(WARNINGS_INPUT)
        if WARNINGS_INPUT.exists()
        else []
    )

    errors: list[dict] = []
    warnings: list[dict] = []

    # ---------------------------------------------------------
    # Record count
    # ---------------------------------------------------------

    record_count = len(records)

    if record_count == 0:
        add_error(
            errors,
            "EMPTY_DATASET",
            "Normalized dataset contains zero records",
        )

    # ---------------------------------------------------------
    # Validate every record
    # ---------------------------------------------------------

    for index, record in enumerate(records):

        validate_required_fields(
            record,
            index,
            errors,
        )

        validate_trade_code(
            record,
            index,
            errors,
        )

        validate_sector(
            record,
            index,
            errors,
        )

        validate_route(
            record,
            index,
            errors,
        )

        validate_record_level(
            record,
            index,
            errors,
        )

        validate_source_row(
            record,
            index,
            errors,
        )

        validate_emissions(
            record,
            index,
            warnings,
        )

    # ---------------------------------------------------------
    # Duplicate detection
    # ---------------------------------------------------------

    keys = [
        duplicate_key(record)
        for record in records
    ]

    counts = Counter(keys)

    duplicate_records = [
        {
            "key": list(key),
            "count": count,
        }
        for key, count in counts.items()
        if count > 1
    ]

    for duplicate in duplicate_records:
        add_error(
            errors,
            "DUPLICATE_REGULATORY_RECORD",
            (
                "Duplicate normalized regulatory key: "
                f"{duplicate['key']}"
            ),
        )

    # ---------------------------------------------------------
    # Warning statistics
    # ---------------------------------------------------------

    source_warning_counts = Counter(
        warning.get("warning")
        for warning in source_warnings
    )

    source_warning_fields = Counter(
        warning.get("field")
        for warning in source_warnings
    )

    # ---------------------------------------------------------
    # Country statistics
    # ---------------------------------------------------------

    country_counts = Counter(
        record.get("origin_country_name")
        for record in records
    )

    sector_counts = Counter(
        record.get("sector")
        for record in records
    )

    code_type_counts = Counter(
        record.get("trade_code_type")
        for record in records
    )

    record_level_counts = Counter(
        record.get("record_level")
        for record in records
    )

    route_counts = Counter(
        record.get("production_route")
        for record in records
    )

    # ---------------------------------------------------------
    # Validation status
    # ---------------------------------------------------------

    status = (
        "VALID"
        if not errors
        else "INVALID"
    )

    report = {
        "status": status,

        "record_count": record_count,

        "errors": errors,
        "error_count": len(errors),

        "warnings": warnings,
        "warning_count": len(warnings),

        "source_warning_count": len(source_warnings),
        "source_warning_types": dict(
            source_warning_counts
        ),
        "source_warning_fields": dict(
            source_warning_fields
        ),

        "country_count": len(country_counts),
        "records_by_country": dict(
            country_counts
        ),

        "records_by_sector": dict(
            sector_counts
        ),

        "records_by_code_type": dict(
            code_type_counts
        ),

        "records_by_record_level": dict(
            record_level_counts
        ),

        "records_by_production_route": {
            str(key): value
            for key, value in route_counts.items()
        },

        "duplicate_record_count": len(
            duplicate_records
        ),

        "duplicate_records": duplicate_records,

        "source_validation_note": (
            "This dataset originated from the "
            "user-provided February 2026 workbook and "
            "is not approved for production regulatory "
            "use until reconciled against the current "
            "corrected official Commission dataset."
        ),
    }

    REPORT_OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    REPORT_OUTPUT.write_text(
        json.dumps(
            report,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print()
    print("=== CBAM DEFAULT VALUE VALIDATION ===")
    print(f"Status: {status}")
    print(f"Records: {record_count}")
    print(f"Errors: {len(errors)}")
    print(f"Warnings: {len(warnings)}")
    print(
        f"Source warnings: {len(source_warnings)}"
    )
    print(
        f"Duplicate regulatory records: "
        f"{len(duplicate_records)}"
    )
    print()
    print(
        f"Validation report: {REPORT_OUTPUT}"
    )

    if errors:
        print()
        print("First 20 validation errors:")

        for error in errors[:20]:
            print(
                f"- {error['code']}: "
                f"{error['message']}"
            )


if __name__ == "__main__":
    main()