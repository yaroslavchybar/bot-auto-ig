"""
Supabase configuration.

Uses publishable/secret keys from environment only.
Keep the secret key strictly server-side.
"""
import os
from pathlib import Path

# Load .env if python-dotenv is available
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)
except ImportError:
    pass

PROJECT_URL = os.environ.get("SUPABASE_URL")
PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY")

# Alias for client-side usage (publishable only)
API_KEY = PUBLISHABLE_KEY

# Default table/column names
DEFAULT_TABLE = "instagram_accounts"
DEFAULT_USERNAME_COLUMN = "user_name"