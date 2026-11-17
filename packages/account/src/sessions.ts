import type { AuthSessionData } from '@db3.ai/app/auth';

/** A signed-in session as an account page lists it: the framework's session data, plus whether it is this one. */
export type AccountSession = AuthSessionData & { current: boolean };

/**
 * A short date and time, "Nov 11, 3:53 PM", with the year only when it is not this year.
 *
 * @param iso - An ISO time, or null.
 * @param now - Today, for the year check.
 * @returns The time in the reader's locale, or "Unknown".
 */
export function sessionTime(iso: string | null, now = new Date()): string {
	if (!iso) return 'Unknown';
	const date = new Date(iso);
	return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** This session first, then the most recently active. */
export function orderSessions(sessions: AccountSession[]): AccountSession[] {
	const active = (session: AccountSession) => session.lastUsedAt ?? session.createdAt ?? '';
	return [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || active(b).localeCompare(active(a)));
}
