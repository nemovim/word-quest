export function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function roundTo2(value: number): number {
	return Math.round(value * 100) / 100;
}

export function toPojo<T>(data: unknown): T {
	if (data === undefined || data === null) return data as T;
	return JSON.parse(JSON.stringify(data)) as T;
}
