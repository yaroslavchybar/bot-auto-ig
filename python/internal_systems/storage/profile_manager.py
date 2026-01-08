import json
import os
import shutil
from python.database_sync.profiles_client import SupabaseProfilesClient, SupabaseProfilesError

import logging

PROFILE_DB = "db.json"

logger = logging.getLogger(__name__)

def _profiles_dir() -> str:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    return os.path.join(repo_root, "data", "profiles")

class ProfileManager:
    def __init__(self, db_path=PROFILE_DB):
        self.db_path = db_path
        self.db_client = None
        try:
            self.db_client = SupabaseProfilesClient()
        except SupabaseProfilesError as e:
            logger.warning(f"Database sync disabled - {e}")

        self.profiles = self.load_profiles()
        # Fetch from database on startup to populate in-memory cache
        try:
            self.sync_from_database()
        except Exception:
            pass

    def load_profiles(self):
        """Initialize in-memory profiles cache (cloud-first; no local file)."""
        return {"private": [], "threads": []}

    def save_profiles(self):
        """No-op: profiles are stored in-memory and persisted to database."""
        return

    def add_profile(self, category, profile_data):
        if category not in self.profiles:
            self.profiles[category] = []
        self.profiles[category].append(profile_data)
        self.save_profiles()

        # Sync to database
        if self.db_client:
            try:
                self.db_client.create_profile(profile_data)
            except SupabaseProfilesError as e:
                logger.warning(f"Failed to sync new profile to database - {e}")

    def delete_profile(self, category, index):
        if category in self.profiles and 0 <= index < len(self.profiles[category]):
            profile_to_delete = self.profiles[category][index]

            # Sync to database first
            if self.db_client:
                try:
                    db_profile = self.db_client.get_profile_by_name(profile_to_delete["name"])
                    if db_profile:
                        self.db_client.delete_profile(db_profile["profile_id"])
                except SupabaseProfilesError as e:
                    logger.warning(f"Failed to sync profile deletion to database - {e}")
                    return False  # Don't delete locally if DB sync fails

            # Delete the browser profile directory
            profile_name = profile_to_delete["name"]
            profiles_dir = _profiles_dir()
            profile_path = os.path.join(profiles_dir, profile_name)

            if os.path.exists(profile_path):
                try:
                    shutil.rmtree(profile_path)
                    logger.info(f"Deleted browser profile directory: '{profile_name}'")
                except Exception as e:
                    logger.warning(f"Failed to delete browser profile directory '{profile_path}': {e}")
                    # Continue with the deletion anyway, as the JSON data removal is more important

            del self.profiles[category][index]
            self.save_profiles()
            return True
        return False

    def get_profile(self, category, index):
        if category in self.profiles and 0 <= index < len(self.profiles[category]):
            return self.profiles[category][index]
        return None

    def update_profile(self, category, index, profile_data):
        if category in self.profiles and 0 <= index < len(self.profiles[category]):
            old_profile = self.profiles[category][index]
            old_name = old_profile["name"]
            new_name = profile_data["name"]

            # Check if profile name changed and handle directory rename
            if old_name != new_name:
                profiles_dir = _profiles_dir()
                old_path = os.path.join(profiles_dir, old_name)
                new_path = os.path.join(profiles_dir, new_name)

                # Check if old directory exists
                if os.path.exists(old_path):
                    # Check if new directory already exists (shouldn't happen due to duplicate name validation)
                    if os.path.exists(new_path):
                        logger.warning(f"Cannot rename profile directory - '{new_path}' already exists")
                        return False

                    try:
                        # Rename the browser profile directory
                        shutil.move(old_path, new_path)
                        logger.info(f"Renamed browser profile directory: '{old_name}' -> '{new_name}'")
                    except Exception as e:
                        logger.warning(f"Failed to rename browser profile directory: {e}")
                        # Continue with the update anyway, as the JSON data is more important

            self.profiles[category][index] = profile_data
            self.save_profiles()

            # Sync to database
            if self.db_client:
                try:
                    db_profile = self.db_client.get_profile_by_name(old_profile["name"])
                    if db_profile:
                        self.db_client.update_profile(db_profile["profile_id"], profile_data)
                    else:
                        # Profile doesn't exist in DB, create it
                        self.db_client.create_profile(profile_data)
                except SupabaseProfilesError as e:
                    logger.warning(f"Failed to sync profile update to database - {e}")

            return True
        return False

    def sync_from_database(self):
        """Sync profiles from database to local JSON"""
        if not self.db_client:
            return

        try:
            db_profiles = self.db_client.get_all_profiles()
            db_profile_names = {p["name"] for p in db_profiles}

            # Convert DB profiles to local format
            db_local_profiles = []
            for db_profile in db_profiles:
                db_mapped = {
                    "name": db_profile["name"],
                    "proxy": db_profile.get("proxy"),
                    "proxy_type": db_profile.get("proxy_type"),
                    "test_ip": db_profile.get("test_ip", False),
                    "type": db_profile.get("type", "Camoufox (рекомендуется)"),
                    "user_agent": db_profile.get("user_agent")
                }
                # Preserve extra local-only fields (e.g., ua_os, ua_browser)
                existing_local = next((lp for lp in self.profiles.get("private", []) if lp.get("name") == db_profile["name"]), None)
                if existing_local:
                    merged = {**existing_local, **db_mapped}
                    db_local_profiles.append(merged)
                else:
                    db_local_profiles.append(db_mapped)

            # Merge with existing local profiles (keep local ones that aren't in DB)
            existing_local = self.profiles.get("private", [])
            merged_profiles = []

            # Add all DB profiles first
            merged_profiles.extend(db_local_profiles)

            # Add local profiles that don't exist in DB
            for local_profile in existing_local:
                if local_profile["name"] not in db_profile_names:
                    merged_profiles.append(local_profile)

            # Update local storage (only private category for now)
            self.profiles["private"] = merged_profiles
            self.save_profiles()

        except SupabaseProfilesError as e:
            logger.warning(f"Failed to sync from database - {e}")

    def update_profile_status(self, name: str, status: str, using: bool = False):
        """Update profile status in database"""
        if self.db_client:
            try:
                self.db_client.sync_profile_status(name, status, using)
            except SupabaseProfilesError as e:
                logger.warning(f"Failed to sync profile status - {e}")

    def ensure_db_has_local_profiles(self):
        if not self.db_client:
            return
        try:
            db_profiles = self.db_client.get_all_profiles()
            db_names = {p.get("name") for p in db_profiles}
            for local in self.profiles.get("private", []):
                name = local.get("name")
                if name and name not in db_names:
                    try:
                        self.db_client.create_profile(local)
                    except SupabaseProfilesError:
                        pass
        except SupabaseProfilesError:
            pass
