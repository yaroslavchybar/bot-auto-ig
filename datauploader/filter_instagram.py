"""Instagram account filtering based on gender classification."""

import csv
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from clean_data import clean_csv, detect_csv_separator

BASE_DIR = Path(__file__).parent


def load_names_from_file(filename: str | Path) -> set[str]:
    """Load keywords from a file, ignoring comments."""
    file_path = BASE_DIR / filename if isinstance(filename, (str, Path)) else filename
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return {line.strip().lower() for line in f if line.strip() and not line.startswith('#')}
    except FileNotFoundError:
        print(f"Warning: File '{file_path}' not found.")
        return set()


# Load external databases
MALE_NAMES_EXCEPTIONS = load_names_from_file('keywords/males_names.txt')
FEMALE_BUSINESS_KEYWORDS = load_names_from_file('keywords/female_business_keywords.txt')
FEMALE_NAMES = (
    load_names_from_file('keywords/ukrainian_female_names.txt') | 
    load_names_from_file('keywords/russian_female_names.txt')
)

# Female name endings (used as a last resort)
FEMALE_ENDINGS = {'a', 'ya', 'ia', 'ina', 'ova', 'eva', 'skaya', 'ivna', 'yivna', 'ovna'}


def normalize_text(text: str) -> str:
    """Convert special font characters to standard Latin letters."""
    normalization_map = {
        'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h',
        'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
        'ǫ': 'q', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
        'ʏ': 'y', 'ᴢ': 'z'
    }
    for char, replacement in normalization_map.items():
        text = text.replace(char, replacement)
    return text


def classify_gender(username: str, fullname: str) -> str:
    """
    Classify a profile using a multi-step priority system.
    Returns 'female' for removal, or 'keep' to keep the profile.
    """
    combined_text = f"{username} {fullname}".lower()
    if not combined_text.strip():
        return 'keep'

    # Normalize the text to handle special fonts
    normalized_text = normalize_text(combined_text)

    # Clean and split the text into words
    cleaned_text = re.sub(r'[^a-zа-яёїієґ]+', ' ', normalized_text)
    parts = set(cleaned_text.split())

    # Check for female business keywords
    if any(keyword in parts for keyword in FEMALE_BUSINESS_KEYWORDS):
        return 'female'

    # Check for male name exceptions - if found, keep it
    if any(male_name in parts for male_name in MALE_NAMES_EXCEPTIONS):
        return 'keep'

    # Check for high-confidence female names
    if any(female_name in parts for female_name in FEMALE_NAMES):
        return 'female'

    # Last resort: Check for female endings
    for part in parts:
        if len(part) > 3 and part not in MALE_NAMES_EXCEPTIONS:
            for ending in FEMALE_ENDINGS:
                if part.endswith(ending):
                    return 'female'

    return 'keep'


def _first_present(row: dict, candidates: list[str]) -> str:
    """Get first non-empty value from row using candidate keys."""
    for k in candidates:
        v = row.get(k)
        if v is not None:
            s = str(v)
            if s != "":
                return s
    return ""


def filter_instagram_data(
    input_file: str | Path,
    output_file: str | Path,
    keep_fields: list[str] | None = None
) -> dict[str, Any] | None:
    """Read, filter, and write Instagram data. Returns stats dict."""
    try:
        sep = detect_csv_separator(input_file)
        with open(input_file, 'r', encoding='utf-8') as infile, \
             open(output_file, 'w', newline='', encoding='utf-8') as outfile:

            reader = csv.DictReader(infile, delimiter=sep)
            if not reader.fieldnames:
                return None

            if keep_fields is None:
                out_fields = list(reader.fieldnames)
            else:
                out_fields = [f for f in keep_fields if f in set(reader.fieldnames)]
                if not out_fields:
                    return None

            writer = csv.DictWriter(outfile, fieldnames=out_fields, delimiter=sep)
            writer.writeheader()

            total_processed, removed_count = 0, 0
            for row in reader:
                total_processed += 1
                username = _first_present(row, ["user_name", "userName", "login"])
                fullname = _first_present(row, ["full_name", "fullName", "name"])

                classification = classify_gender(username, fullname)

                if classification == 'female':
                    removed_count += 1
                else:
                    writer.writerow({k: row.get(k, "") for k in out_fields})

            return {
                "total_processed": total_processed,
                "removed": removed_count,
                "remaining": total_processed - removed_count,
                "output_file": str(output_file),
            }

    except FileNotFoundError:
        return None
    except Exception:
        return None


def preprocess_csv(input_path: str | Path) -> tuple[Path, TemporaryDirectory]:
    """Run the cleaning step and return (cleaned_csv_path, temp_dir)."""
    input_path = Path(input_path)
    cleaned_df, sep = clean_csv(str(input_path))
    tmpdir = TemporaryDirectory()
    out_path = Path(tmpdir.name) / f"{input_path.stem}_cleaned.csv"
    cleaned_df.to_csv(out_path, index=False, sep=sep)
    return out_path, tmpdir


def filter_csv(
    input_path: str | Path,
    output_path: str | Path,
    keep_fields: list[str] | None = None
) -> dict[str, Any] | None:
    """Clean first, then filter. Returns stats dict or None."""
    cleaned_path, tmpdir = preprocess_csv(input_path)
    try:
        return filter_instagram_data(str(cleaned_path), str(output_path), keep_fields=keep_fields)
    finally:
        tmpdir.cleanup()
