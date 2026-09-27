import knex from 'knex';
import { App } from '@db3.ai/app/server';
import { SummarizeBoardJob } from '../../examples/board/SummarizeBoardJob';

/** Restores and executes the documented job in an independent worker process. */
async function main(): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const input = JSON.parse(Buffer.concat(chunks).toString());
	const db = knex(input.database);
	const application = new App({ db, queue: { driver: 'database', queueMonitor: false }, webSockets: { publish: input.publish } });
	try {
		application.queue.registerJob(SummarizeBoardJob);
		const result = await application.queue.workNextJob('boards');
		if (result?.status !== 'succeeded') throw new Error(`Unexpected worker status: ${result?.status}`);
	} finally { await application.close(); await db.destroy(); }
}
void main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
