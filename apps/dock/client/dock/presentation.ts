import type { ProcessKind, ProcessSnapshot } from '../../shared/contracts.js';

/** Visual identity of a process kind. */
export interface KindMeta {
	label: string;
	icon: 'api' | 'web' | 'queue' | 'scheduler' | 'script';
	color: string;
	tint: string;
}

/** Colours are theme tokens from style.css, so they follow light and dark mode. */
const KINDS: Record<ProcessKind, KindMeta> = {
	api: kind('API server', 'api'),
	web: kind('Web / dev server', 'web'),
	queue: kind('Queue worker', 'queue'),
	scheduler: kind('Scheduler', 'scheduler'),
	script: kind('Script', 'script'),
};

function kind(label: string, icon: KindMeta['icon']): KindMeta {
	return { label, icon, color: `var(--kind-${icon})`, tint: `color-mix(in srgb, var(--kind-${icon}) 14%, transparent)` };
}

/** Kinds in legend order. */
export const KIND_ORDER: ProcessKind[] = ['api', 'web', 'queue', 'scheduler', 'script'];

/**
 * @param kind - Process kind.
 * @returns Label, icon and colours.
 */
export function kindMeta(kind: ProcessKind): KindMeta {
	return KINDS[kind] ?? KINDS.script;
}

/** Tone used for status dots and text. */
export type StatusTone = 'ok' | 'busy' | 'off' | 'bad';

/**
 * @param snapshot - Process state, or undefined before the first event.
 * @param now - Current epoch milliseconds.
 * @returns Short label and tone, such as `Running · 3h 12m`.
 */
export function statusOf(snapshot: ProcessSnapshot | undefined, now: number): { label: string; tone: StatusTone } {
	if (!snapshot) return { label: 'Stopped', tone: 'off' };
	switch (snapshot.status) {
		case 'running':
			return { label: snapshot.startedAt !== null ? `Running · ${formatDuration(now - snapshot.startedAt)}` : 'Running', tone: 'ok' };
		case 'stopping':
			return { label: 'Stopping…', tone: 'busy' };
		case 'crashed':
			return { label: snapshot.exitCode !== null ? `Exited (${snapshot.exitCode})` : 'Crashed', tone: 'bad' };
		default:
			return { label: 'Stopped', tone: 'off' };
	}
}

/**
 * @param ms - Duration in milliseconds.
 * @returns Compact duration: `42s`, `5m`, `3h 12m`, `1d 4h`.
 */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * @param bytes - Resident memory.
 * @returns `184 MB`, `1.2 GB`, or `—`.
 */
export function formatMemory(bytes: number | null): string {
	if (bytes === null) return '—';
	const mb = bytes / (1024 * 1024);
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * @param snapshot - Process state.
 * @returns `2.1% · 184 MB` while running, else `—`.
 */
export function formatUsage(snapshot: ProcessSnapshot | undefined): string {
	if (!snapshot || snapshot.status !== 'running' || snapshot.cpu === null) return '—';
	return `${snapshot.cpu.toFixed(1)}% · ${formatMemory(snapshot.memory)}`;
}

/**
 * @param snapshot - Process state.
 * @returns Whether the process is up or shutting down.
 */
export function isUp(snapshot: ProcessSnapshot | undefined): boolean {
	return snapshot?.status === 'running' || snapshot?.status === 'stopping';
}

/**
 * Initials for a project badge: `Scout` → `S`, `steve-obrien.com` → `SO`.
 *
 * @param name - Project name.
 * @returns One or two upper-case letters.
 */
export function initials(name: string): string {
	const words = name.replace(/\.[a-z]{2,}$/i, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase();
	return (words[0]?.[0] ?? '?').toUpperCase();
}
