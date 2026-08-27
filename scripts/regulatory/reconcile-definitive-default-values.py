from __future__ import annotations

from collections import Counter
from pathlib import Path
import json
import re
import unicodedata


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
    / "definitive-country-reconciliation.json"
)


DATASET_ID = (
    "cbam-default-values-2026-definitive-corrected"
)


# Source display names -> stable internal identity.
#
# We deliberately normalize known source/display variations here
# instead of using workbook sheet names directly as database keys.
COUNTRY_ALIASES = {
    "Curaçao": "CUW",
    "CuraÃ§ao": "CUW",

    "Türkiye": "TUR",
    "TÃ¼rkiye": "TUR",

    "Viet Nam": "VNM",

    "Russian Federation": "RUS",

    "Iran, Islamic Republic of": "IRN",

    "Moldova, Republic of": "MDA",

    "Tanzania, United Republic of": "TZA",

    "Korea, Republic of (South Korea": "KOR",

    "North Korea (Democratic People’s": "PRK",
    "North Korea (Democratic Peopleâ€™": "PRK",

    "Ivory Coast": "CIV",

    "Congo, Democratic Republic of": "COD",

    "_Other Countries and Territorie": "OTHER_TERRITORIES",
}


# Fallback normalization for names that do not require
# an explicit alias.
KNOWN_ISO3_BY_NORMALIZED_NAME = {
    "albania": "ALB",
    "algeria": "DZA",
    "angola": "AGO",
    "argentina": "ARG",
    "armenia": "ARM",
    "australia": "AUS",
    "austria": "AUT",
    "azerbaijan": "AZE",
    "bangladesh": "BGD",
    "bahrain": "BHR",
    "belarus": "BLR",
    "belgium": "BEL",
    "benin": "BEN",
    "bolivia": "BOL",
    "bosnia and herzegovina": "BIH",
    "brazil": "BRA",
    "brunei": "BRN",
    "cambodia": "KHM",
    "cameroon": "CMR",
    "canada": "CAN",
    "chile": "CHL",
    "china": "CHN",
    "colombia": "COL",
    "congo": "COG",
    "costa rica": "CRI",
    "croatia": "HRV",
    "cuba": "CUB",
    "curacao": "CUW",
    "czechia": "CZE",
    "denmark": "DNK",
    "dominican republic": "DOM",
    "ecuador": "ECU",
    "egypt": "EGY",
    "el salvador": "SLV",
    "equatorial guinea": "GNQ",
    "eritrea": "ERI",
    "estonia": "EST",
    "eswatini": "SWZ",
    "ethiopia": "ETH",
    "gabon": "GAB",
    "georgia": "GEO",
    "ghana": "GHA",
    "greece": "GRC",
    "guatemala": "GTM",
    "haiti": "HTI",
    "honduras": "HND",
    "hong kong": "HKG",
    "hungary": "HUN",
    "iceland": "ISL",
    "india": "IND",
    "indonesia": "IDN",
    "iran islamic republic of": "IRN",
    "iraq": "IRQ",
    "ireland": "IRL",
    "israel": "ISR",
    "italy": "ITA",
    "ivory coast": "CIV",
    "jamaica": "JAM",
    "japan": "JPN",
    "jordan": "JOR",
    "kazakhstan": "KAZ",
    "kenya": "KEN",
    "korea republic of south korea": "KOR",
    "kuwait": "KWT",
    "kyrgyzstan": "KGZ",
    "laos": "LAO",
    "latvia": "LVA",
    "lebanon": "LBN",
    "liberia": "LBR",
    "libya": "LBY",
    "liechtenstein": "LIE",
    "lithuania": "LTU",
    "luxembourg": "LUX",
    "madagascar": "MDG",
    "malaysia": "MYS",
    "maldives": "MDV",
    "mali": "MLI",
    "malta": "MLT",
    "mauritania": "MRT",
    "mauritius": "MUS",
    "mexico": "MEX",
    "moldova republic of": "MDA",
    "monaco": "MCO",
    "mongolia": "MNG",
    "montenegro": "MNE",
    "morocco": "MAR",
    "mozambique": "MOZ",
    "myanmar": "MMR",
    "namibia": "NAM",
    "nepal": "NPL",
    "netherlands": "NLD",
    "new zealand": "NZL",
    "new caledonia and dependencies": "NCL",
    "nicaragua": "NIC",
    "niger": "NER",
    "nigeria": "NGA",
    "north korea democratic people": "PRK",
    "north macedonia": "MKD",
    "norway": "NOR",
    "oman": "OMN",
    "pakistan": "PAK",
    "panama": "PAN",
    "papua new guinea": "PNG",
    "paraguay": "PRY",
    "peru": "PER",
    "philippines": "PHL",
    "poland": "POL",
    "portugal": "PRT",
    "qatar": "QAT",
    "romania": "ROU",
    "russian federation": "RUS",
    "rwanda": "RWA",
    "saudi arabia": "SAU",
    "senegal": "SEN",
    "serbia": "SRB",
    "sierra leone": "SLE",
    "singapore": "SGP",
    "slovakia": "SVK",
    "slovenia": "SVN",
    "south africa": "ZAF",
    "south korea": "KOR",
    "spain": "ESP",
    "sri lanka": "LKA",
    "sudan": "SDN",
    "suriname": "SUR",
    "sweden": "SWE",
    "switzerland": "CHE",
    "syria": "SYR",
    "taiwan": "TWN",
    "tajikistan": "TJK",
    "tanzania united republic of": "TZA",
    "thailand": "THA",
    "togo": "TGO",
    "trinidad and tobago": "TTO",
    "tunisia": "TUN",
    "turkiye": "TUR",
    "turkmenistan": "TKM",
    "uganda": "UGA",
    "ukraine": "UKR",
    "united arab emirates": "ARE",
    "united kingdom": "GBR",
    "united states": "USA",
    "uruguay": "URY",
    "uzbekistan": "UZB",
    "venezuela": "VEN",
    "viet nam": "VNM",
    "yemen": "YEM",
    "zambia": "ZMB",
    "zimbabwe": "ZWE",
}


def load_records() -> list[dict]:
    if not INPUT.exists():
        raise FileNotFoundError(INPUT)

    with INPUT.open(
        "r",
        encoding="utf-8",
    ) as handle:
        payload = json.load(handle)

    if not isinstance(payload, list):
        raise ValueError(
            "Input dataset must be a JSON array."
        )

    return payload


def normalize_text(value: str) -> str:
    """
    Normalize display text for matching only.

    This does not replace the original source name.
    """

    text = unicodedata.normalize(
        "NFKD",
        value,
    )

    text = "".join(
        char
        for char in text
        if not unicodedata.combining(char)
    )

    text = text.lower().strip()

    text = text.replace(
        "’",
        "'",
    )

    text = re.sub(
        r"[^a-z0-9]+",
        " ",
        text,
    )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def resolve_country(
    source_name: str,
) -> tuple[str, str]:

    explicit = COUNTRY_ALIASES.get(
        source_name
    )

    if explicit is not None:
        return (
            explicit,
            "EXPLICIT_ALIAS",
        )

    normalized = normalize_text(
        source_name
    )

    iso3 = (
        KNOWN_ISO3_BY_NORMALIZED_NAME.get(
            normalized
        )
    )

    if iso3 is not None:
        return (
            iso3,
            "NORMALIZED_NAME",
        )

    raise ValueError(
        f"Unresolved source country/sheet: "
        f"{source_name!r}"
    )


def main() -> None:

    records = load_records()

    source_to_counts = Counter()

    for record in records:
        source_name = record[
            "origin_country_name"
        ]

        source_to_counts[
            source_name
        ] += 1

    mappings = []

    errors = []

    for source_name, row_count in sorted(
        source_to_counts.items()
    ):

        try:
            iso3, resolution_method = (
                resolve_country(
                    source_name
                )
            )

            mappings.append(
                {
                    "source_name": source_name,
                    "iso3": iso3,
                    "resolution_method": (
                        resolution_method
                    ),
                    "record_count": row_count,
                }
            )

        except ValueError as exc:
            errors.append(
                str(exc)
            )

    iso3_counts = Counter(
        mapping["iso3"]
        for mapping in mappings
        if mapping["iso3"] != "OTHER_TERRITORIES"
    )

    duplicate_iso3 = {
        iso3: count
        for iso3, count
        in iso3_counts.items()
        if count > 1
    }

    for iso3, count in duplicate_iso3.items():
        errors.append(
            f"Multiple source sheets resolve to "
            f"ISO3={iso3!r}: {count}"
        )

    result = {
        "dataset_id": DATASET_ID,
        "status": (
            "VALID"
            if not errors
            else "INVALID"
        ),
        "source_sheet_count": (
            len(source_to_counts)
        ),
        "resolved_sheet_count": (
            len(mappings)
        ),
        "unresolved_sheet_count": (
            len(errors)
        ),
        "mappings": mappings,
        "errors": errors,
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
        "=== DEFINITIVE COUNTRY RECONCILIATION ==="
    )

    print(
        f"Status: {result['status']}"
    )

    print(
        f"Source sheets: "
        f"{result['source_sheet_count']}"
    )

    print(
        f"Resolved sheets: "
        f"{result['resolved_sheet_count']}"
    )

    print(
        f"Errors: "
        f"{len(errors)}"
    )

    print(
        f"Report: {OUTPUT}"
    )

    if errors:
        print()
        print(
            "Errors:"
        )

        for error in errors:
            print(
                f"- {error}"
            )

        raise SystemExit(1)


if __name__ == "__main__":
    main()