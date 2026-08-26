from __future__ import annotations

from collections import Counter
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values.json"
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


VALID_RECORD_TYPES = {
    "CLASSIFICATION",
    "TRADE_GOOD",
}


VALID_RECORD_LEVELS = {
    "HS_HEADING",
    "HS_SUBHEADING",
    "TRADE_GOOD",
}


VALID_VALUE_STATUSES = {
    "AVAILABLE",
    "NOT_APPLICABLE",
    "UNAVAILABLE",
    "REFERENCE_REQUIRED",
    "SOURCE_TEXT",
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


EXPECTED_LENGTH = {
    "HS_HEADING": 4,
    "HS_SUBHEADING": 6,
    "CN": 8,
    "TARIC": 10,
}


def load_json(path: Path):
    if not path.exists():
        raise FileNotFoundError(path)

    return json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


def add_error(
    errors: list[dict],
    code: str,
    message: str,
    index: int,
) -> None:
    errors.append(
        {
            "code": code,
            "message": message,
            "record_index": index,
        }
    )


def validate_value_object(
    value_object,
    field_name: str,
    index: int,
    errors: list[dict],
) -> None:
    """
    Validate a semantic regulatory value object.

    Expected structure:

    {
        "value": "...",
        "status": "...",
        "rawSourceValue": "..."
    }
    """

    if not isinstance(
        value_object,
        dict,
    ):
        add_error(
            errors,
            "INVALID_REGULATORY_VALUE",
            (
                f"{field_name} must be an object; "
                "the processed dataset may be stale."
            ),
            index,
        )
        return

    required_keys = {
        "value",
        "status",
        "rawSourceValue",
    }

    missing = required_keys.difference(
        value_object.keys()
    )

    if missing:
        add_error(
            errors,
            "INVALID_REGULATORY_VALUE",
            (
                f"{field_name} is missing keys: "
                f"{sorted(missing)}"
            ),
            index,
        )
        return

    status = value_object["status"]
    value = value_object["value"]

    if status not in VALID_VALUE_STATUSES:
        add_error(
            errors,
            "INVALID_VALUE_STATUS",
            (
                f"{field_name} has unknown "
                f"status={status!r}"
            ),
            index,
        )
        return

    if status == "AVAILABLE":
        if value is None:
            add_error(
                errors,
                "AVAILABLE_VALUE_MISSING",
                (
                    f"{field_name} is AVAILABLE "
                    "but value is null."
                ),
                index,
            )
        else:
            try:
                float(value)
            except (TypeError, ValueError):
                add_error(
                    errors,
                    "AVAILABLE_VALUE_NOT_NUMERIC",
                    (
                        f"{field_name} has non-numeric "
                        f"value={value!r}"
                    ),
                    index,
                )

    else:
        if value is not None:
            add_error(
                errors,
                "NONAVAILABLE_VALUE_PRESENT",
                (
                    f"{field_name} has status="
                    f"{status!r} but value="
                    f"{value!r}"
                ),
                index,
            )


def validate_trade_code(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    code = record.get(
        "trade_code"
    )

    code_type = record.get(
        "trade_code_type"
    )

    if not isinstance(
        code,
        str,
    ):
        add_error(
            errors,
            "INVALID_TRADE_CODE",
            f"Trade code is invalid: {code!r}",
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
            f"Unknown code type: {code_type!r}",
            index,
        )
        return

    expected_length = EXPECTED_LENGTH[
        code_type
    ]

    if len(code) != expected_length:
        add_error(
            errors,
            "TRADE_CODE_LENGTH_MISMATCH",
            (
                f"{code_type} requires "
                f"{expected_length} digits; "
                f"got {code!r}"
            ),
            index,
        )


def validate_classification(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    code_type = record.get(
        "trade_code_type"
    )

    record_type = record.get(
        "record_type"
    )

    record_level = record.get(
        "record_level"
    )

    expected_record_type = {
        "HS_HEADING": "CLASSIFICATION",
        "HS_SUBHEADING": "CLASSIFICATION",
        "CN": "TRADE_GOOD",
        "TARIC": "TRADE_GOOD",
    }.get(code_type)

    expected_record_level = {
        "HS_HEADING": "HS_HEADING",
        "HS_SUBHEADING": "HS_SUBHEADING",
        "CN": "TRADE_GOOD",
        "TARIC": "TRADE_GOOD",
    }.get(code_type)

    if record_type != expected_record_type:
        add_error(
            errors,
            "RECORD_TYPE_MISMATCH",
            (
                f"code type {code_type!r} requires "
                f"record type {expected_record_type!r}; "
                f"got {record_type!r}"
            ),
            index,
        )

    if record_level != expected_record_level:
        add_error(
            errors,
            "RECORD_LEVEL_MISMATCH",
            (
                f"code type {code_type!r} requires "
                f"record level {expected_record_level!r}; "
                f"got {record_level!r}"
            ),
            index,
        )


def validate_parent(
    record: dict,
    index: int,
    errors: list[dict],
) -> None:
    code = record.get(
        "trade_code"
    )

    code_type = record.get(
        "trade_code_type"
    )

    parent = record.get(
        "parent_trade_code"
    )

    if code_type == "HS_HEADING":
        expected_parent = None
    elif code_type == "HS_SUBHEADING":
        expected_parent = code[:4]
    elif code_type == "CN":
        expected_parent = code[:6]
    elif code_type == "TARIC":
        expected_parent = code[:8]
    else:
        expected_parent = None

    if parent != expected_parent:
        add_error(
            errors,
            "PARENT_CODE_MISMATCH",
            (
                f"Expected parent={expected_parent!r}; "
                f"got {parent!r}"
            ),
            index,
        )


def duplicate_key(
    record: dict,
) -> tuple:
    return (
        record.get(
            "origin_country_name"
        ),
        record.get(
            "trade_code"
        ),
        record.get(
            "trade_code_type"
        ),
        record.get(
            "sector"
        ),
        record.get(
            "product_name"
        ),
        record.get(
            "production_route"
        ),
    )


def main() -> None:
    records = load_json(
        INPUT
    )

    errors: list[dict] = []

    # This collects unresolved source text such as
    # "N/(A" without treating it as a numeric value.
    source_text_values: list[dict] = []

    # ---------------------------------------------------------
    # Record validation
    # ---------------------------------------------------------

    for index, record in enumerate(
        records
    ):
        required_fields = [
            "dataset_id",
            "origin_country_name",
            "source_sheet",
            "trade_code",
            "source_trade_code",
            "trade_code_type",
            "sector",
            "product_name",
            "source_row",
            "record_type",
            "record_level",
            "parent_trade_code",
        ]

        for field in required_fields:
            if field not in record:
                add_error(
                    errors,
                    "MISSING_FIELD",
                    f"Missing field: {field}",
                    index,
                )

        if record.get(
            "sector"
        ) not in VALID_SECTORS:
            add_error(
                errors,
                "INVALID_SECTOR",
                (
                    "Invalid sector: "
                    f"{record.get('sector')!r}"
                ),
                index,
            )

        if record.get(
            "production_route"
        ) not in VALID_ROUTES:
            add_error(
                errors,
                "INVALID_PRODUCTION_ROUTE",
                (
                    "Invalid production route: "
                    f"{record.get('production_route')!r}"
                ),
                index,
            )

        validate_trade_code(
            record,
            index,
            errors,
        )

        validate_classification(
            record,
            index,
            errors,
        )

        validate_parent(
            record,
            index,
            errors,
        )

        # -----------------------------------------------------
        # Validate the three emissions value objects
        # -----------------------------------------------------

        for field_name in (
            "direct_emissions",
            "indirect_emissions",
            "total_emissions",
        ):
            value_object = record.get(
                field_name
            )

            validate_value_object(
                value_object,
                field_name,
                index,
                errors,
            )

            # -------------------------------------------------
            # Capture unresolved source text
            # -------------------------------------------------

            if (
                isinstance(
                    value_object,
                    dict,
                )
                and value_object.get(
                    "status"
                ) == "SOURCE_TEXT"
            ):
                source_text_values.append(
                    {
                        "record_index": index,
                        "sheet": record.get(
                            "source_sheet"
                        ),
                        "row": record.get(
                            "source_row"
                        ),
                        "trade_code": record.get(
                            "trade_code"
                        ),
                        "product_name": record.get(
                            "product_name"
                        ),
                        "field": field_name,
                        "raw_source_value": (
                            value_object.get(
                                "rawSourceValue"
                            )
                        ),
                    }
                )

    # ---------------------------------------------------------
    # Duplicate detection
    # ---------------------------------------------------------

    counts = Counter(
        duplicate_key(record)
        for record in records
    )

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
                "Duplicate normalized key: "
                f"{duplicate['key']}"
            ),
            -1,
        )

    # ---------------------------------------------------------
    # Regulatory value status statistics
    # ---------------------------------------------------------

    value_status_counts: dict[str, dict] = {}

    for field_name in (
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ):
        counter = Counter()

        for record in records:
            value_object = record.get(
                field_name
            )

            if isinstance(
                value_object,
                dict,
            ):
                status = value_object.get(
                    "status"
                )

                counter[status] += 1

            else:
                counter[
                    "INVALID_OBJECT"
                ] += 1

        value_status_counts[
            field_name
        ] = dict(counter)

    # ---------------------------------------------------------
    # Overall report
    # ---------------------------------------------------------

    report = {
        "status": (
            "VALID"
            if not errors
            else "INVALID"
        ),
        "record_count": len(
            records
        ),
        "error_count": len(
            errors
        ),
        "duplicate_record_count": len(
            duplicate_records
        ),
        "errors": errors,
        "value_status_counts": (
            value_status_counts
        ),
        "source_text_value_count": len(
            source_text_values
        ),
        "source_text_values": (
            source_text_values
        ),
    }

    # ---------------------------------------------------------
    # Write validation report
    # ---------------------------------------------------------

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

    # ---------------------------------------------------------
    # Console summary
    # ---------------------------------------------------------

    print()
    print(
        "=== CBAM DEFAULT VALUE VALIDATION ==="
    )
    print(
        f"Status: {report['status']}"
    )
    print(
        f"Records: {len(records)}"
    )
    print(
        f"Errors: {len(errors)}"
    )
    print(
        "Source text values: "
        f"{len(source_text_values)}"
    )
    print(
        "Duplicate regulatory records: "
        f"{len(duplicate_records)}"
    )
    print(
        f"Validation report: "
        f"{REPORT_OUTPUT}"
    )

    if errors:
        print()
        print(
            "First 20 errors:"
        )

        for error in errors[:20]:
            print(
                f"- {error['code']}: "
                f"{error['message']}"
            )


if __name__ == "__main__":
    main()