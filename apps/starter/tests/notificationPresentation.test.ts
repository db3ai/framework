import { expect, it } from 'vitest';
import { notificationToast, notificationTone } from '../client/notificationPresentation';

it('maps framework severities into DOM Studio tones', () => {
	expect(notificationTone('error')).toBe('danger');
	expect(notificationTone('warning')).toBe('warning');
	expect(notificationTone('success')).toBe('success');
	expect(notificationTone(undefined)).toBe('info');
});

it('passes plain content and stable identity to the toast without modifying recipient state', () => {
	const item = { id: 'message-1', type: 'report.ready', message: { title: '<b>Report ready</b>', body: 'Open your inbox.', severity: 'success' as const }, createdAt: '2026-09-17', readAt: null, dismissedAt: null, archivedAt: null };
	expect(notificationToast(item)).toEqual({ id: 'message-1', title: '<b>Report ready</b>', description: 'Open your inbox.', tone: 'success', duration: 6000 });
	expect(item.readAt).toBeNull();
	expect(item.dismissedAt).toBeNull();
});
