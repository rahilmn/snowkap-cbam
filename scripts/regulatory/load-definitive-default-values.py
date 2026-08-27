from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import psycopg


# ============================================================
# PROJECT PATHS
# ============================================================

ROOT = Path(__file__).resolve().parents[2]

JSON_PATH = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

RAW_SOURCE_PATH = (
    ROOT
    / "data"
    / "raw"
    / "cbam-default-values-2026-definitive-corrected.xlsx"
)

POOLER_URL_PATH = (
    ROOT
    / "supabase"
    / ".temp"
    / "pooler-url"
)


# ============================================================
# REGULATORY METADATA
# ============================================================

DATASET_ID = (
    "cbam-default-values-2026-definitive-corrected"
)

DATASET_TYPE = (
    "DEFAULT_EMISSION_VALUES"
)

SOURCE_DOCUMENT_CODE = (
    "2026/1740"
)

SOURCE_TITLE = (
    "Commission Implementing Regulation (EU) 2026/1740"
)

SOURCE_VERSION = (
    "2026-definitive-corrected"
)

EFFECTIVE_FROM = (
    "2026-01-01"
)

PUBLICATION_DATE = (
    "2026-07-31"
)

OFFICIAL_URL = (
    "https://eur-lex.europa.eu/eli/reg_impl/2026/1740/oj/eng"
)

EXPECTED_RECORD_COUNT = 12540

BATCH_SIZE = 1000


# ============================================================
# SPECIAL REGULATORY GEOGRAPHY
# ============================================================

OTHER_TERRITORIES = (
    "_Other Countries and Territorie"
)


# ============================================================
# COUNTRY ISO MAPPINGS
# ============================================================

COUNTRY_ISO: dict[
    str,
    tuple[str, str],
] = {
    "Albania": ("AL", "ALB"),
    "Algeria": ("DZ", "DZA"),
    "Angola": ("AO", "AGO"),
    "Argentina": ("AR", "ARG"),
    "Armenia": ("AM", "ARM"),
    "Australia": ("AU", "AUS"),
    "Azerbaijan": ("AZ", "AZE"),
    "Bangladesh": ("BD", "BGD"),
    "Bahrain": ("BH", "BHR"),
    "Belarus": ("BY", "BLR"),
    "Benin": ("BJ", "BEN"),
    "Bolivia": ("BO", "BOL"),
    "Bosnia and Herzegovina": ("BA", "BIH"),
    "Brazil": ("BR", "BRA"),
    "Brunei": ("BN", "BRN"),
    "Cambodia": ("KH", "KHM"),
    "Cameroon": ("CM", "CMR"),
    "Canada": ("CA", "CAN"),
    "Chile": ("CL", "CHL"),
    "China": ("CN", "CHN"),
    "Colombia": ("CO", "COL"),
    "Congo": ("CG", "COG"),
    "Congo, Democratic Republic of": ("CD", "COD"),
    "Costa Rica": ("CR", "CRI"),
    "Cuba": ("CU", "CUB"),
    "Curaçao": ("CW", "CUW"),
    "Dominican Republic": ("DO", "DOM"),
    "Ecuador": ("EC", "ECU"),
    "Egypt": ("EG", "EGY"),
    "El Salvador": ("SV", "SLV"),
    "Equatorial Guinea": ("GQ", "GNQ"),
    "Eritrea": ("ER", "ERI"),
    "Eswatini": ("SZ", "SWZ"),
    "Ethiopia": ("ET", "ETH"),
    "Gabon": ("GA", "GAB"),
    "Georgia": ("GE", "GEO"),
    "Ghana": ("GH", "GHA"),
    "Guatemala": ("GT", "GTM"),
    "Haiti": ("HT", "HTI"),
    "Honduras": ("HN", "HND"),
    "Hong Kong": ("HK", "HKG"),
    "India": ("IN", "IND"),
    "Indonesia": ("ID", "IDN"),
    "Iran, Islamic Republic of": ("IR", "IRN"),
    "Iraq": ("IQ", "IRQ"),
    "Israel": ("IL", "ISR"),
    "Ivory Coast": ("CI", "CIV"),
    "Jamaica": ("JM", "JAM"),
    "Japan": ("JP", "JPN"),
    "Jordan": ("JO", "JOR"),
    "Kazakhstan": ("KZ", "KAZ"),
    "Kenya": ("KE", "KEN"),
    "Korea, Republic of (South Korea": ("KR", "KOR"),
    "Kuwait": ("KW", "KWT"),
    "Kyrgyzstan": ("KG", "KGZ"),
    "Laos": ("LA", "LAO"),
    "Lebanon": ("LB", "LBN"),
    "Liberia": ("LR", "LBR"),
    "Libya": ("LY", "LBY"),
    "Madagascar": ("MG", "MDG"),
    "Malaysia": ("MY", "MYS"),
    "Mali": ("ML", "MLI"),
    "Mauritania": ("MR", "MRT"),
    "Mauritius": ("MU", "MUS"),
    "Mexico": ("MX", "MEX"),
    "Moldova, Republic of": ("MD", "MDA"),
    "Mongolia": ("MN", "MNG"),
    "Montenegro": ("ME", "MNE"),
    "Morocco": ("MA", "MAR"),
    "Mozambique": ("MZ", "MOZ"),
    "Myanmar": ("MM", "MMR"),
    "Namibia": ("NA", "NAM"),
    "Nepal": ("NP", "NPL"),
    "New Caledonia and dependencies": ("NC", "NCL"),
    "New Zealand": ("NZ", "NZL"),
    "Nicaragua": ("NI", "NIC"),
    "Niger": ("NE", "NER"),
    "Nigeria": ("NG", "NGA"),
    "North Korea (Democratic People’": ("KP", "PRK"),
    "North Macedonia": ("MK", "MKD"),
    "Oman": ("OM", "OMN"),
    "Pakistan": ("PK", "PAK"),
    "Panama": ("PA", "PAN"),
    "Papua New Guinea": ("PG", "PNG"),
    "Paraguay": ("PY", "PRY"),
    "Peru": ("PE", "PER"),
    "Philippines": ("PH", "PHL"),
    "Qatar": ("QA", "QAT"),
    "Russian Federation": ("RU", "RUS"),
    "Rwanda": ("RW", "RWA"),
    "Saudi Arabia": ("SA", "SAU"),
    "Senegal": ("SN", "SEN"),
    "Serbia": ("RS", "SRB"),
    "Sierra Leone": ("SL", "SLE"),
    "Singapore": ("SG", "SGP"),
    "South Africa": ("ZA", "ZAF"),
    "Sri Lanka": ("LK", "LKA"),
    "Sudan": ("SD", "SDN"),
    "Suriname": ("SR", "SUR"),
    "Syria": ("SY", "SYR"),
    "Taiwan": ("TW", "TWN"),
    "Tajikistan": ("TJ", "TJK"),
    "Tanzania, United Republic of": ("TZ", "TZA"),
    "Thailand": ("TH", "THA"),
    "Togo": ("TG", "TGO"),
    "Trinidad and Tobago": ("TT", "TTO"),
    "Tunisia": ("TN", "TUN"),
    "Türkiye": ("TR", "TUR"),
    "Turkmenistan": ("TM", "TKM"),
    "Uganda": ("UG", "UGA"),
    "Ukraine": ("UA", "UKR"),
    "United Arab Emirates": ("AE", "ARE"),
    "United Kingdom": ("GB", "GBR"),
    "United States": ("US", "USA"),
    "Uruguay": ("UY", "URY"),
    "Uzbekistan": ("UZ", "UZB"),
    "Venezuela": ("VE", "VEN"),
    "Viet Nam": ("VN", "VNM"),
    "Yemen": ("YE", "YEM"),
    "Zambia": ("ZM", "ZMB"),
    "Zimbabwe": ("ZW", "ZWE"),
}


# ============================================================
# CODE LEVELS
# ============================================================

CODE_LEVEL_TO_DB_TYPE: dict[
    str,
    str,
] = {
    "HS4": "HS_HEADING",
    "HS6": "HS_SUBHEADING",
    "CN8": "CN",
    "TARIC10": "TARIC",
}


CODE_LEVEL_TO_RECORD_LEVEL: dict[
    str,
    str,
] = {
    "HS4": "HS_HEADING",
    "HS6": "HS_SUBHEADING",
    "CN8": "TRADE_GOOD",
    "TARIC10": "TRADE_GOOD",
}


# ============================================================
# PRODUCTION ROUTES
# ============================================================

ROUTE_NAMES: dict[
    str,
    str,
] = {
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


ROUTE_SECTORS: dict[
    str,
    str,
] = {
    "(A)": "CEMENT",
    "(B)": "CEMENT",
    "(C)": "IRON_STEEL",
    "(C)/(F)": "IRON_STEEL",
    "(D)": "IRON_STEEL",
    "(E)": "IRON_STEEL",
    "(E)/(H)": "IRON_STEEL",
    "(F)": "IRON_STEEL",
    "(G)": "IRON_STEEL",
    "(H)": "IRON_STEEL",
    "(J)": "IRON_STEEL",
    "(K)": "ALUMINIUM",
    "(L)": "ALUMINIUM",
}


# ============================================================
# ALLOWED VALUES
# ============================================================

ALLOWED_SECTORS = {
    "CEMENT",
    "FERTILISERS",
    "IRON_STEEL",
    "ALUMINIUM",
    "HYDROGEN",
    "ELECTRICITY",
}


ALLOWED_STATUSES = {
    "AVAILABLE",
    "NOT_APPLICABLE",
    "UNAVAILABLE",
    "REFERENCE_REQUIRED",
    "SOURCE_TEXT",
}


ALLOWED_EMISSION_UNITS = {
    "TCO2E_PER_TONNE",
    "TCO2_PER_MWH",
}


# ============================================================
# NORMALIZATION
# ============================================================

def normalize_text(
    value: str,
) -> str:
    value = unicodedata.normalize(
        "NFC",
        value,
    )

    value = value.replace(
        "\u00a0",
        " ",
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def country_lookup_key(
    value: str,
) -> str:
    normalized = normalize_text(
        value
    )

    decomposed = unicodedata.normalize(
        "NFKD",
        normalized,
    )

    without_diacritics = "".join(
        char
        for char in decomposed
        if not unicodedata.combining(char)
    )

    return without_diacritics.casefold()


NORMALIZED_COUNTRY_ISO: dict[
    str,
    tuple[str, str],
] = {
    country_lookup_key(name): identity
    for name, identity in COUNTRY_ISO.items()
}


# ============================================================
# COUNTRY RESOLUTION
# ============================================================

def resolve_country(
    source_name: str,
) -> tuple[
    str | None,
    str | None,
    str,
]:
    normalized_name = normalize_text(
        source_name
    )

    if (
        country_lookup_key(normalized_name)
        == country_lookup_key(
            OTHER_TERRITORIES
        )
    ):
        return (
            None,
            None,
            "OTHER_TERRITORIES",
        )

    identity = NORMALIZED_COUNTRY_ISO.get(
        country_lookup_key(
            normalized_name
        )
    )

    if identity is None:
        raise ValueError(
            "No deterministic country mapping for "
            f"{source_name!r} "
            f"(normalized={normalized_name!r})"
        )

    iso2, iso3 = identity

    return (
        iso2,
        iso3,
        "COUNTRY",
    )


# ============================================================
# HASH
# ============================================================

def sha256_file(
    path: Path,
) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        while True:
            chunk = handle.read(
                1024 * 1024
            )

            if not chunk:
                break

            digest.update(chunk)

    return digest.hexdigest()


# ============================================================
# LOAD CANONICAL DATASET
# ============================================================

def load_records() -> list[
    dict[str, Any]
]:
    if not JSON_PATH.exists():
        raise FileNotFoundError(
            f"Canonical JSON not found: "
            f"{JSON_PATH}"
        )

    payload = json.loads(
        JSON_PATH.read_text(
            encoding="utf-8"
        )
    )

    if not isinstance(
        payload,
        list,
    ):
        raise ValueError(
            "Canonical dataset must be a JSON array."
        )

    records: list[
        dict[str, Any]
    ] = []

    for index, record in enumerate(
        payload,
        start=1,
    ):
        if not isinstance(
            record,
            dict,
        ):
            raise ValueError(
                f"record[{index}] is not an object."
            )

        records.append(
            record
        )

    return records


# ============================================================
# EMISSION VALIDATION
# ============================================================

def validate_emission_object(
    record: dict[str, Any],
    field_name: str,
    index: int,
) -> None:
    value_object = record.get(
        field_name
    )

    if not isinstance(
        value_object,
        dict,
    ):
        raise ValueError(
            f"record[{index}] {field_name} "
            "must be an object."
        )

    status = value_object.get(
        "status"
    )

    if status not in ALLOWED_STATUSES:
        raise ValueError(
            f"record[{index}] {field_name} "
            f"invalid status {status!r}"
        )

    value = value_object.get(
        "value"
    )

    raw_source_value = value_object.get(
        "raw_source_value"
    )

    if (
        raw_source_value is not None
        and not isinstance(
            raw_source_value,
            str,
        )
    ):
        raise ValueError(
            f"record[{index}] {field_name} "
            "raw_source_value must be string/null."
        )

    if status == "AVAILABLE":
        if value is None:
            raise ValueError(
                f"record[{index}] {field_name}: "
                "AVAILABLE requires numeric value."
            )

        if not isinstance(
            value,
            str,
        ):
            raise ValueError(
                f"record[{index}] {field_name}: "
                "value must be a string."
            )

        if not re.fullmatch(
            r"-?(?:0|[1-9]\d*)(?:\.\d+)?",
            value,
        ):
            raise ValueError(
                f"record[{index}] {field_name}: "
                f"invalid numeric value {value!r}"
            )

    else:
        if value is not None:
            raise ValueError(
                f"record[{index}] {field_name}: "
                f"{status} requires value=null."
            )


# ============================================================
# ROUTE VALIDATION
# ============================================================

def validate_route(
    record: dict[str, Any],
    index: int,
) -> None:
    route_code = record.get(
        "source_production_route_code"
    )

    route_name = record.get(
        "production_route"
    )

    if route_code is None:
        if route_name is not None:
            raise ValueError(
                f"record[{index}] production_route "
                "exists without source route code."
            )

        return

    if route_code not in ROUTE_NAMES:
        raise ValueError(
            f"record[{index}] unknown production route "
            f"{route_code!r}"
        )

    expected_name = ROUTE_NAMES[
        route_code
    ]

    if route_name != expected_name:
        raise ValueError(
            f"record[{index}] production route mismatch: "
            f"{route_code!r} -> {route_name!r}; "
            f"expected {expected_name!r}"
        )

    expected_sector = ROUTE_SECTORS[
        route_code
    ]

    if record["sector"] != expected_sector:
        raise ValueError(
            f"record[{index}] route {route_code!r} "
            f"belongs to {expected_sector}, "
            f"not {record['sector']!r}"
        )


# ============================================================
# RECORD VALIDATION
# ============================================================

def validate_record(
    record: dict[str, Any],
    index: int,
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
        "source_production_route_code",
        "production_route",
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    }

    missing = sorted(
        required_fields
        - record.keys()
    )

    if missing:
        raise ValueError(
            f"record[{index}] missing fields: "
            f"{missing}"
        )

    if record[
        "dataset_id"
    ] != DATASET_ID:
        raise ValueError(
            f"record[{index}] dataset_id "
            f"{record['dataset_id']!r} does not equal "
            f"expected {DATASET_ID!r}"
        )

    country_name = record[
        "origin_country_name"
    ]

    if not isinstance(
        country_name,
        str,
    ) or not country_name.strip():
        raise ValueError(
            f"record[{index}] invalid origin_country_name"
        )

    resolve_country(
        country_name
    )

    code_level = record[
        "code_level"
    ]

    if code_level not in (
        "HS4",
        "HS6",
        "CN8",
        "TARIC10",
    ):
        raise ValueError(
            f"record[{index}] invalid code_level "
            f"{code_level!r}"
        )

    normalized_code = record[
        "normalized_trade_code"
    ]

    expected_length = {
        "HS4": 4,
        "HS6": 6,
        "CN8": 8,
        "TARIC10": 10,
    }[code_level]

    if not isinstance(
        normalized_code,
        str,
    ) or not re.fullmatch(
        rf"\d{{{expected_length}}}",
        normalized_code,
    ):
        raise ValueError(
            f"record[{index}] invalid normalized "
            f"trade code {normalized_code!r}"
        )

    sector = record[
        "sector"
    ]

    if sector not in ALLOWED_SECTORS:
        raise ValueError(
            f"record[{index}] invalid sector "
            f"{sector!r}"
        )

    emission_unit = record[
        "emission_unit"
    ]

    if (
        emission_unit
        not in ALLOWED_EMISSION_UNITS
    ):
        raise ValueError(
            f"record[{index}] invalid emission unit "
            f"{emission_unit!r}"
        )

    source_row = record[
        "source_row"
    ]

    if (
        not isinstance(
            source_row,
            int,
        )
        or source_row <= 0
    ):
        raise ValueError(
            f"record[{index}] invalid source_row "
            f"{source_row!r}"
        )

    if not isinstance(
        record["source_sheet"],
        str,
    ) or not record[
        "source_sheet"
    ].strip():
        raise ValueError(
            f"record[{index}] invalid source_sheet"
        )

    if not isinstance(
        record["source_trade_code"],
        str,
    ):
        raise ValueError(
            f"record[{index}] source_trade_code "
            "must be a string."
        )

    if not isinstance(
        record["product_name"],
        str,
    ) or not record[
        "product_name"
    ].strip():
        raise ValueError(
            f"record[{index}] invalid product_name"
        )

    validate_route(
        record,
        index,
    )

    for field_name in (
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ):
        validate_emission_object(
            record,
            field_name,
            index,
        )


# ============================================================
# DATASET VALIDATION
# ============================================================

def validate_dataset(
    records: list[dict[str, Any]],
) -> None:
    if len(records) != EXPECTED_RECORD_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_RECORD_COUNT} records, "
            f"found {len(records)}."
        )

    regulatory_identities: set[
        tuple[
            str,
            str,
            str,
            str | None,
        ]
    ] = set()

    source_rows: set[
        tuple[
            str,
            int,
        ]
    ] = set()

    for index, record in enumerate(
        records,
        start=1,
    ):
        validate_record(
            record,
            index,
        )

        regulatory_identity = (
            normalize_text(
                record[
                    "origin_country_name"
                ]
            ),
            record[
                "normalized_trade_code"
            ],
            record[
                "code_level"
            ],
            record[
                "source_production_route_code"
            ],
        )

        if (
            regulatory_identity
            in regulatory_identities
        ):
            raise ValueError(
                "Duplicate regulatory identity "
                f"at record[{index}]: "
                f"{regulatory_identity!r}"
            )

        regulatory_identities.add(
            regulatory_identity
        )

        source_identity = (
            record[
                "source_sheet"
            ],
            record[
                "source_row"
            ],
        )

        if source_identity in source_rows:
            raise ValueError(
                "Duplicate source row "
                f"at record[{index}]: "
                f"{source_identity!r}"
            )

        source_rows.add(
            source_identity
        )

    countries = {
        normalize_text(
            record[
                "origin_country_name"
            ]
        )
        for record in records
    }

    if normalize_text(
        OTHER_TERRITORIES
    ) not in countries:
        raise ValueError(
            "Required OTHER_TERRITORIES fallback "
            "is missing from canonical dataset."
        )


# ============================================================
# POSTGRES CONNECTION
# ============================================================

def connect() -> psycopg.Connection:
    if not POOLER_URL_PATH.exists():
        raise FileNotFoundError(
            f"Pooler URL not found: "
            f"{POOLER_URL_PATH}"
        )

    password = os.environ.get(
        "SUPABASE_DB_PASSWORD"
    )

    if not password:
        raise RuntimeError(
            "SUPABASE_DB_PASSWORD is not set."
        )

    pooler_url = (
        POOLER_URL_PATH.read_text(
            encoding="utf-8"
        )
        .strip()
    )

    if not pooler_url:
        raise RuntimeError(
            "Pooler URL is empty."
        )

    return psycopg.connect(
        pooler_url,
        password=password,
        application_name=(
            "snowkap-cbam-regulatory-import"
        ),
    )


# ============================================================
# SOURCE UPSERT
# ============================================================

def get_or_create_source(
    conn: psycopg.Connection,
    checksum: str,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id::text
              from public.regulatory_sources
             where document_code = %s
               and version = %s
             limit 1
            """,
            (
                SOURCE_DOCUMENT_CODE,
                SOURCE_VERSION,
            ),
        )

        row = cur.fetchone()

        if row is not None:
            source_id = str(
                row[0]
            )

            cur.execute(
                """
                update public.regulatory_sources
                   set title = %s,
                       official_url = %s,
                       publication_date = %s::date,
                       effective_from = %s::date,
                       effective_to = null
                 where id = %s::uuid
                """,
                (
                    SOURCE_TITLE,
                    OFFICIAL_URL,
                    PUBLICATION_DATE,
                    EFFECTIVE_FROM,
                    source_id,
                ),
            )

            return source_id

        cur.execute(
            """
            insert into public.regulatory_sources (
                source_type,
                document_code,
                title,
                official_url,
                publication_date,
                effective_from,
                effective_to,
                version
            )
            values (
                'IMPLEMENTING_REGULATION',
                %s,
                %s,
                %s,
                %s::date,
                %s::date,
                null,
                %s
            )
            returning id::text
            """,
            (
                SOURCE_DOCUMENT_CODE,
                SOURCE_TITLE,
                OFFICIAL_URL,
                PUBLICATION_DATE,
                EFFECTIVE_FROM,
                SOURCE_VERSION,
            ),
        )

        row = cur.fetchone()

        if row is None:
            raise RuntimeError(
                "Unable to create regulatory source."
            )

        return str(
            row[0]
        )


# ============================================================
# DATASET UPSERT
# ============================================================

def get_or_create_dataset(
    conn: psycopg.Connection,
    source_id: str,
    checksum: str,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id::text, status
              from public.regulatory_datasets
             where source_id = %s::uuid
               and dataset_type = %s
               and version = %s
             limit 1
            """,
            (
                source_id,
                DATASET_TYPE,
                SOURCE_VERSION,
            ),
        )

        row = cur.fetchone()

        if row is not None:
            dataset_id = str(
                row[0]
            )

            status = row[1]

            if status != "DRAFT":
                raise RuntimeError(
                    "Refusing to overwrite regulatory "
                    f"dataset {dataset_id}: "
                    f"status is {status!r}."
                )

            cur.execute(
                """
                update public.regulatory_datasets
                   set effective_from = %s::date,
                       effective_to = null,
                       source_file_name = %s,
                       source_checksum = %s,
                       imported_at = null
                 where id = %s::uuid
                """,
                (
                    EFFECTIVE_FROM,
                    RAW_SOURCE_PATH.name,
                    checksum,
                    dataset_id,
                ),
            )

            return dataset_id

        cur.execute(
            """
            insert into public.regulatory_datasets (
                source_id,
                dataset_type,
                version,
                effective_from,
                effective_to,
                source_file_name,
                source_checksum,
                status,
                imported_at
            )
            values (
                %s::uuid,
                %s,
                %s,
                %s::date,
                null,
                %s,
                %s,
                'DRAFT',
                null
            )
            returning id::text
            """,
            (
                source_id,
                DATASET_TYPE,
                SOURCE_VERSION,
                EFFECTIVE_FROM,
                RAW_SOURCE_PATH.name,
                checksum,
            ),
        )

        row = cur.fetchone()

        if row is None:
            raise RuntimeError(
                "Unable to create regulatory dataset."
            )

        return str(
            row[0]
        )


# ============================================================
# COUNTRY LOAD
# ============================================================

def load_countries(
    conn: psycopg.Connection,
    records: list[dict[str, Any]],
) -> dict[str, str]:
    country_names = sorted(
        {
            normalize_text(
                record[
                    "origin_country_name"
                ]
            )
            for record in records
        }
    )

    result: dict[
        str,
        str,
    ] = {}

    with conn.cursor() as cur:
        for name in country_names:
            iso2, iso3, country_type = (
                resolve_country(
                    name
                )
            )

            cur.execute(
                """
                select id::text
                  from public.countries
                 where name = %s
                 limit 1
                """,
                (name,),
            )

            row = cur.fetchone()

            if row is not None:
                country_id = str(
                    row[0]
                )

                cur.execute(
                    """
                    update public.countries
                       set iso2 = %s,
                           iso3 = %s,
                           official_name = %s,
                           active = true,
                           country_type = %s
                     where id = %s::uuid
                    """,
                    (
                        iso2,
                        iso3,
                        name,
                        country_type,
                        country_id,
                    ),
                )

            else:
                cur.execute(
                    """
                    insert into public.countries (
                        iso2,
                        iso3,
                        name,
                        official_name,
                        active,
                        country_type
                    )
                    values (
                        %s,
                        %s,
                        %s,
                        %s,
                        true,
                        %s
                    )
                    returning id::text
                    """,
                    (
                        iso2,
                        iso3,
                        name,
                        name,
                        country_type,
                    ),
                )

                row = cur.fetchone()

                if row is None:
                    raise RuntimeError(
                        f"Unable to create country "
                        f"{name!r}."
                    )

                country_id = str(
                    row[0]
                )

            result[name] = country_id

    return result


# ============================================================
# ROUTE LOAD
# ============================================================

def load_routes(
    conn: psycopg.Connection,
    source_id: str,
    records: list[dict[str, Any]],
) -> dict[str, str]:
    routes: dict[
        str,
        tuple[str, str],
    ] = {}

    for record in records:
        route_code = record[
            "source_production_route_code"
        ]

        if route_code is None:
            continue

        route_name = record[
            "production_route"
        ]

        sector = record[
            "sector"
        ]

        existing = routes.get(
            route_code
        )

        if existing is not None and existing != (
            route_name,
            sector,
        ):
            raise ValueError(
                f"Conflicting route definition "
                f"for {route_code!r}."
            )

        routes[
            route_code
        ] = (
            route_name,
            sector,
        )

    result: dict[
        str,
        str,
    ] = {}

    with conn.cursor() as cur:
        for route_code in sorted(
            routes
        ):
            route_name, sector = routes[
                route_code
            ]

            cur.execute(
                """
                select id::text
                  from public.production_routes
                 where code = %s
                   and effective_from = %s::date
                 limit 1
                """,
                (
                    route_code,
                    EFFECTIVE_FROM,
                ),
            )

            row = cur.fetchone()

            if row is not None:
                route_id = str(
                    row[0]
                )

                cur.execute(
                    """
                    update public.production_routes
                       set name = %s,
                           sector = %s,
                           source_route_indicator = %s,
                           source_id = %s::uuid,
                           effective_to = null
                     where id = %s::uuid
                    """,
                    (
                        route_name,
                        sector,
                        route_code,
                        source_id,
                        route_id,
                    ),
                )

            else:
                cur.execute(
                    """
                    insert into public.production_routes (
                        code,
                        name,
                        sector,
                        source_route_indicator,
                        source_id,
                        effective_from,
                        effective_to
                    )
                    values (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s::uuid,
                        %s::date,
                        null
                    )
                    returning id::text
                    """,
                    (
                        route_code,
                        route_name,
                        sector,
                        route_code,
                        source_id,
                        EFFECTIVE_FROM,
                    ),
                )

                row = cur.fetchone()

                if row is None:
                    raise RuntimeError(
                        f"Unable to create route "
                        f"{route_code!r}."
                    )

                route_id = str(
                    row[0]
                )

            result[
                route_code
            ] = route_id

    return result


# ============================================================
# GOODS LOAD
# ============================================================
def load_goods(
    conn: psycopg.Connection,
    records: list[dict[str, Any]],
) -> dict[
    tuple[str, str],
    str,
]:
    """
    Load the distinct code/level identities present in the
    canonical dataset.

    Parent hierarchy is linked only when the parent code is
    actually present in the canonical dataset. The source
    reconciliation explicitly shows that many HS6/CN8/TARIC10
    records do not have their parent level represented, so a
    missing parent is valid and must remain NULL rather than
    being invented.
    """

    goods: dict[
        tuple[str, str],
        dict[str, Any],
    ] = {}

    # --------------------------------------------------------
    # Build unique goods from canonical data
    # --------------------------------------------------------

    for record in records:
        key = (
            record["normalized_trade_code"],
            record["code_level"],
        )

        existing = goods.get(key)

        if existing is None:
            goods[key] = record
            continue

        for field in (
            "sector",
            "product_name",
            "emission_unit",
        ):
            if existing[field] != record[field]:
                raise ValueError(
                    "Conflicting good definition for "
                    f"{key!r}, field {field!r}"
                )

    # --------------------------------------------------------
    # Insert parents before children
    # --------------------------------------------------------

    ordered_goods = sorted(
        goods.items(),
        key=lambda item: (
            len(item[0][0]),
            item[0][0],
            item[0][1],
        ),
    )

    result: dict[
        tuple[str, str],
        str,
    ] = {}

    missing_parent_count = 0
    linked_parent_count = 0

    with conn.cursor() as cur:
        for (
            code,
            code_level,
        ), record in ordered_goods:

            db_type = CODE_LEVEL_TO_DB_TYPE[
                code_level
            ]

            record_level = (
                CODE_LEVEL_TO_RECORD_LEVEL[
                    code_level
                ]
            )

            record_type = (
                "CLASSIFICATION"
                if code_level in {
                    "HS4",
                    "HS6",
                }
                else "TRADE_GOOD"
            )

            functional_unit = (
                "MWH"
                if record["emission_unit"]
                == "TCO2_PER_MWH"
                else "TONNES"
            )

            # ------------------------------------------------
            # Determine parent from source hierarchy
            # ------------------------------------------------

            parent_id: str | None = None

            if code_level == "HS6":
                parent_key = (
                    code[:4],
                    "HS4",
                )

                parent_id = result.get(
                    parent_key
                )

            elif code_level == "CN8":
                parent_key = (
                    code[:6],
                    "HS6",
                )

                parent_id = result.get(
                    parent_key
                )

            elif code_level == "TARIC10":
                parent_key = (
                    code[:8],
                    "CN8",
                )

                parent_id = result.get(
                    parent_key
                )

            if parent_id is not None:
                linked_parent_count += 1
            elif code_level != "HS4":
                missing_parent_count += 1

            # ------------------------------------------------
            # Existing row?
            # ------------------------------------------------

            cur.execute(
                """
                select id::text
                  from public.cbam_goods
                 where trade_code = %s
                   and trade_code_type = %s
                   and record_level = %s
                   and active_from = %s::date
                 limit 1
                """,
                (
                    code,
                    db_type,
                    record_level,
                    EFFECTIVE_FROM,
                ),
            )

            row = cur.fetchone()

            if row is not None:
                good_id = str(row[0])

                cur.execute(
                    """
                    update public.cbam_goods
                       set record_type = %s,
                           parent_good_id = %s::uuid,
                           sector = %s,
                           description = %s,
                           functional_unit = %s,
                           active_to = null
                     where id = %s::uuid
                    """,
                    (
                        record_type,
                        parent_id,
                        record["sector"],
                        record["product_name"],
                        functional_unit,
                        good_id,
                    ),
                )

            else:
                cur.execute(
                    """
                    insert into public.cbam_goods (
                        trade_code,
                        trade_code_type,
                        record_type,
                        record_level,
                        parent_good_id,
                        sector,
                        description,
                        functional_unit,
                        active_from,
                        active_to
                    )
                    values (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s::uuid,
                        %s,
                        %s,
                        %s,
                        %s::date,
                        null
                    )
                    returning id::text
                    """,
                    (
                        code,
                        db_type,
                        record_type,
                        record_level,
                        parent_id,
                        record["sector"],
                        record["product_name"],
                        functional_unit,
                        EFFECTIVE_FROM,
                    ),
                )

                row = cur.fetchone()

                if row is None:
                    raise RuntimeError(
                        "Failed to create CBAM good "
                        f"{code!r}."
                    )

                good_id = str(row[0])

            result[
                (
                    code,
                    code_level,
                )
            ] = good_id

    print(
        "Parent links created: "
        f"{linked_parent_count}"
    )

    print(
        "Codes without source parent: "
        f"{missing_parent_count}"
    )

    return result


# ============================================================
# EMISSION VALUES LOAD
# ============================================================

def load_emission_values(
    conn: psycopg.Connection,
    dataset_id: str,
    records: list[dict[str, Any]],
    countries: dict[str, str],
    routes: dict[str, str],
    goods: dict[
        tuple[str, str],
        str,
    ],
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            delete from public.default_emission_values
             where dataset_id = %s::uuid
            """,
            (dataset_id,),
        )

    insert_sql = """
        insert into public.default_emission_values (
            dataset_id,
            good_id,
            country_id,
            direct_value,
            direct_status,
            direct_raw_source_value,
            indirect_value,
            indirect_status,
            indirect_raw_source_value,
            total_value,
            total_status,
            total_raw_source_value,
            production_route_id,
            source_sheet,
            source_row,
            source_trade_code,
            emission_unit
        )
        values (
            %s::uuid,
            %s::uuid,
            %s::uuid,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s::uuid,
            %s,
            %s,
            %s,
            %s
        )
    """

    inserted = 0

    with conn.cursor() as cur:
        batch: list[
            tuple[Any, ...]
        ] = []

        for record in records:
            country_name = normalize_text(
                record[
                    "origin_country_name"
                ]
            )

            country_id = countries[
                country_name
            ]

            good_key = (
                record[
                    "normalized_trade_code"
                ],
                record[
                    "code_level"
                ],
            )

            good_id = goods[
                good_key
            ]

            route_code = record[
                "source_production_route_code"
            ]

            route_id = (
                routes.get(
                    route_code
                )
                if route_code is not None
                else None
            )

            if (
                route_code is not None
                and route_id is None
            ):
                raise RuntimeError(
                    f"Route {route_code!r} "
                    "was not loaded."
                )

            direct = record[
                "direct_emissions"
            ]

            indirect = record[
                "indirect_emissions"
            ]

            total = record[
                "total_emissions"
            ]

            batch.append(
                (
                    dataset_id,
                    good_id,
                    country_id,
                    direct[
                        "value"
                    ],
                    direct[
                        "status"
                    ],
                    direct.get(
                        "raw_source_value"
                    ),
                    indirect[
                        "value"
                    ],
                    indirect[
                        "status"
                    ],
                    indirect.get(
                        "raw_source_value"
                    ),
                    total[
                        "value"
                    ],
                    total[
                        "status"
                    ],
                    total.get(
                        "raw_source_value"
                    ),
                    route_id,
                    record[
                        "source_sheet"
                    ],
                    record[
                        "source_row"
                    ],
                    record[
                        "source_trade_code"
                    ],
                    record[
                        "emission_unit"
                    ],
                )
            )

            if len(batch) >= BATCH_SIZE:
                cur.executemany(
                    insert_sql,
                    batch,
                )

                inserted += len(
                    batch
                )

                print(
                    f"Inserted emission rows: "
                    f"{inserted}/{len(records)}"
                )

                batch.clear()

        if batch:
            cur.executemany(
                insert_sql,
                batch,
            )

            inserted += len(
                batch
            )

    return inserted


# ============================================================
# POST-IMPORT VALIDATION
# ============================================================

def verify_import(
    conn: psycopg.Connection,
    dataset_id: str,
    expected_count: int,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select count(*)
              from public.default_emission_values
             where dataset_id = %s::uuid
            """,
            (dataset_id,),
        )

        actual_count = int(
            cur.fetchone()[0]
        )

        if actual_count != expected_count:
            raise RuntimeError(
                "Emission-value count mismatch: "
                f"expected {expected_count}, "
                f"got {actual_count}."
            )

        cur.execute(
            """
            select count(*)
              from public.default_emission_values
             where dataset_id = %s::uuid
               and (
                    (
                        direct_status = 'AVAILABLE'
                        and direct_value is null
                    )
                    or
                    (
                        indirect_status = 'AVAILABLE'
                        and indirect_value is null
                    )
                    or
                    (
                        total_status = 'AVAILABLE'
                        and total_value is null
                    )
               )
            """,
            (dataset_id,),
        )

        invalid_available = int(
            cur.fetchone()[0]
        )

        if invalid_available != 0:
            raise RuntimeError(
                "Found AVAILABLE values without "
                f"numeric values: {invalid_available}"
            )

        cur.execute(
            """
            select count(*)
              from public.default_emission_values
             where dataset_id = %s::uuid
               and (
                    (
                        direct_status <> 'AVAILABLE'
                        and direct_value is not null
                    )
                    or
                    (
                        indirect_status <> 'AVAILABLE'
                        and indirect_value is not null
                    )
                    or
                    (
                        total_status <> 'AVAILABLE'
                        and total_value is not null
                    )
               )
            """,
            (dataset_id,),
        )

        invalid_non_available = int(
            cur.fetchone()[0]
        )

        if invalid_non_available != 0:
            raise RuntimeError(
                "Found non-AVAILABLE values with "
                f"numeric values: "
                f"{invalid_non_available}"
            )

        cur.execute(
            """
            select status
              from public.regulatory_datasets
             where id = %s::uuid
            """,
            (dataset_id,),
        )

        row = cur.fetchone()

        if row is None:
            raise RuntimeError(
                "Imported regulatory dataset not found."
            )

        if row[0] != "DRAFT":
            raise RuntimeError(
                "Regulatory dataset unexpectedly "
                f"has status {row[0]!r}."
            )


# ============================================================
# MAIN
# ============================================================

def main() -> int:
    print(
        "=== DEFINITIVE CBAM BULK IMPORT ==="
    )

    records = load_records()

    print(
        f"Loaded records: {len(records)}"
    )

    validate_dataset(
        records
    )

    print(
        "Dataset validation: PASS"
    )

    if not RAW_SOURCE_PATH.exists():
        raise FileNotFoundError(
            f"Raw source workbook not found: "
            f"{RAW_SOURCE_PATH}"
        )

    checksum = sha256_file(
        RAW_SOURCE_PATH
    )

    print(
        f"Source SHA-256: {checksum}"
    )

    with connect() as conn:
        try:
            print(
                "Connected to Supabase PostgreSQL."
            )

            source_id = get_or_create_source(
                conn,
                checksum,
            )

            print(
                f"Source: {source_id}"
            )

            dataset_id = get_or_create_dataset(
                conn,
                source_id,
                checksum,
            )

            print(
                f"Dataset: {dataset_id}"
            )

            country_map = load_countries(
                conn,
                records,
            )

            print(
                "Countries/geographies: "
                f"{len(country_map)}"
            )

            route_map = load_routes(
                conn,
                source_id,
                records,
            )

            print(
                "Production routes: "
                f"{len(route_map)}"
            )

            goods_map = load_goods(
                conn,
                records,
            )

            print(
                "CBAM goods: "
                f"{len(goods_map)}"
            )

            inserted = load_emission_values(
                conn,
                dataset_id,
                records,
                country_map,
                route_map,
                goods_map,
            )

            print(
                f"Emission values inserted: "
                f"{inserted}"
            )

            if inserted != EXPECTED_RECORD_COUNT:
                raise RuntimeError(
                    "Inserted emission-value count "
                    f"{inserted} does not equal "
                    f"expected {EXPECTED_RECORD_COUNT}."
                )

            verify_import(
                conn,
                dataset_id,
                EXPECTED_RECORD_COUNT,
            )

            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.regulatory_datasets
                       set imported_at = now()
                     where id = %s::uuid
                    """,
                    (dataset_id,),
                )

            conn.commit()

            print(
                "Post-import validation: PASS"
            )

            print(
                "Dataset status: DRAFT"
            )

            print(
                "Transaction: COMMITTED"
            )

        except Exception:
            conn.rollback()

            print(
                "Transaction: ROLLED BACK",
                file=sys.stderr,
            )

            raise

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(
            main()
        )
    except Exception as exc:
        print(
            f"ERROR: {exc}",
            file=sys.stderr,
        )
        raise