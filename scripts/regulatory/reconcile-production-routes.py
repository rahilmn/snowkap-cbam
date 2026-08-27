from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import json


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
    / "definitive-production-route-reconciliation.json"
)


VALID_ROUTES = {
    "(A)",
    "(B)",
    "(C)",
    "(C)/(F)",
    "(D)",
    "(E)",
    "(E)/(H)",
    "(F)",
    "(G)",
    "(H)",
    "(J)",
    "(K)",
    "(L)",
}


def load_records() -> list[dict]:
    if not INPUT.exists():
        raise FileNotFoundError(INPUT)

    with INPUT.open(
        "r",
        encoding="utf-8",
    ) as handle:
        records = json.load(handle)

    if not isinstance(records, list):
        raise ValueError(
            "Input dataset must be a JSON array."
        )

    return records


def main() -> None:
    records = load_records()

    errors: list[str] = []
    warnings: list[str] = []

    route_counts = Counter()
    route_by_sector = Counter()
    route_by_level = Counter()
    route_by_status = Counter()

    records_without_route = 0

    route_codes_by_product = defaultdict(set)

    for index, record in enumerate(records):
        route = record.get(
            "source_production_route_code"
        )

        sector = record.get(
            "sector"
        )

        level = record.get(
            "code_level"
        )

        total_status = (
            record.get(
                "total_emissions",
                {},
            ).get(
                "status"
            )
        )

        if route is None:
            records_without_route += 1
            continue

        if route not in VALID_ROUTES:
            errors.append(
                f"record[{index}]: unsupported route "
                f"{route!r}"
            )
            continue

        route_counts[route] += 1
        route_by_sector[
            (sector, route)
        ] += 1

        route_by_level[
            (level, route)
        ] += 1

        route_by_status[
            (route, total_status)
        ] += 1

        product_key = (
            record.get(
                "origin_country_name"
            ),
            record.get(
                "normalized_trade_code"
            ),
        )

        route_codes_by_product[
            product_key
        ].add(route)

    # ---------------------------------------------------------
    # A single country/code may legitimately have multiple
    # route-specific source rows. Report them instead of
    # treating them as duplicates.
    # ---------------------------------------------------------

    multi_route_products = {
        key: sorted(routes)
        for key, routes
        in route_codes_by_product.items()
        if len(routes) > 1
    }

    # ---------------------------------------------------------
    # Reference rows should not carry a route in the current
    # source model.
    # ---------------------------------------------------------

    reference_with_route = []

    for record in records:

        is_reference = all(
            record.get(
                field,
                {},
            ).get("status")
            == "REFERENCE_REQUIRED"
            for field in (
                "direct_emissions",
                "indirect_emissions",
                "total_emissions",
            )
        )

        if is_reference and (
            record.get(
                "source_production_route_code"
            )
            is not None
        ):
            reference_with_route.append(
                (
                    record.get(
                        "origin_country_name"
                    ),
                    record.get(
                        "normalized_trade_code"
                    ),
                    record.get(
                        "source_production_route_code"
                    ),
                )
            )

    for item in reference_with_route:
        errors.append(
            "REFERENCE_REQUIRED record has a "
            f"production route: {item!r}"
        )

    result = {
        "status": (
            "VALID"
            if not errors
            else "INVALID"
        ),

        "record_count": len(records),

        "records_without_route": (
            records_without_route
        ),

        "route_counts": dict(
            route_counts
        ),

        "route_by_sector": {
            f"{sector}|{route}": count
            for (
                sector,
                route,
            ), count in route_by_sector.items()
        },

        "route_by_level": {
            f"{level}|{route}": count
            for (
                level,
                route,
            ), count in route_by_level.items()
        },

        "route_by_total_status": {
            f"{route}|{status}": count
            for (
                route,
                status,
            ), count in route_by_status.items()
        },

        "multi_route_country_code_count": len(
            multi_route_products
        ),

        "multi_route_country_code_examples": {
            f"{country}|{code}": routes
            for (
                country,
                code,
            ), routes in list(
                multi_route_products.items()
            )[:100]
        },

        "reference_records_with_route": len(
            reference_with_route
        ),

        "errors": errors,
        "warnings": warnings,
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
        "=== DEFINITIVE PRODUCTION ROUTE RECONCILIATION ==="
    )

    print(
        f"Status: {result['status']}"
    )

    print(
        f"Records: {len(records)}"
    )

    print()
    print(
        "Route counts:"
    )

    for route, count in sorted(
        route_counts.items()
    ):
        print(
            f"  {route}: {count}"
        )

    print()
    print(
        "Records without route:",
        records_without_route,
    )

    print(
        "Country/code with multiple routes:",
        len(multi_route_products),
    )

    print(
        "Reference records with route:",
        len(reference_with_route),
    )

    print()
    print(
        f"Warnings: {len(warnings)}"
    )

    print(
        f"Errors: {len(errors)}"
    )

    print(
        f"Report: {OUTPUT}"
    )

    if errors:
        print()
        print(
            "First 20 errors:"
        )

        for error in errors[:20]:
            print(
                f"- {error}"
            )

        raise SystemExit(1)


if __name__ == "__main__":
    main()