from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
import json
import re
from typing import Literal

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "raw"
    / "cbam-default-values-2026-definitive-corrected.xlsx"
)

OUTPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

PROFILE_OUTPUT = (
    ROOT
    / "data"
    / "validation"
    / "definitive-default-values-profile.json"
)


DATASET_ID = "cbam-default-values-2026-definitive-corrected"

SKIP_SHEETS = {
    "Overview",
    "Version History",
    "Annex IV",
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
    "(A)": "GREY_CLINKER_CEMENT",
    "(B)": "WHITE_CLINKER_CEMENT",

    "(C)": "CARBON_STEEL_BF_BOF",
    "(C)/(F)": "CARBON_OR_LOW_ALLOY_STEEL_BF_BOF",

    "(D)": "CARBON_STEEL_DRI_EAF",

    "(E)": "CARBON_STEEL_SCRAP_EAF",
    "(E)/(H)": "CARBON_OR_LOW_ALLOY_STEEL_SCRAP_EAF",

    "(F)": "LOW_ALLOY_STEEL_BF_BOF",
    "(G)": "LOW_ALLOY_STEEL_DRI_EAF",
    "(H)": "LOW_ALLOY_STEEL_SCRAP_EAF",

    "(J)": "HIGH_ALLOY_STEEL_EAF",

    "(K)": "PRIMARY_ALUMINIUM",
    "(L)": "SECONDARY_ALUMINIUM",
}

CodeLevel = Literal[
    "HS4",
    "HS6",
    "CN8",
    "TARIC10",
]

ValueStatus = Literal[
    "AVAILABLE",
    "UNAVAILABLE",
    "REFERENCE_REQUIRED",
    "NOT_APPLICABLE",
    "SOURCE_TEXT",
]


@dataclass
class RegulatoryValue:
    value: str | None
    status: ValueStatus
    raw_source_value: str | None


@dataclass
class DefinitiveEmissionValue:
    dataset_id: str

    origin_country_name: str
    source_sheet: str
    source_row: int

    source_trade_code: str
    normalized_trade_code: str
    code_level: CodeLevel

    sector: str
    product_name: str

    emission_unit: str

    direct_emissions: RegulatoryValue
    indirect_emissions: RegulatoryValue
    total_emissions: RegulatoryValue

    source_production_route_code: str | None
    production_route: str | None


def clean(value) -> str | None:
    if value is None or pd.isna(value):
        return None

    text = str(value).strip()

    return text if text else None


def normalize_header_text(value: str | None) -> str:
    if value is None:
        return ""

    return re.sub(
        r"\s+",
        " ",
        value.strip().lower(),
    )


def normalize_trade_code(value: str) -> tuple[str, CodeLevel]:
    source = value.strip()

    normalized = re.sub(
        r"\s+",
        "",
        source,
    )

    if not normalized.isdigit():
        raise ValueError(
            f"Invalid trade code: {source!r}"
        )

    length = len(normalized)

    if length == 4:
        level: CodeLevel = "HS4"
    elif length == 6:
        level = "HS6"
    elif length == 8:
        level = "CN8"
    elif length == 10:
        level = "TARIC10"
    else:
        raise ValueError(
            f"Unsupported trade-code length: "
            f"{source!r} -> {normalized!r}"
        )

    return normalized, level


def normalize_regulatory_value(
    value,
) -> RegulatoryValue:

    text = clean(value)

    if text is None:
        return RegulatoryValue(
            value=None,
            status="UNAVAILABLE",
            raw_source_value=None,
        )

    marker = (
        text
        .strip()
        .upper()
        .replace(" ", "")
    )

    if marker in {
        "-",
        "–",
        "_",
    }:
        return RegulatoryValue(
            value=None,
            status="UNAVAILABLE",
            raw_source_value=text,
        )

    if marker in {
        "N/A",
        "N.A.",
        "N.A",
        "NA",
        "N/(A)",
        "N/(A",
    }:
        return RegulatoryValue(
            value=None,
            status="NOT_APPLICABLE",
            raw_source_value=text,
        )

    if text.lower() == "see below":
        return RegulatoryValue(
            value=None,
            status="REFERENCE_REQUIRED",
            raw_source_value=text,
        )

    normalized = (
        text
        .replace(",", ".")
        .replace("\u00a0", "")
    )

    try:
        decimal_value = Decimal(normalized)

    except InvalidOperation:
        return RegulatoryValue(
            value=None,
            status="SOURCE_TEXT",
            raw_source_value=text,
        )

    if not decimal_value.is_finite():
        return RegulatoryValue(
            value=None,
            status="SOURCE_TEXT",
            raw_source_value=text,
        )

    return RegulatoryValue(
        value=format(decimal_value, "f"),
        status="AVAILABLE",
        raw_source_value=text,
    )


def normalize_route(
    value,
) -> tuple[str | None, str | None]:

    text = clean(value)

    if text is None:
        return None, None

    route = ROUTE_CODES.get(text)

    if route is None:
        raise ValueError(
            f"Unknown production route code: {text!r}"
        )

    return route, text


def detect_sector(
    value,
) -> str | None:

    text = clean(value)

    if text is None:
        return None

    return SECTOR_NAMES.get(text)


def find_header_row(
    df: pd.DataFrame,
) -> int | None:

    for row_index in range(
        min(len(df), 15)
    ):
        values = [
            clean(value)
            for value in df.iloc[row_index].tolist()
        ]

        text = " ".join(
            value
            for value in values
            if value
        )

        normalized = normalize_header_text(
            text
        )

        if (
            "product cn code" in normalized
            or "product cn code / taric code"
            in normalized
        ):
            return row_index

    return None


def detect_emission_unit(
    header_row: pd.Series,
) -> str:

    text = " ".join(
        clean(value) or ""
        for value in header_row.tolist()
    )

    normalized = (
        text
        .lower()
        .replace(" ", "")
    )

    if (
        "tco2eq/tonneofgood"
        in normalized
        or "tco2eq/tonne"
        in normalized
    ):
        return "TCO2E_PER_TONNE"

    if "tco2/tonne" in normalized:
        return "TCO2_PER_TONNE"

    if "tco2/mwh" in normalized:
        return "TCO2_PER_MWH"

    raise ValueError(
        "Unable to determine emission unit "
        f"from header: {text!r}"
    )


def looks_like_product_row(
    row: pd.Series,
) -> bool:

    code = clean(
        row.iloc[0]
    ) if len(row) > 0 else None

    description = clean(
        row.iloc[1]
    ) if len(row) > 1 else None

    if code is None or description is None:
        return False

    normalized_code = re.sub(
        r"\s+",
        "",
        code,
    )

    if not normalized_code.isdigit():
        return False

    return len(normalized_code) in {
        4,
        6,
        8,
        10,
    }


def parse_sheet(
    sheet_name: str,
) -> list[DefinitiveEmissionValue]:

    df = pd.read_excel(
        INPUT,
        sheet_name=sheet_name,
        header=None,
    )

    header_index = find_header_row(
        df
    )

    if header_index is None:
        raise ValueError(
            f"Unable to locate product header "
            f"on sheet {sheet_name!r}"
        )

    emission_unit = detect_emission_unit(
        df.iloc[header_index]
    )

    results: list[DefinitiveEmissionValue] = []

    current_sector: str | None = None

    for row_index in range(
        header_index + 1,
        len(df),
    ):
        row = df.iloc[row_index]

        detected_sector = detect_sector(
            row.iloc[0]
            if len(row) > 0
            else None
        )

        if detected_sector is not None:
            current_sector = detected_sector
            continue

        if current_sector is None:
            continue

        if not looks_like_product_row(row):
            continue

        if len(row) < 5:
            raise ValueError(
                f"Product-like row has only "
                f"{len(row)} columns: "
                f"sheet={sheet_name!r}, "
                f"row={row_index + 1}"
            )

        source_trade_code = clean(
            row.iloc[0]
        )

        product_name = clean(
            row.iloc[1]
        )

        if (
            source_trade_code is None
            or product_name is None
        ):
            continue

        normalized_trade_code, code_level = (
            normalize_trade_code(
                source_trade_code
            )
        )

        source_route_code = (
            clean(row.iloc[5])
            if len(row) > 5
            else None
        )

        production_route, normalized_route = (
            normalize_route(
                source_route_code
            )
        )

        record = DefinitiveEmissionValue(
            dataset_id=DATASET_ID,

            origin_country_name=sheet_name,
            source_sheet=sheet_name,
            source_row=row_index + 1,

            source_trade_code=(
                source_trade_code
            ),

            normalized_trade_code=(
                normalized_trade_code
            ),

            code_level=code_level,

            sector=current_sector,
            product_name=product_name,

            emission_unit=emission_unit,

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

            source_production_route_code=(
                normalized_route
            ),

            production_route=production_route,
        )

        results.append(record)

    return results


def calculate_sha256(
    path: Path,
) -> str:

    digest = sha256()

    with path.open("rb") as handle:
        for chunk in iter(
            lambda: handle.read(1024 * 1024),
            b"",
        ):
            digest.update(chunk)

    return digest.hexdigest()


def main() -> None:

    if not INPUT.exists():
        raise FileNotFoundError(INPUT)

    workbook = pd.ExcelFile(
        INPUT
    )

    data_sheets = [
        sheet
        for sheet in workbook.sheet_names
        if sheet not in SKIP_SHEETS
    ]

    all_records: list[
        DefinitiveEmissionValue
    ] = []

    sheet_profiles = []

    for sheet_name in data_sheets:

        records = parse_sheet(
            sheet_name
        )

        all_records.extend(records)

        sheet_profiles.append(
            {
                "sheet": sheet_name,
                "record_count": len(records),
            }
        )

        print(
            f"{sheet_name}: "
            f"{len(records)} records"
        )

    if not all_records:
        raise ValueError(
            "No regulatory records were parsed."
        )

    payload = [
        asdict(record)
        for record in all_records
    ]

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT.write_text(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    code_level_counts = Counter(
        record.code_level
        for record in all_records
    )

    status_counts = {
        field: Counter(
            getattr(
                record,
                field
            ).status
            for record in all_records
        )
        for field in (
            "direct_emissions",
            "indirect_emissions",
            "total_emissions",
        )
    }

    route_counts = Counter(
        record.source_production_route_code
        for record in all_records
        if record.source_production_route_code
    )

    profile = {
        "dataset_id": DATASET_ID,
        "input": str(INPUT),
        "input_sha256": calculate_sha256(
            INPUT
        ),
        "sheet_count": len(data_sheets),
        "record_count": len(all_records),
        "code_level_counts": dict(
            code_level_counts
        ),
        "status_counts": {
            field: dict(counter)
            for field, counter
            in status_counts.items()
        },
        "production_route_counts": dict(
            route_counts
        ),
        "sheet_profiles": sheet_profiles,
    }

    PROFILE_OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    PROFILE_OUTPUT.write_text(
        json.dumps(
            profile,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print()
    print(
        f"Total sheets: "
        f"{len(data_sheets)}"
    )

    print(
        f"Total records: "
        f"{len(all_records)}"
    )

    print(
        "Code levels:"
    )

    for code_level, count in (
        code_level_counts.items()
    ):
        print(
            f"  {code_level}: {count}"
        )

    print()
    print(
        f"Output: {OUTPUT}"
    )

    print(
        f"Profile: {PROFILE_OUTPUT}"
    )


if __name__ == "__main__":
    main()