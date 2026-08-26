from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
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

    direct_emissions: dict
    indirect_emissions: dict
    total_emissions: dict

    production_route: str | None
    source_production_route_code: str | None

    source_row: int

    record_type: str
    record_level: str

    parent_trade_code: str | None


def clean(value) -> str | None:
    if value is None:
        return None

    if pd.isna(value):
        return None

    text = str(value).strip()

    return text if text else None


def normalize_regulatory_value(value) -> dict:
    """
    Preserve the semantic meaning of a regulatory spreadsheet value.

    Numeric:
        AVAILABLE

    Explicit non-applicable markers:
        NOT_APPLICABLE

    Explicit unavailable markers:
        UNAVAILABLE

    Explicit delegation:
        REFERENCE_REQUIRED

    Other non-numeric text:
        SOURCE_TEXT
        This is preserved for review and is never converted to zero.
    """

    if value is None or pd.isna(value):
        return {
            "value": None,
            "status": "UNAVAILABLE",
            "rawSourceValue": None,
        }

    text = str(value).strip()

    if not text:
        return {
            "value": None,
            "status": "UNAVAILABLE",
            "rawSourceValue": None,
        }

    # Normalize only for marker comparison.
    marker = (
        text.upper()
        .replace(" ", "")
    )

    if marker in {
        "-",
        "–",
        "_",
    }:
        return {
            "value": None,
            "status": "UNAVAILABLE",
            "rawSourceValue": text,
        }

    if marker in {
        "N/A",
        "N.A.",
        "N.A",
        "NA",
    }:
        return {
            "value": None,
            "status": "NOT_APPLICABLE",
            "rawSourceValue": text,
        }

    if text.lower() == "see below":
        return {
            "value": None,
            "status": "REFERENCE_REQUIRED",
            "rawSourceValue": text,
        }

    normalized_text = text.replace(",", ".")

    try:
        decimal_value = Decimal(normalized_text)

        return {
            "value": format(decimal_value, "f"),
            "status": "AVAILABLE",
            "rawSourceValue": text,
        }

    except InvalidOperation:
        return {
            "value": None,
            "status": "SOURCE_TEXT",
            "rawSourceValue": text,
        }


def normalize_trade_code(value: str) -> tuple[str, str]:
    """
    Supported code levels:

    4 digits  -> HS heading
    6 digits  -> HS subheading
    8 digits  -> CN
    10 digits -> TARIC
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
            "Unexpected trade code length: "
            f"{source!r} -> {normalized!r}"
        )

    return normalized, code_type


def normalize_route(
    value: str | None,
) -> tuple[str | None, str | None]:

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
    first = clean(row.iloc[0])
    return SECTOR_NAMES.get(first)


def is_product_row(row: pd.Series) -> bool:
    source_code = clean(row.iloc[0])
    description = clean(row.iloc[1])

    if source_code is None or description is None:
        return False

    if source_code == "Product CN Code":
        return False

    return True


def build_record_classification(
    trade_code_type: str,
) -> tuple[str, str]:

    if trade_code_type == "HS_HEADING":
        return "CLASSIFICATION", "HS_HEADING"

    if trade_code_type == "HS_SUBHEADING":
        return "CLASSIFICATION", "HS_SUBHEADING"

    if trade_code_type in {"CN", "TARIC"}:
        return "TRADE_GOOD", "TRADE_GOOD"

    raise ValueError(
        f"Unknown trade code type: {trade_code_type!r}"
    )


def infer_parent_trade_code(
    trade_code: str,
    trade_code_type: str,
) -> str | None:

    if trade_code_type == "HS_HEADING":
        return None

    if trade_code_type == "HS_SUBHEADING":
        return trade_code[:4]

    if trade_code_type == "CN":
        return trade_code[:6]

    if trade_code_type == "TARIC":
        return trade_code[:8]

    return None


def parse_sheet(
    sheet_name: str,
) -> list[DefaultEmissionValue]:

    df = pd.read_excel(
        INPUT,
        sheet_name=sheet_name,
        header=None,
    )

    records: list[DefaultEmissionValue] = []

    current_sector: str | None = None

    for row_index, row in df.iterrows():

        detected_sector = is_sector_row(row)

        if detected_sector is not None:
            current_sector = detected_sector
            continue

        if current_sector is None:
            continue

        if not is_product_row(row):
            continue

        source_trade_code = clean(row.iloc[0])
        product_name = clean(row.iloc[1])

        if (
            source_trade_code is None
            or product_name is None
        ):
            continue

        trade_code, trade_code_type = (
            normalize_trade_code(
                source_trade_code
            )
        )

        record_type, record_level = (
            build_record_classification(
                trade_code_type
            )
        )

        production_route, source_route = (
            normalize_route(
                row.iloc[8]
                if len(row) > 8
                else None
            )
        )

        parent_trade_code = (
            infer_parent_trade_code(
                trade_code,
                trade_code_type,
            )
        )

        record = DefaultEmissionValue(
            dataset_id=(
                "cbam-default-values-2026-02-04"
            ),

            origin_country_name=sheet_name,
            source_sheet=sheet_name,

            trade_code=trade_code,
            source_trade_code=source_trade_code,
            trade_code_type=trade_code_type,

            sector=current_sector,
            product_name=product_name,

            direct_emissions=(
                normalize_regulatory_value(
                    row.iloc[2]
                )
            ),

            indirect_emissions=(
                normalize_regulatory_value(
                    row.iloc[3]
                )
            ),

            total_emissions=(
                normalize_regulatory_value(
                    row.iloc[4]
                )
            ),

            production_route=production_route,
            source_production_route_code=source_route,

            source_row=row_index + 1,

            record_type=record_type,
            record_level=record_level,

            parent_trade_code=parent_trade_code,
        )

        records.append(record)

    return records


def main() -> None:

    if not INPUT.exists():
        raise FileNotFoundError(
            f"Workbook not found: {INPUT}"
        )

    workbook = pd.ExcelFile(INPUT)

    all_records: list[DefaultEmissionValue] = []

    data_sheet_count = 0

    for sheet_name in workbook.sheet_names:

        if sheet_name in SKIP_SHEETS:
            continue

        data_sheet_count += 1

        records = parse_sheet(sheet_name)

        all_records.extend(records)

        print(
            f"{sheet_name}: "
            f"{len(records)} records"
        )

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    payload = [
        asdict(record)
        for record in all_records
    ]

    # Only replace the processed file after the
    # complete workbook has parsed successfully.
    OUTPUT.write_text(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print()
    print(
        f"Total data sheets: {data_sheet_count}"
    )
    print(
        f"Total records: {len(payload)}"
    )
    print(
        f"Output: {OUTPUT}"
    )


if __name__ == "__main__":
    main()