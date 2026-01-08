import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { profilesCreate, profilesDeleteByName, profilesList, profilesSyncStatus, profilesUpdateByName } from './convex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PROFILES_DIR = path.join(PROJECT_ROOT, 'data', 'profiles');

export type Profile = {
	id?: string; // Database ID
	name: string;
	proxy?: string;
	proxy_type?: string;
	fingerprint_seed?: string;
	fingerprint_os?: string;
	test_ip?: boolean;
	status?: string;
	using?: boolean;
	login?: boolean;
};

export class ProfileManager {
	async getProfiles(): Promise<Profile[]> {
		try {
			const data = await profilesList();
			return (data || []).map((p: any) => ({
				id: p.profile_id,
				name: p.name,
				proxy: p.proxy,
				proxy_type: p.proxy_type,
				fingerprint_seed: p.fingerprint_seed,
				fingerprint_os: p.fingerprint_os,
				test_ip: p.test_ip,
				status: p.status,
				using: p.Using,
				login: p.login
			}));
		} catch (e) {
			console.error('Error fetching profiles:', e);
			return [];
		}
	}

	/**
	 * Get profile folder names from local data/profiles directory
	 */
	getLocalProfileNames(): string[] {
		try {
			if (!fs.existsSync(PROFILES_DIR)) return [];
			return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
				.filter(d => d.isDirectory())
				.map(d => d.name);
		} catch (e) {
			console.error('Error reading local profiles:', e);
			return [];
		}
	}

	/**
	 * Sync local profiles to database - creates DB entries for local profiles that don't exist in DB
	 * Returns the number of profiles created
	 */
	async syncLocalProfilesToDb(): Promise<{ created: number; errors: string[] }> {
		const localNames = this.getLocalProfileNames();
		if (localNames.length === 0) return { created: 0, errors: [] };

		let dbProfiles: Profile[] = [];
		try {
			dbProfiles = await this.getProfiles();
		} catch (e) {
			// If DB is empty or unreachable, try to create all local profiles
			dbProfiles = [];
		}

		const dbNames = new Set(dbProfiles.map(p => p.name));
		const toCreate = localNames.filter(name => !dbNames.has(name));

		let created = 0;
		const errors: string[] = [];

		for (const name of toCreate) {
			try {
				await profilesCreate({
					name,
					test_ip: false,
				});
				created++;
				console.log(`Auto-created profile in DB: ${name}`);
			} catch (e: any) {
				const msg = `Failed to create profile "${name}": ${e?.message || e}`;
				console.error(msg);
				errors.push(msg);
			}
		}

		return { created, errors };
	}

	async createProfile(profile: Profile): Promise<boolean> {
		try {
			await profilesCreate({
				name: profile.name,
				proxy: profile.proxy,
				proxy_type: profile.proxy_type,
				fingerprint_seed: profile.fingerprint_seed,
				fingerprint_os: profile.fingerprint_os,
				test_ip: profile.test_ip,
			});
		} catch (e) {
			console.error('Error creating profile in DB:', e);
			return false;
		}

		if (!fs.existsSync(PROFILES_DIR)) {
			fs.mkdirSync(PROFILES_DIR, { recursive: true });
		}

		return true;
	}

	async updateProfile(oldName: string, profile: Profile): Promise<boolean> {
		try {
			await profilesUpdateByName(oldName, {
				name: profile.name,
				proxy: profile.proxy,
				proxy_type: profile.proxy_type,
				fingerprint_seed: profile.fingerprint_seed,
				fingerprint_os: profile.fingerprint_os,
				test_ip: profile.test_ip,
			});
		} catch (e) {
			console.error('Error updating profile in DB:', e);
			return false;
		}

		// 2. Rename local directory if name changed
		if (oldName !== profile.name) {
			const oldPath = path.join(PROFILES_DIR, oldName);
			const newPath = path.join(PROFILES_DIR, profile.name);
			if (fs.existsSync(oldPath)) {
				try {
					fs.renameSync(oldPath, newPath);
				} catch (e) {
					console.error('Error renaming profile directory:', e);
					// Non-fatal?
				}
			}
		}

		return true;
	}

	async deleteProfile(name: string): Promise<boolean> {
		try {
			await profilesDeleteByName(name);
		} catch (e) {
			console.error('Error deleting profile from DB:', e);
			return false;
		}

		// 2. Delete local directory
		const profilePath = path.join(PROFILES_DIR, name);
		if (fs.existsSync(profilePath)) {
			try {
				fs.rmSync(profilePath, { recursive: true, force: true });
			} catch (e) {
				console.error('Error deleting profile directory:', e);
			}
		}

		return true;
	}

	async syncProfileStatus(name: string, status: string, using: boolean): Promise<boolean> {
		try {
			await profilesSyncStatus(name, status, using);
			return true;
		} catch (e) {
			console.error('Error syncing profile status:', e);
			return false;
		}
	}

	// Start/Stop would involve spawning Python processes, which is complex.
	// For now, we'll just toggle the status in DB to mimic "Start/Stop" signal if the backend watcher picks it up,
	// BUT the Python backend is not a daemon watcher. It's an app.
	// So "Start" in CLI should probably spawn the process directly using `launcher.py` or similar.
	// The Python code `ProfileCard` emits `start_signal`, which `ProfilesTab` handles by calling `self.main_window.process_manager.start_profile(name)`.
	// `ProcessManager` runs `subprocess.Popen`.

	// We can implement startProfile here by spawning the python process.
}

export const profileManager = new ProfileManager();
