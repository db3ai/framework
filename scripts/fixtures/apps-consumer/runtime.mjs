import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { App } from '@db3.ai/app';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence } from '@db3.ai/app/scheduler';
import { UserIdentity } from '@db3.ai/app/auth';
import { InAppRecord } from '@db3.ai/app/in-app';

// Only generated disposable databases are managed by this fixture.
delete process.env.DATABASE_URL;
process.env.DB_CONNECTION = 'mariadb';
process.env.DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || '';
process.env.DB_TEST_DATABASE_PREFIX = 'db3_app_test';
const database = await createGeneratedTestDatabase('package');
let host;

/** Checks a separate Node process so removed package imports cannot survive in a module cache. */
function run(command, args) {
	const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, DB_DATABASE: database.databaseName }, timeout: 120_000 });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
}

try {
	host = new App({ db: database.db });
	await host.db.install(QueuedJob, FailedJob, ScheduledOccurrence, UserIdentity, InAppRecord);
	await UserIdentity.create({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Package reviewer', email: 'package@example.test' }).save();
	await host.apps.install('social');
	await host.apps.boot();
	const service = host.social;
	await service.save('01ARZ3NDEKTSV4RRFFQ69G5FAV', { title: 'Packaged app proof', url: 'https://example.test/discussion', notes: 'Retain through npm removal.' });
	assert.equal((await service.list('01ARZ3NDEKTSV4RRFFQ69G5FAV')).length, 1);
	const [owner, stranger] = await Promise.all([host.apps.navigation({ actor: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } }), host.apps.navigation({ actor: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAW' } })]);
	assert.deepEqual(owner.unavailable, []);
	assert.equal(owner.apps[0].badge.count, 1);
	assert.equal(stranger.apps[0].badge.count, 0);
	assert.equal((await host.scheduler.runDue(new Date('2026-01-01T10:00:00Z'))).dispatched, 1);
	await assert.rejects(host.apps.manage('uninstall', 'social'), /outstanding jobs/);
	await host.close();
	host = new App({ db: database.db });
	await host.apps.boot();
	assert.equal((await host.queue.workNextJob()).status, 'succeeded');
	assert.equal(await InAppRecord.where('userId', '01ARZ3NDEKTSV4RRFFQ69G5FAV').count(), 1);
	await host.close();
	host = new App({ db: database.db });
	await host.apps.uninstall('social');
	await host.close();
	run('npm', ['uninstall', '@db3.ai/social', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false']);
	run(process.execPath, ['removed.mjs']);
	run('npm', ['install', process.env.SOCIAL_TARBALL, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false']);
	run(process.execPath, ['restored.mjs']);
	console.log('installed -> removed -> restored; data preserved');
} finally { try { await host?.close(); } finally { await database.destroy(); } }
