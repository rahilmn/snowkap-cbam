from __future__ import annotations

import hashlib
import json
import os
import sys
import unicodedata
from pathlib import Path
from typing import Any

import psycopg


ROOT = Path(__file__).resolve().parents[2]

CANONICAL_JSON = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values-definitive.json"
)

RAW_SOURCE = (
    ROOT
    / "data"
    / "raw"
    / "cbam-default-values-2026-definitive-corrected.xlsx"
)

POOLER_URL = (
    ROOT
    / "supabase"
    / ".temp"
    / "pooler-url"
)

RECONCILIATION_REPORT = (
    ROOT
    / "data"
    / "validation"
    / "loaded-regulatory-reconciliation.json"
)

DATASET_VERSION = "2026-definitive-corrected"
DATASET_TYPE = "DEFAULT_EMISSION_VALUES"

EXPECTED_RECORDS = 12540
EXPECTED_COUNTRIES = 122
EXPECTED_GOODS = 283
EXPECTED_ROUTES = 10

EXPECTED_SOURCE_CHECKSUM = (
    "900583811c7e1194799eb9bdbad2d6d7e1100f5a7d80a664c1584a8fce6f9f35"
)

CODE_LEVEL_TO_DB_TYPE = {
    "HS4": "HS_HEADING",
    "HS6": "HS_SUBHEADING",
    "CN8": "CN",
    "TARIC10": "TARIC",
}


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


def sha256_file(path: Path) -> str:
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


def load_canonical() -> list[dict[str, Any]]:
    if not CANONICAL_JSON.exists():
        raise FileNotFoundError(
            f"Canonical JSON not found: {CANONICAL_JSON}"
        )

    payload = json.loads(
        CANONICAL_JSON.read_text(
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

    if len(payload) != EXPECTED_RECORDS:
        raise ValueError(
            f"Expected {EXPECTED_RECORDS} canonical records, "
            f"got {len(payload)}."
        )

    return payload


def connect() -> psycopg.Connection:
    if not POOLER_URL.exists():
        raise FileNotFoundError(
            f"Pooler URL not found: {POOLER_URL}"
        )

    password = os.environ.get(
        "SUPABASE_DB_PASSWORD"
    )

    if not password:
        raise RuntimeError(
            "SUPABASE_DB_PASSWORD is not set."
        )

    connection_url = (
        POOLER_URL.read_text(
            encoding="utf-8"
        )
        .strip()
    )

    return psycopg.connect(
        connection_url,
        password=password,
        application_name=(
            "snowkap-cbam-regulatory-verifier"
        ),
    )


def canonical_key(
    record: dict[str, Any],
) -> tuple[str, str, str, str | None]:
    return (
        normalize_text(
            str(
                record["origin_country_name"]
            )
        ),
        str(
            record["normalized_trade_code"]
        ),
        str(
            record["code_level"]
        ),
        (
            str(
                record[
                    "source_production_route_code"
                ]
            )
            if record[
                "source_production_route_code"
            ]
            is not None
            else None
        ),
    )


def canonical_component(
    record: dict[str, Any],
    component: str,
) -> tuple[
    str | None,
    str | None,
    str | None,
]:
    value = record[
        component
    ]

    return (
        (
            str(
                value["value"]
            )
            if value["value"] is not None
            else None
        ),
        (
            str(
                value["status"]
            )
            if value["status"] is not None
            else None
        ),
        (
            str(
                value["raw_source_value"]
            )
            if value.get(
                "raw_source_value"
            )
            is not None
            else None
        ),
    )


def fetch_database(
    conn: psycopg.Connection,
) -> list[dict[str, Any]]:
    query = """
        select
            c.name as country_name,
            g.trade_code,
            g.trade_code_type,
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

        where d.dataset_type = %s
          and d.version = %s

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
            (
                DATASET_TYPE,
                DATASET_VERSION,
            ),
        )

        columns = [
            column.name
            for column in cur.description
        ]

        rows = cur.fetchall()

    return [
        dict(
            zip(
                columns,
                row,
            )
        )
        for row in rows
    ]


def database_key(
    record: dict[str, Any],
) -> tuple[str, str, str, str | None]:
    code_type = str(
        record["trade_code_type"]
    )

    type_to_level = {
        value: key
        for key, value
        in CODE_LEVEL_TO_DB_TYPE.items()
    }

    code_level = type_to_level.get(
        code_type
    )

    if code_level is None:
        raise ValueError(
            f"Unknown database trade-code type: "
            f"{code_type!r}"
        )

    return (
        normalize_text(
            str(
                record["country_name"]
            )
        ),
        str(
            record["trade_code"]
        ),
        code_level,
        (
            str(
                record[
                    "source_route_indicator"
                ]
            )
            if record[
                "source_route_indicator"
            ]
            is not None
            else None
        ),
    )


def database_component(
    record: dict[str, Any],
    component: str,
) -> tuple[
    str | None,
    str | None,
    str | None,
]:
    if component == "direct_emissions":
        return (
            (
                str(
                    record["direct_value"]
                )
                if record[
                    "direct_value"
                ] is not None
                else None
            ),
            (
                str(
                    record["direct_status"]
                )
                if record[
                    "direct_status"
                ] is not None
                else None
            ),
            (
                str(
                    record[
                        "direct_raw_source_value"
                    ]
                )
                if record[
                    "direct_raw_source_value"
                ] is not None
                else None
            ),
        )

    if component == "indirect_emissions":
        return (
            (
                str(
                    record["indirect_value"]
                )
                if record[
                    "indirect_value"
                ] is not None
                else None
            ),
            (
                str(
                    record["indirect_status"]
                )
                if record[
                    "indirect_status"
                ] is not None
                else None
            ),
            (
                str(
                    record[
                        "indirect_raw_source_value"
                    ]
                )
                if record[
                    "indirect_raw_source_value"
                ] is not None
                else None
            ),
        )

    if component == "total_emissions":
        return (
            (
                str(
                    record["total_value"]
                )
                if record[
                    "total_value"
                ] is not None
                else None
            ),
            (
                str(
                    record["total_status"]
                )
                if record[
                    "total_status"
                ] is not None
                else None
            ),
            (
                str(
                    record[
                        "total_raw_source_value"
                    ]
                )
                if record[
                    "total_raw_source_value"
                ] is not None
                else None
            ),
        )

    raise ValueError(
        f"Unknown emission component: {component}"
    )


def compare_record(
    canonical: dict[str, Any],
    database: dict[str, Any],
) -> list[dict[str, Any]]:
    mismatches: list[
        dict[str, Any]
    ] = []

    scalar_fields = (
        (
            "country_name",
            normalize_text(
                str(
                    canonical[
                        "origin_country_name"
                    ]
                )
            ),
            normalize_text(
                str(
                    database[
                        "country_name"
                    ]
                )
            ),
        ),
        (
            "trade_code",
            str(
                canonical[
                    "normalized_trade_code"
                ]
            ),
            str(
                database[
                    "trade_code"
                ]
            ),
        ),
        (
            "code_level",
            str(
                canonical[
                    "code_level"
                ]
            ),
            database_key(
                database
            )[2],
        ),
        (
            "source_route_indicator",
            (
                canonical[
                    "source_production_route_code"
                ]
                if canonical[
                    "source_production_route_code"
                ] is not None
                else None
            ),
            (
                database[
                    "source_route_indicator"
                ]
                if database[
                    "source_route_indicator"
                ] is not None
                else None
            ),
        ),
        (
            "emission_unit",
            str(
                canonical[
                    "emission_unit"
                ]
            ),
            str(
                database[
                    "emission_unit"
                ]
            ),
        ),
        (
            "source_sheet",
            str(
                canonical[
                    "source_sheet"
                ]
            ),
            str(
                database[
                    "source_sheet"
                ]
            ),
        ),
        (
            "source_row",
            int(
                canonical[
                    "source_row"
                ]
            ),
            int(
                database[
                    "source_row"
                ]
            ),
        ),
        (
            "source_trade_code",
            str(
                canonical[
                    "source_trade_code"
                ]
            ),
            str(
                database[
                    "source_trade_code"
                ]
            ),
        ),
    )

    for field, expected, actual in scalar_fields:
        if expected != actual:
            mismatches.append(
                {
                    "field": field,
                    "expected": expected,
                    "actual": actual,
                }
            )

    for component in (
        "direct_emissions",
        "indirect_emissions",
        "total_emissions",
    ):
        expected = canonical_component(
            canonical,
            component,
        )

        actual = database_component(
            database,
            component,
        )

        if expected != actual:
            mismatches.append(
                {
                    "field": component,
                    "expected": expected,
                    "actual": actual,
                }
            )

    return mismatches


def main() -> int:
    print(
        "=== REGULATORY DATA VERIFICATION ==="
    )

    canonical_records = (
        load_canonical()
    )

    print(
        f"Canonical records: "
        f"{len(canonical_records)}"
    )

    source_checksum = sha256_file(
        RAW_SOURCE
    )

    print(
        f"Source checksum: "
        f"{source_checksum}"
    )

    if source_checksum != EXPECTED_SOURCE_CHECKSUM:
        raise RuntimeError(
            "Source checksum mismatch: "
            f"expected {EXPECTED_SOURCE_CHECKSUM}, "
            f"got {source_checksum}"
        )

    print(
        "Source checksum                 PASS"
    )

    canonical_keys = {
        canonical_key(record)
        for record in canonical_records
    }

    if len(canonical_keys) != len(
        canonical_records
    ):
        raise RuntimeError(
            "Canonical dataset contains duplicate "
            "regulatory identities."
        )

    print(
        "Canonical identity uniqueness    PASS"
    )

    with connect() as conn:
        database_records = fetch_database(
            conn
        )

    print(
        f"Database records: "
        f"{len(database_records)}"
    )

    if len(database_records) != EXPECTED_RECORDS:
        raise RuntimeError(
            "Database record-count mismatch: "
            f"expected {EXPECTED_RECORDS}, "
            f"got {len(database_records)}"
        )

    database_keys = {
        database_key(record)
        for record in database_records
    }

    if len(database_keys) != len(
        database_records
    ):
        raise RuntimeError(
            "Database contains duplicate "
            "regulatory identities."
        )

    print(
        "Database identity uniqueness      PASS"
    )

    if canonical_keys != database_keys:
        missing = sorted(
            canonical_keys
            - database_keys
        )

        unexpected = sorted(
            database_keys
            - canonical_keys
        )

        raise RuntimeError(
            "Canonical/database identity sets differ. "
            f"Missing={missing[:10]}, "
            f"Unexpected={unexpected[:10]}"
        )

    print(
        "Canonical/database identities     PASS"
    )

    canonical_by_key = {
        canonical_key(record): record
        for record in canonical_records
    }

    database_by_key = {
        database_key(record): record
        for record in database_records
    }

    mismatch_records: list[
        dict[str, Any]
    ] = []

    exact_matches = 0

    for key, canonical in (
        canonical_by_key.items()
    ):
        database = database_by_key[
            key
        ]

        mismatches = compare_record(
            canonical,
            database,
        )

        if mismatches:
            mismatch_records.append(
                {
                    "key": list(key),
                    "mismatches": mismatches,
                }
            )
        else:
            exact_matches += 1

    if mismatch_records:
        raise RuntimeError(
            "Field-level reconciliation failed: "
            f"{len(mismatch_records)} "
            "records differ."
        )

    print(
        f"Field-level reconciliation      PASS "
        f"({exact_matches}/{EXPECTED_RECORDS})"
    )

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    count(*) filter (
                        where direct_status = 'AVAILABLE'
                          and direct_value is null
                    ),
                    count(*) filter (
                        where indirect_status = 'AVAILABLE'
                          and indirect_value is null
                    ),
                    count(*) filter (
                        where total_status = 'AVAILABLE'
                          and total_value is null
                    ),
                    count(*) filter (
                        where direct_status <> 'AVAILABLE'
                          and direct_value is not null
                    ),
                    count(*) filter (
                        where indirect_status <> 'AVAILABLE'
                          and indirect_value is not null
                    ),
                    count(*) filter (
                        where total_status <> 'AVAILABLE'
                          and total_value is not null
                    )
                from public.default_emission_values dev
                join public.regulatory_datasets d
                  on d.id = dev.dataset_id
                where d.dataset_type = %s
                  and d.version = %s
                """,
                (
                    DATASET_TYPE,
                    DATASET_VERSION,
                ),
            )

            row = cur.fetchone()

    assert row is not None

    semantic_errors = {
        "direct_available_missing_value": int(
            row[0]
        ),
        "indirect_available_missing_value": int(
            row[1]
        ),
        "total_available_missing_value": int(
            row[2]
        ),
        "direct_non_available_has_value": int(
            row[3]
        ),
        "indirect_non_available_has_value": int(
            row[4]
        ),
        "total_non_available_has_value": int(
            row[5]
        ),
    }

    if any(
        value != 0
        for value in semantic_errors.values()
    ):
        raise RuntimeError(
            "Emission semantic validation failed: "
            f"{semantic_errors}"
        )

    print(
        "Emission semantic invariants     PASS"
    )

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    count(distinct country_id),
                    count(distinct good_id),
                    count(distinct production_route_id)
                from public.default_emission_values dev
                join public.regulatory_datasets d
                  on d.id = dev.dataset_id
                where d.dataset_type = %s
                  and d.version = %s
                """,
                (
                    DATASET_TYPE,
                    DATASET_VERSION,
                ),
            )

            row = cur.fetchone()

    assert row is not None

    database_country_count = int(
        row[0]
    )

    database_good_count = int(
        row[1]
    )

    database_route_count = int(
        row[2]
    )

    if database_country_count != EXPECTED_COUNTRIES:
        raise RuntimeError(
            "Country coverage mismatch: "
            f"expected {EXPECTED_COUNTRIES}, "
            f"got {database_country_count}"
        )

    if database_good_count != EXPECTED_GOODS:
        raise RuntimeError(
            "Good coverage mismatch: "
            f"expected {EXPECTED_GOODS}, "
            f"got {database_good_count}"
        )

    if database_route_count != EXPECTED_ROUTES:
        raise RuntimeError(
            "Route coverage mismatch: "
            f"expected {EXPECTED_ROUTES}, "
            f"got {database_route_count}"
        )

    print(
        "Country coverage                 PASS"
    )

    print(
        "CBAM goods coverage              PASS"
    )

    print(
        "Production route coverage       PASS"
    )

    if RECONCILIATION_REPORT.exists():
        report = json.loads(
            RECONCILIATION_REPORT.read_text(
                encoding="utf-8"
            )
        )

        if report.get(
            "status"
        ) != "VALID":
            raise RuntimeError(
                "Existing reconciliation report "
                "is not VALID."
            )

        if report.get(
            "field_mismatches",
            1,
        ) != 0:
            raise RuntimeError(
                "Existing reconciliation report "
                "contains field mismatches."
            )

        print(
            "Saved reconciliation report     PASS"
        )

    print("")
    print(
        "RESULT: VALID"
    )

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