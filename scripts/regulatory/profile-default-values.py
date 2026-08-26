from pathlib import Path
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "data" / "raw" / "cbam-default-values-2026-02-04.xlsx"

DATA_SHEETS_TO_SKIP = {
    "Overview",
    "Version History",
}


SECTOR_NAMES = {
    "Cement",
    "Fertilisers",
    "Hydrogen",
    "Iron and steel",
    "Aluminium",
    "Electricity",
}


def clean(value):
    if pd.isna(value):
        return None

    text = str(value).strip()

    return text if text else None


def print_row_structure(df: pd.DataFrame, sheet_name: str, row_number: int) -> None:
    print(f"\n--- {sheet_name}, Excel-like row {row_number + 1} ---")

    for column_index, value in enumerate(df.iloc[row_number].tolist()):
        cleaned = clean(value)

        if cleaned is not None:
            print(
                f"column[{column_index}] = {cleaned!r}"
            )


def main() -> None:
    print(f"Reading: {INPUT}")

    if not INPUT.exists():
        raise FileNotFoundError(
            f"Workbook not found: {INPUT}"
        )

    workbook = pd.ExcelFile(INPUT)

    data_sheets = [
        sheet
        for sheet in workbook.sheet_names
        if sheet not in DATA_SHEETS_TO_SKIP
    ]

    print(f"\nTotal data sheets: {len(data_sheets)}")

    # ---------------------------------------------------------
    # 1. Inspect one country sheet in detail
    # ---------------------------------------------------------

    sample_sheet = "Albania"

    df = pd.read_excel(
        INPUT,
        sheet_name=sample_sheet,
        header=None,
    )

    print_row_structure(df, sample_sheet, 0)
    print_row_structure(df, sample_sheet, 1)
    print_row_structure(df, sample_sheet, 2)
    print_row_structure(df, sample_sheet, 3)
    print_row_structure(df, sample_sheet, 4)

    # ---------------------------------------------------------
    # 2. Inspect India
    # ---------------------------------------------------------

    if "India" in workbook.sheet_names:
        india = pd.read_excel(
            INPUT,
            sheet_name="India",
            header=None,
        )

        print_row_structure(india, "India", 0)
        print_row_structure(india, "India", 1)
        print_row_structure(india, "India", 2)
        print_row_structure(india, "India", 3)

    # ---------------------------------------------------------
    # 3. Inspect Other Countries and Territories
    # ---------------------------------------------------------

    fallback_sheet = "_Other Countries and Territorie"

    if fallback_sheet in workbook.sheet_names:
        fallback = pd.read_excel(
            INPUT,
            sheet_name=fallback_sheet,
            header=None,
        )

        print_row_structure(
            fallback,
            fallback_sheet,
            0,
        )

        print_row_structure(
            fallback,
            fallback_sheet,
            1,
        )

        print_row_structure(
            fallback,
            fallback_sheet,
            2,
        )

    # ---------------------------------------------------------
    # 4. Profile actual non-empty columns
    # ---------------------------------------------------------

    print("\nColumn usage by first 20 data sheets:")

    for sheet in data_sheets[:20]:
        sheet_df = pd.read_excel(
            INPUT,
            sheet_name=sheet,
            header=None,
        )

        non_empty_columns = []

        for column_index in range(sheet_df.shape[1]):
            non_empty_count = (
                sheet_df.iloc[:, column_index]
                .notna()
                .sum()
            )

            if non_empty_count > 0:
                non_empty_columns.append(
                    (column_index, int(non_empty_count))
                )

        print(
            f"{sheet}: {non_empty_columns}"
        )


if __name__ == "__main__":
    main()