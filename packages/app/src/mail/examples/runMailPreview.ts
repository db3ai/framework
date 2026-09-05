import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileMailTransport, Mail } from '@db3.ai/app/mail';
import { welcomeMessage } from './welcomeMessage';

/**
 * Writes, reads and removes a local welcome-email preview without sending email.
 *
 * @returns Selected message contents and the observed validation/recovery outcome.
 */
export async function runMailPreview() {
	const directory = await mkdtemp(join(tmpdir(), 'db3-mail-guide-'));
	try {
		const mail = new Mail({ from: 'Notes <hello@example.test>', transport: new FileMailTransport({ directory }) });
		let rejectedEmptyRecipients = false;
		try {
			await mail.send({ to: [], subject: 'Invalid', text: 'This should not be written.' });
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Mail requires at least one recipient.') throw error;
			rejectedEmptyRecipients = true;
		}
		const delivery = await mail.send(welcomeMessage('ada@example.test', 'Ada & team'));
		if (!delivery.path) throw new Error('The file transport did not return a preview path.');
		const preview = JSON.parse(await readFile(delivery.path, 'utf8'));
		return {
			transport: delivery.transport,
			accepted: delivery.accepted,
			rejectedEmptyRecipients,
			files: (await readdir(directory)).length,
			from: preview.from,
			subject: preview.subject,
			text: preview.text,
			html: preview.html,
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runMailPreview(), null, 2));
}
