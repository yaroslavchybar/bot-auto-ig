import path from 'path'
import { fileURLToPath } from 'url'

export function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

export function toInt(value: string, fallback: number) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function toFloat(value: string, fallback: number) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function nextPercent(value: number, delta: number) {
    const step = 10;
    const v = clamp(Math.round(value / step) * step + delta * step, 0, 100);
    return v;
}

export function resolveProjectRoot(moduleUrl: string) {
    const modulePath = fileURLToPath(moduleUrl)
    const moduleDir = path.dirname(modulePath)
    const inDist = path.basename(path.dirname(moduleDir)) === 'dist'
    return inDist
        ? path.resolve(moduleDir, '../../..')
        : path.resolve(moduleDir, '../..')
}
