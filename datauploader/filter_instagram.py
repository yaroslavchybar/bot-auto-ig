"""Instagram account filtering based on gender classification."""

import csv
import re
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import fasttext

from clean_data import clean_csv, detect_csv_separator
from convex_client import get_keywords

BASE_DIR = Path(__file__).parent
MODEL_PATH = BASE_DIR / "lid.176.ftz"

_fasttext_model = None

def get_fasttext_model():
    global _fasttext_model
    if _fasttext_model is None:
        if not MODEL_PATH.exists():
            print(f"Downloading FastText model to {MODEL_PATH}...")
            urllib.request.urlretrieve(
                "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz",
                MODEL_PATH
            )
        fasttext.FastText.eprint = lambda x: None
        _fasttext_model = fasttext.load_model(str(MODEL_PATH))
    return _fasttext_model

def is_english(text: str) -> bool:
    """Check if text is mostly English using fasttext."""
    if not text or not text.strip():
        return True
    
    try:
        model = get_fasttext_model()
        clean_text = text.replace('\n', ' ').strip()
        predictions = model.predict(clean_text, k=1)
        if predictions and predictions[0]:
            label = predictions[0][0]
            return label == '__label__en'
        return True
    except Exception as e:
        print(f"FastText predict error: {e}")
        return True


def _parse_keyword_content(content: str) -> set[str]:
    """Parse newline-separated keyword content into a set."""
    return {line.strip().lower() for line in content.split('\n') if line.strip() and not line.startswith('#')}


def load_keywords(filename: str, env: str = "dev") -> set[str]:
    """Load keywords from the Convex DB by filename."""
    db_content = get_keywords(filename, env=env)
    if db_content is not None:
        return _parse_keyword_content(db_content)
    return set()


def load_all_keyword_sets(env: str = "dev") -> dict[str, set[str]]:
    """Load all keyword sets used for filtering from the DB."""
    return {
        "us_male_names": load_keywords("us_male_names.txt", env=env),
    }


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


def classify_gender(
    username: str,
    fullname: str,
    keyword_sets: dict[str, set[str]] | None = None,
) -> str:
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

    female_business = keyword_sets.get("female_business_keywords", set()) if keyword_sets else set()
    male_exceptions = keyword_sets.get("male_names_exceptions", set()) if keyword_sets else set()
    female_names = keyword_sets.get("female_names", set()) if keyword_sets else set()

    # Check for female business keywords
    if female_business and any(keyword in parts for keyword in female_business):
        return 'female'

    # Check for male name exceptions - if found, keep it
    if male_exceptions and any(male_name in parts for male_name in male_exceptions):
        return 'keep'

    # Check for high-confidence female names
    if female_names and any(female_name in parts for female_name in female_names):
        return 'female'

    # Last resort: Check for female endings
    for part in parts:
        if len(part) > 3 and part not in male_exceptions:
            for ending in FEMALE_ENDINGS:
                if part.endswith(ending):
                    return 'female'

    return 'keep'


def filter_with_keywords(
    username: str,
    fullname: str,
    keyword_sets: dict[str, set[str]] | None = None,
) -> tuple[str, str | None]:
    """Filter a profile using keyword sets (US male names allowlist + gender classification).

    Returns a tuple of (action, matched_name) where action is 'keep' or 'remove',
    and matched_name is the keyword that caused the account to be kept (or None).
    """
    if fullname:
        if not is_english(fullname):
            return ('remove', None)

    if keyword_sets is None:
        # Fall back to basic gender classification
        action = 'remove' if classify_gender(username, fullname) == 'female' else 'keep'
        return (action, None)

    us_male_names = keyword_sets.get("us_male_names", set())

    matched_name: str | None = None

    # If we have a US male names allowlist, check it
    if us_male_names:
        # 1. Check full name parts
        if fullname:
            cleaned = re.sub(r'[^a-z]+', ' ', fullname.lower())
            for part in cleaned.split():
                if part in us_male_names:
                    matched_name = part
                    break

        # 2. Fallback: check username parts
        if not matched_name and username:
            cleaned = re.sub(r'[^a-z]+', ' ', username.lower())
            for part in cleaned.split():
                if part in us_male_names:
                    matched_name = part
                    break

        # If allowlist is active and name not found, remove
        if not matched_name:
            return ('remove', None)

    # Run gender classification with keyword sets from DB
    if classify_gender(username, fullname, keyword_sets) == 'female':
        return ('remove', None)

    return ('keep', matched_name.capitalize() if matched_name else None)


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
    keep_fields: list[str] | None = None,
    env: str = "dev",
) -> dict[str, Any] | None:
    """Read, filter, and write Instagram data. Returns stats dict."""
    try:
        keyword_sets = load_all_keyword_sets(env=env)
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

                action, _ = filter_with_keywords(username, fullname, keyword_sets)
                if action == 'remove':
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
