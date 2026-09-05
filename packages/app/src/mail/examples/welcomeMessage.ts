import type { MailMessage } from '@db3.ai/app/mail';
import { isEmail } from '@db3.ai/app/validation';

/**
 * Builds an application-owned welcome message with safe plain text and HTML.
 *
 * @param email - Recipient selected by the application, not an arbitrary send API.
 * @param name - Display name rendered as text, never trusted HTML.
 * @returns Message ready for any supported mail transport.
 */
export function welcomeMessage(email: string, name: string): MailMessage {
	if (!isEmail(email)) throw new Error('A valid recipient email is required.');
	const displayName = name.trim();
	if (!displayName || displayName.length > 80 || /[\r\n]/.test(displayName)) throw new Error('Name must be 1–80 characters without line breaks.');
	return {
		to: { email, name: displayName },
		subject: 'Welcome to your notes',
		text: `Hello ${displayName}, your notebook is ready.`,
		html: `<p>Hello ${escapeHtml(displayName)}, your notebook is ready.</p>`,
	};
}

/** Escapes user-controlled text for an HTML text node, not a URL or script. */
function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
