"""CSV cleaning utilities for data preprocessing."""

import pandas as pd
import glob
from pathlib import Path


def find_csv_file() -> str:
    """Find the first CSV file in the current directory."""
    csv_files = glob.glob("*.csv")
    if not csv_files:
        raise FileNotFoundError("No CSV files found in the current directory")
    return csv_files[0]


def detect_csv_separator(input_file: str | Path) -> str:
    """Detect whether CSV uses comma or semicolon as separator."""
    with open(input_file, 'r', encoding='utf-8-sig') as f:
        first_line = f.readline()
        comma_count = first_line.count(',')
        semicolon_count = first_line.count(';')
        return ',' if comma_count > semicolon_count else ';'


def find_footer_start(df: pd.DataFrame) -> int | None:
    """Find where the footer section starts."""
    for i, row in df.iterrows():
        first_col_str = str(row.iloc[0]).strip()
        
        # Check for footer indicators
        if (first_col_str.startswith("Found profiles count:") or 
            first_col_str == "IG DM BOT:" or
            "profiles max on free plan" in first_col_str or
            "max on free plan" in first_col_str or
            first_col_str == "" or
            first_col_str == "nan"):
            
            # Double-check by looking at the pattern
            footer_confirmed = False
            for j in range(i, min(i + 5, len(df))):
                if j < len(df):
                    check_str = str(df.iloc[j, 0]).strip()
                    if (check_str.startswith("Found profiles count:") or 
                        check_str == "IG DM BOT:" or
                        "profiles max on free plan" in check_str or
                        "max on free plan" in check_str or
                        check_str in ["", "nan"] or
                        "socialdeck.ai" in check_str.lower()):
                        footer_confirmed = True
                        break
            
            if footer_confirmed:
                return i
    
    return None


def clean_csv(input_file: str | Path) -> tuple[pd.DataFrame, str]:
    """Clean the CSV file according to specifications."""
    separator = detect_csv_separator(input_file)
    
    # Read the CSV file with detected separator
    df = pd.read_csv(input_file, sep=separator, quotechar='"', skipinitialspace=True)
    
    # Find where footer starts and remove everything from that point
    footer_start = find_footer_start(df)
    
    if footer_start is not None:
        df = df.iloc[:footer_start]
    
    # Additional cleanup - remove problematic rows
    footer_patterns = [
        "Found profiles count:",
        "IG DM BOT:",
        "socialdeck.ai",
        "https://socialdeck.ai",
        "profiles max on free plan",
        "max on free plan"
    ]
    
    for pattern in footer_patterns:
        mask = ~df.iloc[:, 0].astype(str).str.contains(pattern, case=False, na=False)
        df = df[mask]
    
    # Remove completely empty rows
    df = df.dropna(how='all')
    
    # Remove rows where first column is empty
    df = df[df.iloc[:, 0].astype(str).str.strip() != '']
    df = df[df.iloc[:, 0].astype(str).str.strip() != 'nan']
   
    return df, separator
