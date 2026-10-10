import { stripAnsi } from './ansi.js';

/**
 * Finds the first local listening port announced in a line of output,
 * such as `Local: http://localhost:5173/` or `listening on 127.0.0.1:4000`.
 *
 * @param line - Raw output line.
 * @returns The port, or `null` when none is announced.
 */
export function detectPort(line: string): number | null {
	const text = stripAnsi(line);
	const match = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::)(\d{2,5})\b/i.exec(text)
		?? /\b(?:listening|running|ready|started|serving)\b[^\n]*?\bport\s+(\d{2,5})\b/i.exec(text);
	if (!match) return null;
	const port = Number(match[1]);
	return port > 0 && port < 65536 ? port : null;
}
