import knex from 'knex';
import { App } from '@db3.ai/app/server';

/** Executes a real isolated worker write and publishes only its committed inbox invalidation. */
async function main(): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const input = JSON.parse(Buffer.concat(chunks).toString());
	const db = knex(input.database);
	const application = new App({ db, webSockets: { publish: input.publish }, inApp: {
		onChanged: async userId => { await application.webSockets.channel(`user:${userId}:notifications`).publish('changed', {}); },
		onDeliveryError: error => { process.stderr.write(String(error)); process.exitCode = 1; },
	} });
	try {
		await application.inApp.send(input.userId, { title: 'Worker complete', body: 'Saved in another process.' }, { scope: { type: 'account' }, type: 'worker.completed' });
	} finally { await application.close(); await db.destroy(); }
}
void main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
