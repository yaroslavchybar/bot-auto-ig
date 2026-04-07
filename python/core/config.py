"""
Convex configuration.

Uses Convex keys from environment only.
Keep the API key strictly server-side.
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

CONVEX_URL = os.environ.get("CONVEX_URL")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY")
DATAUPLOADER_URL = os.environ.get("DATAUPLOADER_URL") or os.environ.get("VITE_DATAUPLOADER_URL")
DATAUPLOADER_ENV = (os.environ.get("DATAUPLOADER_ENV") or "dev").strip().lower() or "dev"
DATAUPLOADER_DEST_ENVIRONMENTS = [
    item.strip().lower()
    for item in (os.environ.get("DATAUPLOADER_DEST_ENVIRONMENTS") or DATAUPLOADER_ENV).split(",")
    if item.strip()
]
DATAUPLOADER_ACCOUNT_STATUS = os.environ.get("DATAUPLOADER_ACCOUNT_STATUS", "available").strip() or "available"

# HTTP Actions are served at .convex.site, not .convex.cloud
# Convert the URL if needed
if CONVEX_URL:
    CONVEX_URL = CONVEX_URL.replace(".convex.cloud", ".convex.site")

PROJECT_URL = CONVEX_URL
SECRET_KEY = INTERNAL_API_KEY
API_KEY = INTERNAL_API_KEY

if DATAUPLOADER_URL:
    DATAUPLOADER_URL = DATAUPLOADER_URL.rstrip("/")
else:
    DATAUPLOADER_URL = "http://localhost:3002"

# Default table/column names
DEFAULT_TABLE = "instagram_accounts"
DEFAULT_USERNAME_COLUMN = "user_name"
