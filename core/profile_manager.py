import json
import os
from supabase.profiles_client import SupabaseProfilesClient, SupabaseProfilesError

PROFILE_DB = "db.json"

class ProfileManager:
    def __init__(self, db_path=PROFILE_DB):
        self.db_path = db_path
        self.db_client = None
        try:
            self.db_client = SupabaseProfilesClient()
        except SupabaseProfilesError as e:
            print(f"Warning: Database sync disabled - {e}")

        self.profiles = self.load_profiles()

    def load_profiles(self):
        """Load profiles from JSON file"""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return {"private": data, "threads": []}
                    return data
            except:
                return {"private": [], "threads": []}
        return {"private": [], "threads": []}

    def save_profiles(self):
        """Save profiles to JSON file"""
        with open(self.db_path, "w", encoding="utf-8") as f:
            json.dump(self.profiles, f, indent=4, ensure_ascii=False)

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
                print(f"Warning: Failed to sync new profile to database - {e}")

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
                    print(f"Warning: Failed to sync profile deletion to database - {e}")
                    return False  # Don't delete locally if DB sync fails

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
                    print(f"Warning: Failed to sync profile update to database - {e}")

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
                local_profile = {
                    "name": db_profile["name"],
                    "proxy": db_profile.get("proxy"),
                    "test_ip": db_profile.get("test_ip", False),
                    "type": db_profile.get("type", "Camoufox (рекомендуется)")
                }
                db_local_profiles.append(local_profile)

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
            print(f"Warning: Failed to sync from database - {e}")

    def update_profile_status(self, name: str, status: str, using: bool = False):
        """Update profile status in database"""
        if self.db_client:
            try:
                self.db_client.sync_profile_status(name, status, using)
            except SupabaseProfilesError as e:
                print(f"Warning: Failed to sync profile status - {e}")