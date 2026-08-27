from __future__ import annotations

import json
import os
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg


ROOT = Path(__file__).resolve().parents[2]

JSON_PATH = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

POOLER_URL_PATH = (
    ROOT
    / "supabase"
    / ".temp"
    / "pooler-url"
)

REPORT_PATH = (
    ROOT
    / "data"
    / "validation"
    / "loaded-regulatory-reconciliation.json"
)

DATASET_VERSION = "2026-definitive-corrected"

EXPECTED_RECORD_COUNT = 12540


# ============================================================
# NORMALIZATION
# ============================================================

def normalize_text(value: str) -> str:
    value = unicodedata.normalize(
        "NFC",
        value,
    )

    value = value.replace(
        "\u00a0",
        " ",
    )

    return " ".join(
        value.split()
    ).strip()


# ============================================================
# CANONICAL DATASET
# ============================================================

def load_canonical_records() -> list[dict[str, Any]]:
    if not JSON_PATH.exists():
        raise FileNotFoundError(
            f"Canonical JSON not found: {JSON_PATH}"
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

    records: list[dict[str, Any]] = []

    for index, item in enumerate(
        payload,
        start=1,
    ):
        if not isinstance(
            item,
            dict,
        ):
            raise ValueError(
                f"Canonical record {index} is not an object."
            )

        records.append(item)

    return records


def canonical_key(
    record: dict[str, Any],
) -> tuple[str, str, str, str | None]:
    return (
        normalize_text(
            record[
                "origin_country_name"
            ]
        ),
        str(
            record[
                "normalized_trade_code"
            ]
        ),
        str(
            record[
                "code_level"
            ]
        ),
        (
            record[
                "source_production_route_code"
            ]
            if record[
                "source_production_route_code"
            ]
            is not None
            else None
        ),
    )


# ============================================================
# POSTGRES
# ============================================================

def connect() -> psycopg.Connection:
    if not POOLER_URL_PATH.exists():
        raise FileNotFoundError(
            f"Pooler URL not found: {POOLER_URL_PATH}"
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
            "snowkap-cbam-regulatory-reconciliation"
        ),
    )


# ============================================================
# DATABASE QUERY
# ============================================================

def load_database_records(
    conn: psycopg.Connection,
) -> list[dict[str, Any]]:
    query = """
        select
            c.name as country_name,

            g.trade_code,
            g.trade_code_type,
            g.record_level,

            pr.source_route_indicator,

            dev.emission_unit,

            dev.direct_value,
            dev.direct_status,
            dev.direct_raw_source_value,

            dev.indirect_value,
            dev.indirect_status,
            dev.indirect_raw_source_value,

            dev.total_value,
            dev.total_status,
            dev.total_raw_source_value,

            dev.source_sheet,
            dev.source_row,
            dev.source_trade_code

        from public.default_emission_values dev

        join public.regulatory_datasets d
          on d.id = dev.dataset_id

        join public.countries c
          on c.id = dev.country_id

        join public.cbam_goods g
          on g.id = dev.good_id

        left join public.production_routes pr
          on pr.id = dev.production_route_id

        where d.version = %s

        order by
            c.name,
            g.trade_code,
            g.record_level,
            pr.source_route_indicator nulls first,
            dev.source_row
    """

    with conn.cursor() as cur:
        cur.execute(
            query,
            (DATASET_VERSION,),
        )

        columns = [
            description.name
            for description in cur.description
        ]

        rows = cur.fetchall()

    result: list[dict[str, Any]] = []

    for row in rows:
        result.append(
            dict(
                zip(
                    columns,
                    row,
                )
            )
        )

    return result


# ============================================================
# DATABASE VALUE NORMALIZATION
# ============================================================

def normalize_db_numeric(
    value: Any,
) -> str | None:
    if value is None:
        return None

    if isinstance(
        value,
        Decimal,
    ):
        return format(
            value,
            "f",
        )

    return str(
        value
    )


def normalize_nullable_text(
    value: Any,
) -> str | None:
    if value is None:
        return None

    return str(
        value
    )


# ============================================================
# SOURCE VALUE EXTRACTION
# ============================================================

def canonical_emission_tuple(
    record: dict[str, Any],
    component: str,
) -> tuple[
    str | None,
    str | None,
    str | None,
]:
    obj = record[
        component
    ]

    return (
        (
            normalize_db_numeric(
                obj.get("value")
            )
        ),
        (
            normalize_nullable_text(
                obj.get("status")
            )
        ),
        (
            normalize_nullable_text(
                obj.get(
                    "raw_source_value"
                )
            )
        ),
    )


def database_emission_tuple(
    record: dict[str, Any],
    component: str,
) -> tuple[
    str | None,
    str | None,
    str | None,
]:
    if component == "direct_emissions":
        return (
            normalize_db_numeric(
                record[
                    "direct_value"
                ]
            ),
            normalize_nullable_text(
                record[
                    "direct_status"
                ]
            ),
            normalize_nullable_text(
                record[
                    "direct_raw_source_value"
                ]
            ),
        )

    if component == "indirect_emissions":
        return (
            normalize_db_numeric(
                record[
                    "indirect_value"
                ]
            ),
            normalize_nullable_text(
                record[
                    "indirect_status"
                ]
            ),
            normalize_nullable_text(
                record[
                    "indirect_raw_source_value"
                ]
            ),
        )

    if component == "total_emissions":
        return (
            normalize_db_numeric(
                record[
                    "total_value"
                ]
            ),
            normalize_nullable_text(
                record[
                    "total_status"
                ]
            ),
            normalize_nullable_text(
                record[
                    "total_raw_source_value"
                ]
            ),
        )

    raise ValueError(
        f"Unknown emission component: {component}"
    )


# ============================================================
# CANONICAL -> COMPARISON ROW
# ============================================================

def canonical_comparison_row(
    record: dict[str, Any],
) -> dict[str, Any]:
    return {
        "country_name": normalize_text(
            record[
                "origin_country_name"
            ]
        ),

        "trade_code": str(
            record[
                "normalized_trade_code"
            ]
        ),

        "code_level": str(
            record[
                "code_level"
            ]
        ),

        "source_route_indicator": (
            record[
                "source_production_route_code"
            ]
            if record[
                "source_production_route_code"
            ]
            is not None
            else None
        ),

        "emission_unit": str(
            record[
                "emission_unit"
            ]
        ),

        "direct_emissions": (
            canonical_emission_tuple(
                record,
                "direct_emissions",
            )
        ),

        "indirect_emissions": (
            canonical_emission_tuple(
                record,
                "indirect_emissions",
            )
        ),

        "total_emissions": (
            canonical_emission_tuple(
                record,
                "total_emissions",
            )
        ),

        "source_sheet": str(
            record[
                "source_sheet"
            ]
        ),

        "source_row": int(
            record[
                "source_row"
            ]
        ),

        "source_trade_code": str(
            record[
                "source_trade_code"
            ]
        ),
    }


# ============================================================
# DATABASE -> COMPARISON ROW
# ============================================================

def database_comparison_row(
    record: dict[str, Any],
) -> dict[str, Any]:
    return {
        "country_name": normalize_text(
            record[
                "country_name"
            ]
        ),

        "trade_code": str(
            record[
                "trade_code"
            ]
        ),

        "code_level": (
            {
                "HS_HEADING": "HS4",
                "HS_SUBHEADING": "HS6",
                "CN": "CN8",
                "TARIC": "TARIC10",
            }.get(
                str(
                    record[
                        "trade_code_type"
                    ]
                ),
                str(
                    record[
                        "trade_code_type"
                    ]
                ),
            )
        ),

        "source_route_indicator": (
            normalize_nullable_text(
                record[
                    "source_route_indicator"
                ]
            )
        ),

        "emission_unit": str(
            record[
                "emission_unit"
            ]
        ),

        "direct_emissions": (
            database_emission_tuple(
                record,
                "direct_emissions",
            )
        ),

        "indirect_emissions": (
            database_emission_tuple(
                record,
                "indirect_emissions",
            )
        ),

        "total_emissions": (
            database_emission_tuple(
                record,
                "total_emissions",
            )
        ),

        "source_sheet": str(
            record[
                "source_sheet"
            ]
        ),

        "source_row": int(
            record[
                "source_row"
            ]
        ),

        "source_trade_code": str(
            record[
                "source_trade_code"
            ]
        ),
    }


# ============================================================
# FIELD COMPARISON
# ============================================================

COMPARISON_FIELDS = (
    "country_name",
    "trade_code",
    "code_level",
    "source_route_indicator",
    "emission_unit",
    "direct_emissions",
    "indirect_emissions",
    "total_emissions",
    "source_sheet",
    "source_row",
    "source_trade_code",
)


def compare_rows(
    canonical: dict[str, Any],
    database: dict[str, Any],
) -> list[dict[str, Any]]:
    mismatches: list[
        dict[str, Any]
    ] = []

    for field in COMPARISON_FIELDS:
        expected = canonical.get(
            field
        )

        actual = database.get(
            field
        )

        if expected != actual:
            mismatches.append(
                {
                    "field": field,
                    "expected": expected,
                    "actual": actual,
                }
            )

    return mismatches


# ============================================================
# MAIN RECONCILIATION
# ============================================================

def reconcile() -> dict[str, Any]:
    print(
        "=== LOADED REGULATORY DATA RECONCILIATION ==="
    )

    canonical_records = (
        load_canonical_records()
    )

    print(
        f"Canonical records: "
        f"{len(canonical_records)}"
    )

    if (
        len(canonical_records)
        != EXPECTED_RECORD_COUNT
    ):
        raise RuntimeError(
            f"Expected {EXPECTED_RECORD_COUNT} "
            f"canonical records, got "
            f"{len(canonical_records)}."
        )

    canonical_by_key: dict[
        tuple[
            str,
            str,
            str,
            str | None,
        ],
        dict[str, Any],
    ] = {}

    duplicate_canonical_keys: list[
        Any
    ] = []

    for record in canonical_records:
        key = canonical_key(
            record
        )

        if key in canonical_by_key:
            duplicate_canonical_keys.append(
                key
            )

        canonical_by_key[
            key
        ] = record

    if duplicate_canonical_keys:
        raise RuntimeError(
            "Duplicate canonical keys found: "
            f"{duplicate_canonical_keys[:10]}"
        )

    with connect() as conn:
        database_records = (
            load_database_records(
                conn
            )
        )

    print(
        f"Database records: "
        f"{len(database_records)}"
    )

    database_by_key: dict[
        tuple[
            str,
            str,
            str,
            str | None,
        ],
        dict[str, Any],
    ] = {}

    duplicate_database_keys: list[
        Any
    ] = []

    for record in database_records:
        key = (
            normalize_text(
                record[
                    "country_name"
                ]
            ),
            str(
                record[
                    "trade_code"
                ]
            ),
            {
                "HS_HEADING": "HS4",
                "HS_SUBHEADING": "HS6",
                "CN": "CN8",
                "TARIC": "TARIC10",
            }.get(
                str(
                    record[
                        "trade_code_type"
                    ]
                ),
                str(
                    record[
                        "trade_code_type"
                    ]
                ),
            ),
            (
                normalize_nullable_text(
                    record[
                        "source_route_indicator"
                    ]
                )
            ),
        )

        if key in database_by_key:
            duplicate_database_keys.append(
                key
            )

        database_by_key[
            key
        ] = record

    missing_keys: list[Any] = []
    unexpected_keys: list[Any] = []
    field_mismatches: list[
        dict[str, Any]
    ] = []

    exact_matches = 0

    # --------------------------------------------------------
    # Canonical -> DB
    # --------------------------------------------------------

    for key, canonical_record in (
        canonical_by_key.items()
    ):
        database_record = (
            database_by_key.get(
                key
            )
        )

        if database_record is None:
            missing_keys.append(
                key
            )
            continue

        expected = (
            canonical_comparison_row(
                canonical_record
            )
        )

        actual = (
            database_comparison_row(
                database_record
            )
        )

        mismatches = compare_rows(
            expected,
            actual,
        )

        if mismatches:
            field_mismatches.append(
                {
                    "key": key,
                    "mismatches": mismatches,
                }
            )
        else:
            exact_matches += 1

    # --------------------------------------------------------
    # DB -> canonical
    # --------------------------------------------------------

    for key in database_by_key:
        if key not in canonical_by_key:
            unexpected_keys.append(
                key
            )

    status = (
        "VALID"
        if (
            len(canonical_records)
            == EXPECTED_RECORD_COUNT
            and len(database_records)
            == EXPECTED_RECORD_COUNT
            and not duplicate_canonical_keys
            and not duplicate_database_keys
            and not missing_keys
            and not unexpected_keys
            and not field_mismatches
        )
        else
        "INVALID"
    )

    report = {
        "status": status,
        "dataset_version": DATASET_VERSION,
        "canonical_records": len(
            canonical_records
        ),
        "database_records": len(
            database_records
        ),
        "exact_matches": exact_matches,
        "missing_database_records": len(
            missing_keys
        ),
        "unexpected_database_records": len(
            unexpected_keys
        ),
        "field_mismatches": len(
            field_mismatches
        ),
        "duplicate_canonical_keys": len(
            duplicate_canonical_keys
        ),
        "duplicate_database_keys": len(
            duplicate_database_keys
        ),
        "missing_keys": [
            list(key)
            for key in missing_keys[:100]
        ],
        "unexpected_keys": [
            list(key)
            for key in unexpected_keys[:100]
        ],
        "mismatches": field_mismatches[
            :100
        ],
    }

    REPORT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    REPORT_PATH.write_text(
        json.dumps(
            report,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        f"Exact matches: "
        f"{exact_matches}"
    )

    print(
        "Missing DB records: "
        f"{len(missing_keys)}"
    )

    print(
        "Unexpected DB records: "
        f"{len(unexpected_keys)}"
    )

    print(
        "Field mismatches: "
        f"{len(field_mismatches)}"
    )

    print(
        "Duplicate canonical keys: "
        f"{len(duplicate_canonical_keys)}"
    )

    print(
        "Duplicate DB keys: "
        f"{len(duplicate_database_keys)}"
    )

    print(
        f"Report: {REPORT_PATH}"
    )

    print(
        f"RESULT: {status}"
    )

    return report


# ============================================================
# ENTRY POINT
# ============================================================

def main() -> int:
    report = reconcile()

    if report["status"] != "VALID":
        return 1

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