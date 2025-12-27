import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {spawn} from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels up from cli/source/lib)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // We'll handle this error gracefully in the UI if needed, or throw
  console.error("Supabase credentials missing. Please check your .env file.");
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

type BridgeOk<T> = {ok: true; data: T};
type BridgeErr = {ok: false; error: string};
type BridgeResponse<T> = BridgeOk<T> | BridgeErr;

export async function callBridge<T>(op: string, args: Record<string, any> = {}): Promise<T> {
	const scriptPath = path.resolve(__dirname, '../../scripts/supabase_bridge.py');
	const python = process.env.PYTHON || 'python';

	return new Promise<T>((resolve, reject) => {
		const child = spawn(python, [scriptPath], {cwd: path.resolve(__dirname, '../../..'), stdio: 'pipe'});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', d => {
			stdout += String(d);
		});
		child.stderr.on('data', d => {
			stderr += String(d);
		});
		child.on('error', err => {
			reject(err);
		});
		child.on('close', code => {
			if (code && code !== 0) {
				reject(new Error(stderr || `Bridge exited with code ${code}`));
				return;
			}
			try {
				const parsed = JSON.parse(stdout || '{}') as BridgeResponse<T>;
				if (!parsed || parsed.ok !== true) {
					const msg = (parsed as any)?.error || stderr || 'Bridge error';
					reject(new Error(msg));
					return;
				}
				resolve(parsed.data);
			} catch (e: any) {
				reject(new Error(stderr || e?.message || 'Failed to parse bridge response'));
			}
		});

		child.stdin.write(JSON.stringify({op, args}));
		child.stdin.end();
	});
}
