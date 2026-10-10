/** CSI and OSC escape sequences, charset selections and carriage returns. */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\r/g;

/**
 * Removes terminal escape sequences, leaving the visible text. Used to read
 * announcements such as `Local: http://localhost:5173/` out of raw output;
 * the terminal emulator interprets the escapes itself.
 *
 * @param text - Raw output.
 * @returns Plain text.
 */
export function stripAnsi(text: string): string {
	return text.replace(ESCAPES, '');
}
