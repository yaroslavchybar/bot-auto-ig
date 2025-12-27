import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticator } from 'otplib';
import {callBridge} from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const PROFILES_DIR = path.join(PROJECT_ROOT, 'profiles');

export type Profile = {
	id?: string; // Supabase ID
	name: string;
	proxy?: string;
	proxy_type?: string;
	type?: string;
	user_agent?: string;
	test_ip?: boolean;
	ua_os?: string; // Local only usually
	ua_browser?: string; // Local only usually
	status?: string;
	using?: boolean;
	login?: boolean;
};

export class ProfileManager {
	async getProfiles(): Promise<Profile[]> {
		try {
			const data = await callBridge<any[]>('profiles.list');
			return (data || []).map((p: any) => ({
				id: p.profile_id,
				name: p.name,
				proxy: p.proxy,
				proxy_type: p.proxy_type,
				type: p.type,
				user_agent: p.user_agent,
				test_ip: p.test_ip,
				ua_os: p.ua_os,
				ua_browser: p.ua_browser,
				status: p.status,
				using: p.Using,
				login: p.login
			}));
		} catch (e) {
			console.error('Error fetching profiles:', e);
			return [];
		}
	}

	async createProfile(profile: Profile): Promise<boolean> {
		try {
			await callBridge('profiles.create', {profile});
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
			await callBridge('profiles.update_by_name', {old_name: oldName, profile});
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
			await callBridge('profiles.delete_by_name', {name});
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
			await callBridge('profiles.sync_status', {name, status, using});
			return true;
		} catch (e) {
			console.error('Error syncing profile status:', e);
			return false;
		}
	}

	generateTotp(secret: string): string {
		try {
			const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
			return authenticator.generate(cleanSecret);
		} catch (e) {
			return 'Invalid Secret';
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
