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
