import type { MailMessage } from '../mail';
import type { EmailLogOptions } from './contracts';
import { redactLogEmail } from './redactLogEmail';

/** Formats a redacted log record without copying arbitrary nested payloads or exception properties into email. */
export function formatLogEmail(record: Record<string, unknown>, options: EmailLogOptions): MailMessage {
	const context = Object.fromEntries(Object.entries(record).filter(([key, value]) => key !== 'err' && (value === null || ['string', 'number', 'boolean'].includes(typeof value))));
	const sections = [`Log context (JSON):\n${JSON.stringify(context, null, 2)}`];
	let error = record.err;
	if (typeof error === 'string') sections.push(`Exception: ${error}`);
	for (let depth = 0; error && typeof error === 'object' && depth < 4; depth++) {
		const value = error as Record<string, unknown>;
		sections.push(`${depth ? 'Caused by' : 'Exception'}: ${String(value.type ?? value.name ?? 'Error')}\nMessage: ${String(value.message ?? 'Unavailable')}\nStack trace:\n${String(value.stack ?? 'Unavailable')}`);
		error = value.cause;
	}
	const text = redactLogEmail(sections.join('\n\n'));
	const subject = redactLogEmail(`${options.subjectPrefix ?? 'Application error'}: ${String(record.msg ?? 'Exception logged')}`).replace(/[\r\n]/g, ' ').slice(0, 200);
	return { to: options.to, subject, text, html: `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>` };
}

/** Escapes log text as inert HTML content in the email's preformatted body. */
function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
