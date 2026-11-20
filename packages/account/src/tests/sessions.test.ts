import { describe, expect, it } from 'vitest';
import { orderSessions, sessionTime, type AccountSession } from '../sessions';

const session = (id: string, lastUsedAt: string | null, current = false): AccountSession => ({ id, name: null, ipAddress: null, browser: null, operatingSystem: null, device: null, label: id, location: null, expiresAt: null, lastUsedAt, createdAt: '2026-01-01T00:00:00Z', current });

describe('account sessions', () => {
	it('lists this session first, then the most recently active', () => {
		const ordered = orderSessions([session('old', '2026-02-01T00:00:00Z'), session('mine', '2026-01-02T00:00:00Z', true), session('new', '2026-03-01T00:00:00Z')]);
		expect(ordered.map(item => item.id)).toEqual(['mine', 'new', 'old']);
	});

	it('shows the year only when it is not this year, and Unknown for no time', () => {
		const now = new Date('2026-11-17T12:00:00Z');
		expect(sessionTime('2026-11-11T15:53:00Z', now)).not.toMatch(/2026/);
		expect(sessionTime('2025-06-20T22:58:00Z', now)).toMatch(/2025/);
		expect(sessionTime(null, now)).toBe('Unknown');
	});
});
