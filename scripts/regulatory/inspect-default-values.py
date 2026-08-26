from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data" / "raw" / "cbam-default-values-2026-02-04.xlsx"

def main() -> None:
    print(f"Reading: {INPUT}")

    workbook = pd.ExcelFile(INPUT)

    print("\nSheets:")
    for sheet in workbook.sheet_names:
        print(f" - {sheet}")

    print(f"\nTotal sheets: {len(workbook.sheet_names)}")

    for sheet in workbook.sheet_names[:5]:
        print(f"\n--- {sheet} ---")

        df = pd.read_excel(
            INPUT,
            sheet_name=sheet,
            header=None,
            nrows=15,
        )

        print(df.to_string(index=False, header=False))

if __name__ == "__main__":
    main()