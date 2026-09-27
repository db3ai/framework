import { UserIdentity, type UserIdentityModel } from '../../auth';
import { describe, expect, it, vi } from 'vitest';
import { Notifications } from '../Notifications';
import type { Notification } from '../contracts';

class TestUser extends UserIdentity {}

/** Creates a persisted-looking user without requiring a database for coordinator tests. */
function user(id = '01ARZ3NDEKTSV4RRFFQ69G5FAV'): TestUser {
	return TestUser.create({ id, name: 'Owner', email: `${id}@example.test` });
}

/** Creates a complete two-channel notification for coordinator tests. */
function notification(): Notification<TestUser> {
	return {
		type: 'report.ready',
		via: resolved => resolved.email ? ['inApp', 'mail'] : ['inApp'],
		scope: () => ({ type: 'organization', id: 'organization-1' }),
		key: () => 'report-1',
		toInApp: resolved => ({ title: `Ready for ${resolved.name}`, body: 'Open the report.', presentation: 'banner' }),
		toMail: resolved => ({ to: resolved.email!, subject: 'Ready', text: 'Open the report.' }),
	};
}

/** Creates a coordinator with isolated channel and identity doubles. */
function service(users: TestUser[] = [user()]) {
	const calls: string[] = [];
	const inApp = { send: vi.fn(async (userId: string) => { calls.push(`inApp:${userId}`); return [{ userId, id: `message-${userId}`, status: 'created' as const }]; }) };
	const mail = { send: vi.fn(async () => { calls.push('mail'); return { id: 'mail-1', transport: 'test', accepted: ['owner@example.test'], rejected: [] }; }) };
	const byId = new Map(users.map(resolved => [String(resolved.id), resolved]));
	const identityModel = { find: vi.fn(async (id: string) => byId.get(id) ?? null) } as unknown as UserIdentityModel<TestUser>;

	return { calls, inApp, mail, identityModel, notifications: new Notifications(inApp as never, mail as never, identityModel) };
}

describe('Notifications', () => {
	it('passes the resolved user to routing and renderers, then delivers selected channels', async () => {
		const resolved = user();
		const runtime = service([resolved]);

		const result = await runtime.notifications.send(resolved, notification());

		expect(runtime.calls).toEqual(['inApp:01ARZ3NDEKTSV4RRFFQ69G5FAV', 'mail']);
		expect(runtime.inApp.send).toHaveBeenCalledWith('01ARZ3NDEKTSV4RRFFQ69G5FAV', expect.objectContaining({ title: 'Ready for Owner' }), {
			scope: { type: 'organization', id: 'organization-1' },
			type: 'report.ready',
			key: 'report-1',
		});
		expect(runtime.mail.send).toHaveBeenCalledWith(expect.objectContaining({
			to: '01arz3ndektsv4rrffq69g5fav@example.test',
			idempotencyKey: expect.stringMatching(/^notification\/[a-f0-9]{64}$/),
		}));
		expect(result).toMatchObject([{ userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', inApp: { status: 'created' }, mail: { id: 'mail-1' } }]);
	});

	it('resolves IDs before delivery and removes duplicate recipients', async () => {
		const first = user('01ARZ3NDEKTSV4RRFFQ69G5FAV');
		const second = user('01ARZ3NDEKTSV4RRFFQ69G5FAW');
		const runtime = service([first, second]);

		const result = await runtime.notifications.send(['01ARZ3NDEKTSV4RRFFQ69G5FAV', second, '01ARZ3NDEKTSV4RRFFQ69G5FAV'], notification());

		expect(runtime.identityModel.find).toHaveBeenCalledTimes(2);
		expect(result.map(delivery => delivery.userId)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FAW']);
		expect(runtime.inApp.send).toHaveBeenCalledTimes(2);
		expect(runtime.mail.send).toHaveBeenCalledTimes(2);
	});

	it('supports an empty audience and validates selected channel renderers', async () => {
		const runtime = service();
		const invalid: Notification<TestUser> = { type: 'notice', via: () => ['mail'] };

		expect(await runtime.notifications.send([], notification())).toEqual([]);
		await expect(runtime.notifications.send(user(), invalid)).rejects.toThrow('selected mail without a toMail() renderer');
		expect(runtime.mail.send).not.toHaveBeenCalled();
	});

	it('rejects an unresolved recipient before delivering the batch', async () => {
		const runtime = service();

		await expect(runtime.notifications.send(['01ARZ3NDEKTSV4RRFFQ69G5FAV', 'missing'], notification())).rejects.toThrow('recipient is unavailable');
		expect(runtime.inApp.send).not.toHaveBeenCalled();
		expect(runtime.mail.send).not.toHaveBeenCalled();
	});
});
