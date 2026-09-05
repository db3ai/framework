import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthProvider, AuthToken, PasswordResetToken, UserIdentity } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { MediaFile, MediaItem, MediaLibrary } from '@db3.ai/app/media';
import { App } from '@db3.ai/app/server';
import { createPrivateFileServer } from './createPrivateFileServer';

/** Runs authorized upload/download/deletion against real Auth, SQL and storage. */
export async function runPrivateFiles() {
	const root = await mkdtemp(join(tmpdir(), 'db3-private-files-'));
	try {
		const database = await createGeneratedTestDatabase('private_files');
		const application = new App({ db: database.db, config: { auth: { providers: { password: true } } }, storage: { disks: { local: { driver: 'local', root } } } });
		const server = createPrivateFileServer(application);
		try {
			await application.db.install(UserIdentity, AuthProvider, AuthToken, PasswordResetToken, MediaLibrary, MediaFile, MediaItem);
			const ada = await application.auth.registerWithPassword({ name: 'Ada', email: 'ada@example.test', password: 'example-password-123' });
			const grace = await application.auth.registerWithPassword({ name: 'Grace', email: 'grace@example.test', password: 'example-password-456' });
			const headers = { authorization: `Bearer ${ada.token}`, 'content-type': 'text/plain' };
			const other = { authorization: `Bearer ${grace.token}` };
			const unsigned = await server.inject({ method: 'POST', url: '/files', headers: { 'content-type': 'text/plain' }, payload: 'Hidden' });
			const upload = await server.inject({ method: 'POST', url: '/files', headers, payload: 'Private client brief' });
			if (upload.statusCode !== 201) throw new Error(`Upload failed: ${upload.statusCode}`);
			const id = upload.json<{ id: string }>().id;
			const file = await MediaFile.where('id', id).firstOrFail();
			const path = file.path!;
			const download = await server.inject({ url: `/files/${id}`, headers });
			const stranger = await server.inject({ url: `/files/${id}`, headers: other });
			const strangerDelete = await server.inject({ method: 'DELETE', url: `/files/${id}`, headers: other });
			const empty = await server.inject({ method: 'POST', url: '/files', headers, payload: '  ' });
			const wrongType = await server.inject({ method: 'POST', url: '/files', headers: { ...headers, 'content-type': 'application/json' }, payload: { owner: grace.user.id } });
			const oversized = await server.inject({ method: 'POST', url: '/files', headers, payload: 'x'.repeat(64 * 1024 + 1) });
			const failedWritesAbsent = await MediaFile.query().count() === 1;
			const deleted = await server.inject({ method: 'DELETE', url: `/files/${id}`, headers });
			const missing = await server.inject({ url: `/files/${id}`, headers });
			const retry = await server.inject({ method: 'POST', url: '/files', headers, payload: 'Revised brief' });
			return { uploaded: upload.statusCode, text: download.body, unsigned: unsigned.statusCode, stranger: stranger.statusCode, strangerDelete: strangerDelete.statusCode, empty: empty.statusCode, wrongType: wrongType.statusCode, oversized: oversized.statusCode, failedWritesAbsent, privateHeaders: download.headers['cache-control'] === 'private, no-store' && download.headers['x-content-type-options'] === 'nosniff', deleted: deleted.statusCode, bytesRemoved: await application.storage.missing(path), missing: missing.statusCode, retry: retry.statusCode };
		} finally { try { await server.close(); } finally { try { await application.close(); } finally { await database.destroy(); } } }
	} finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runPrivateFiles(), null, 2));
