from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import re

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "raw"
    / "cbam-default-values-2026-02-04.xlsx"
)

OUTPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values.json"
)

WARNINGS_OUTPUT = (
    ROOT
    / "data"
    / "validation"
    / "default-emission-value-warnings.json"
)


SKIP_SHEETS = {
    "Overview",
    "Version History",
}


SECTOR_NAMES = {
    "Cement": "CEMENT",
    "Fertilisers": "FERTILISERS",
    "Hydrogen": "HYDROGEN",
    "Iron and steel": "IRON_STEEL",
    "Aluminium": "ALUMINIUM",
    "Electricity": "ELECTRICITY",
}


ROUTE_CODES = {
    "(A)": "GREY_CLINKER",
    "(B)": "WHITE_CLINKER",
    "(C)": "CARBON_STEEL_BF_BOF",
    "(C)/(F)": "CARBON_OR_LOW_ALLOY_STEEL_BF_BOF",
    "(E)": "CARBON_STEEL_SCRAP_EAF",
    "(E)/(H)": "CARBON_OR_LOW_ALLOY_STEEL_SCRAP_EAF",
    "(F)": "LOW_ALLOY_STEEL_BF_BOF",
    "(H)": "LOW_ALLOY_STEEL_SCRAP_EAF",
    "(K)": "PRIMARY_ALUMINIUM",
    "(L)": "SECONDARY_ALUMINIUM",
}


@dataclass
class DefaultEmissionValue:
    dataset_id: str

    origin_country_name: str
    source_sheet: str

    trade_code: str
    source_trade_code: str
    trade_code_type: str

    sector: str
    product_name: str

    direct_emissions: str | None
    indirect_emissions: str | None
    total_emissions: str | None

    production_route: str | None
    source_production_route_code: str | None

    source_row: int

    record_level: str


def clean(value) -> str | None:
    """
    Convert spreadsheet cell content into a clean string.

    Blank cells, NaN and empty strings become None.
    """
    if pd.isna(value):
        return None

    text = str(value).strip()

    if not text:
        return None

    return text


def normalize_numeric(
    value,
    *,
    sheet_name: str,
    row_number: int,
    field_name: str,
    warnings: list[dict],
) -> str | None:
    """
    Normalize a numeric regulatory value.

    Rules:
    - blank / NaN -> None
    - '-', '–', '_' -> None
    - numeric values -> canonical numeric string
    - unexpected text -> None + warning

    We never silently interpret non-numeric text as zero.
    """

    text = clean(value)

    if text is None:
        return None

    if text in {"–", "-", "_"}:
        return None

    try:
        number = float(text.replace(",", "."))

        return format(number, ".15g")

    except ValueError:
        warnings.append(
            {
                "sheet": sheet_name,
                "row": row_number,
                "field": field_name,
                "raw_value": text,
                "warning": "NON_NUMERIC_REFERENCE_VALUE",
            }
        )

        return None

def normalize_trade_code(value: str) -> tuple[str, str]:
    """
    Normalize source trade codes.

    Supported source code levels:

    4 digits  -> HS heading
    6 digits  -> HS subheading
    8 digits  -> CN
    10 digits -> TARIC

    The original source representation is preserved
    separately for auditability.
    """

    source = value.strip()

    normalized = re.sub(r"\s+", "", source)

    if not normalized.isdigit():
        raise ValueError(
            f"Unexpected trade code: {source!r}"
        )

    code_length = len(normalized)

    if code_length == 4:
        code_type = "HS_HEADING"

    elif code_length == 6:
        code_type = "HS_SUBHEADING"

    elif code_length == 8:
        code_type = "CN"

    elif code_length == 10:
        code_type = "TARIC"

    else:
        raise ValueError(
            f"Unexpected trade code length: "
            f"{source!r} -> {normalized!r}"
        )

    return normalized, code_type


def normalize_route(
    value: str | None,
) -> tuple[str | None, str | None]:
    """
    Convert the source production-route indicator
    into Snowkap's normalized route identifier.
    """

    text = clean(value)

    if text is None:
        return None, None

    normalized = ROUTE_CODES.get(text)

    if normalized is None:
        raise ValueError(
            f"Unknown production route code: {text!r}"
        )

    return normalized, text


def is_sector_row(row: pd.Series) -> str | None:
    """
    Detect a sector/category row.

    Example:
        Cement
        Fertilisers
        Hydrogen
    """

    first = clean(row.iloc[0])

    if first in SECTOR_NAMES:
        return SECTOR_NAMES[first]

    return None


def is_product_row(row: pd.Series) -> bool:
    """
    Detect a likely product row.

    Product rows have:
      column 0 = trade code
      column 1 = description
    """

    trade_code = clean(row.iloc[0])
    description = clean(row.iloc[1])

    if trade_code is None or description is None:
        return False

    if trade_code == "Product CN Code":
        return False

    return True


def parse_sheet(
    sheet_name: str,
    warnings: list[dict],
) -> list[DefaultEmissionValue]:
    """
    Parse one country/territory sheet.
    """

    df = pd.read_excel(
        INPUT,
        sheet_name=sheet_name,
        header=None,
    )

    results: list[DefaultEmissionValue] = []

    current_sector: str | None = None

    for row_index, row in df.iterrows():

        # -----------------------------------------------------
        # Detect sector/category rows
        # -----------------------------------------------------

        detected_sector = is_sector_row(row)

        if detected_sector:
            current_sector = detected_sector
            continue

        # -----------------------------------------------------
        # Ignore anything before the first recognized sector
        # -----------------------------------------------------

        if current_sector is None:
            continue

        # -----------------------------------------------------
        # Ignore non-product rows
        # -----------------------------------------------------

        if not is_product_row(row):
            continue

        source_trade_code = clean(row.iloc[0])
        product_name = clean(row.iloc[1])

        if source_trade_code is None or product_name is None:
            continue

        # -----------------------------------------------------
        # Normalize trade code
        # -----------------------------------------------------

        trade_code, trade_code_type = normalize_trade_code(
            source_trade_code
        )

        # -----------------------------------------------------
        # Normalize production route
        # -----------------------------------------------------

        route_value = (
            row.iloc[8]
            if len(row) > 8
            else None
        )

        production_route, source_route = normalize_route(
            route_value
        )

        # -----------------------------------------------------
               # -----------------------------------------------------
        # Determine record level
        # -----------------------------------------------------

        record_level = {
            "HS_HEADING": "HS_HEADING",
            "HS_SUBHEADING": "HS_SUBHEADING",
            "CN": "TRADE_GOOD",
            "TARIC": "TRADE_GOOD",
        }[trade_code_type]

        # -----------------------------------------------------
        # Build normalized record
        # -----------------------------------------------------

        record = DefaultEmissionValue(
            dataset_id="cbam-default-values-2026-02-04",

            origin_country_name=sheet_name,
            source_sheet=sheet_name,

            trade_code=trade_code,
            source_trade_code=source_trade_code,
            trade_code_type=trade_code_type,

            sector=current_sector,
            product_name=product_name,

            direct_emissions=normalize_numeric(
                row.iloc[2],
                sheet_name=sheet_name,
                row_number=row_index + 1,
                field_name="direct_emissions",
                warnings=warnings,
            ),

            indirect_emissions=normalize_numeric(
                row.iloc[3],
                sheet_name=sheet_name,
                row_number=row_index + 1,
                field_name="indirect_emissions",
                warnings=warnings,
            ),

            total_emissions=normalize_numeric(
                row.iloc[4],
                sheet_name=sheet_name,
                row_number=row_index + 1,
                field_name="total_emissions",
                warnings=warnings,
            ),

            production_route=production_route,
            source_production_route_code=source_route,

            source_row=row_index + 1,

            record_level=record_level,
        )

        results.append(record)

    return results


def main() -> None:
    if not INPUT.exists():
        raise FileNotFoundError(
            f"Workbook not found: {INPUT}"
        )

    warnings: list[dict] = []

    workbook = pd.ExcelFile(INPUT)

    all_records: list[DefaultEmissionValue] = []

    for sheet_name in workbook.sheet_names:

        if sheet_name in SKIP_SHEETS:
            continue

        records = parse_sheet(
            sheet_name,
            warnings,
        )

        all_records.extend(records)

        print(
            f"{sheet_name}: "
            f"{len(records)} records"
        )

    # ---------------------------------------------------------
    # Ensure output directories exist
    # ---------------------------------------------------------

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    WARNINGS_OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    # ---------------------------------------------------------
    # Convert dataclasses to JSON-compatible dictionaries
    # ---------------------------------------------------------

    payload = [
        asdict(record)
        for record in all_records
    ]

    # ---------------------------------------------------------
    # Write normalized dataset
    # ---------------------------------------------------------

    OUTPUT.write_text(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # ---------------------------------------------------------
    # Write validation warnings
    # ---------------------------------------------------------

    WARNINGS_OUTPUT.write_text(
        json.dumps(
            warnings,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # ---------------------------------------------------------
    # Print summary
    # ---------------------------------------------------------

    print()
    print(
        f"Total records: {len(payload)}"
    )

    print(
        f"Output: {OUTPUT}"
    )

    print(
        f"Warnings: {len(warnings)}"
    )

    print(
        f"Warnings output: {WARNINGS_OUTPUT}"
    )


if __name__ == "__main__":
    main()