from __future__ import annotations

from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "data"
    / "processed"
    / "default-emission-values.json"
)


def main() -> None:

    if not INPUT.exists():
        raise FileNotFoundError(
            f"Normalized dataset not found: {INPUT}"
        )

    records = json.loads(
        INPUT.read_text(
            encoding="utf-8"
        )
    )

    country = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "India"
    )

    trade_code = (
        sys.argv[2]
        if len(sys.argv) > 2
        else "25232900"
    )

    matches = [
        record
        for record in records
        if (
            record.get(
                "origin_country_name"
            )
            == country
            and record.get(
                "trade_code"
            )
            == trade_code
        )
    ]

    print(
        json.dumps(
            matches,
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()