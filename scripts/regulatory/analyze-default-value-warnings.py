from __future__ import annotations

from collections import Counter
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]

RECORDS_FILE = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values.json"
)

WARNINGS_FILE = (
    ROOT
    / "data"
    / "validation"
    / "default-emission-value-warnings.json"
)

OUTPUT_FILE = (
    ROOT
    / "data"
    / "validation"
    / "default-emission-warning-analysis.json"
)


def load_json(path: Path):
    return json.loads(
        path.read_text(encoding="utf-8")
    )


def main() -> None:
    records = load_json(RECORDS_FILE)
    source_warnings = load_json(WARNINGS_FILE)

    # ---------------------------------------------------------
    # Basic statistics
    # ---------------------------------------------------------

    print("=== WARNING ANALYSIS ===")
    print(f"Records: {len(records)}")
    print(f"Source warnings: {len(source_warnings)}")

    # ---------------------------------------------------------
    # Source-warning types
    # ---------------------------------------------------------

    warning_types = Counter(
        warning.get("warning")
        for warning in source_warnings
    )

    warning_fields = Counter(
        warning.get("field")
        for warning in source_warnings
    )

    warning_sheets = Counter(
        warning.get("sheet")
        for warning in source_warnings
    )

    print("\nSource warning types:")
    for key, count in warning_types.most_common():
        print(f"  {key}: {count}")

    print("\nFields:")
    for key, count in warning_fields.most_common():
        print(f"  {key}: {count}")

    print("\nTop sheets:")
    for key, count in warning_sheets.most_common(20):
        print(f"  {key}: {count}")

    # ---------------------------------------------------------
    # Missing emissions
    # ---------------------------------------------------------

    missing_emissions = []

    for record in records:

        missing = []

        for field in (
            "direct_emissions",
            "indirect_emissions",
            "total_emissions",
        ):
            if record.get(field) is None:
                missing.append(field)

        if missing:
            missing_emissions.append(
                {
                    "origin_country_name": record.get(
                        "origin_country_name"
                    ),
                    "trade_code": record.get(
                        "trade_code"
                    ),
                    "trade_code_type": record.get(
                        "trade_code_type"
                    ),
                    "record_level": record.get(
                        "record_level"
                    ),
                    "sector": record.get(
                        "sector"
                    ),
                    "product_name": record.get(
                        "product_name"
                    ),
                    "missing_fields": missing,
                    "source_row": record.get(
                        "source_row"
                    ),
                }
            )

    print(
        f"\nRecords with at least one missing "
        f"emission value: {len(missing_emissions)}"
    )

    # ---------------------------------------------------------
    # Missing emissions by record level
    # ---------------------------------------------------------

    missing_by_record_level = Counter(
        item["record_level"]
        for item in missing_emissions
    )

    print("\nMissing emissions by record level:")

    for key, count in missing_by_record_level.most_common():
        print(f"  {key}: {count}")

    # ---------------------------------------------------------
    # Missing emissions by sector
    # ---------------------------------------------------------

    missing_by_sector = Counter(
        item["sector"]
        for item in missing_emissions
    )

    print("\nMissing emissions by sector:")

    for key, count in missing_by_sector.most_common():
        print(f"  {key}: {count}")

    # ---------------------------------------------------------
    # Build report
    # ---------------------------------------------------------

    report = {
        "record_count": len(records),
        "source_warning_count": len(source_warnings),
        "source_warning_types": dict(
            warning_types
        ),
        "source_warning_fields": dict(
            warning_fields
        ),
        "top_warning_sheets": dict(
            warning_sheets.most_common(20)
        ),
        "missing_emission_record_count": len(
            missing_emissions
        ),
        "missing_emissions_by_record_level": dict(
            missing_by_record_level
        ),
        "missing_emissions_by_sector": dict(
            missing_by_sector
        ),
        "missing_emission_examples": (
            missing_emissions[:100]
        ),
    }

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_FILE.write_text(
        json.dumps(
            report,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        f"\nAnalysis report: {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()