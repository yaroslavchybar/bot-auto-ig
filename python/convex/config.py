"""
Convex/Supabase configuration.

Uses publishable/secret keys from environment only.
Keep the secret key strictly server-side.
"""
import os
from pathlib import Path

# Load .env if python-dotenv is available
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)
except ImportError:
    pass

PROJECT_URL = os.environ.get("SUPABASE_URL")
PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY")

CONVEX_URL = os.environ.get("CONVEX_URL")
CONVEX_API_KEY = os.environ.get("CONVEX_API_KEY")

# HTTP Actions are served at .convex.site, not .convex.cloud
# Convert the URL if needed
if CONVEX_URL:
    CONVEX_URL = CONVEX_URL.replace(".convex.cloud", ".convex.site")

PROJECT_URL = CONVEX_URL or PROJECT_URL
SECRET_KEY = CONVEX_API_KEY or SECRET_KEY

API_KEY = CONVEX_API_KEY or PUBLISHABLE_KEY

# Default table/column names
DEFAULT_TABLE = "instagram_accounts"
DEFAULT_USERNAME_COLUMN = "user_name"

