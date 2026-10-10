/** Terminal colour for each queue state verb at the start of a `[queue]` message. */
const STATES: Array<[RegExp, string]> = [
	[/^(Claimed|Running|Dispatched)\b/, '34'],
	[/^(Processed|Retried)\b/, '32'],
	[/^(Released|Deferred)\b/, '33'],
	[/^(Failed|Lost lease|Stopped fenced)\b/, '31'],
];

/** A job label such as `CollectKeywordRanksJob#5249`. */
const JOB_LABEL = /\b[A-Z][A-Za-z0-9_]*#\d+\b/g;

/**
 * Colours the parts of a queue log message that are scanned most: the state
 * verb after `[queue] ` (blue in progress, green done, yellow retrying, red
 * failed) and job labels (bold magenta). Other messages are returned unchanged
 * apart from job labels.
 *
 * @param message - Plain log message.
 * @param paint - Wraps text in an SGR code, such as `'32'` or `'1;35'`.
 * @returns The message with colour codes.
 */
export function highlightQueueMessage(message: string, paint: (text: string, code: string) => string): string {
	let prefix = '';
	let rest = message;
	if (rest.startsWith('[queue] ')) {
		prefix = '[queue] ';
		rest = rest.slice(prefix.length);
		for (const [pattern, code] of STATES) {
			const match = pattern.exec(rest);
			if (match) {
				prefix += paint(match[0], code);
				rest = rest.slice(match[0].length);
				break;
			}
		}
	}
	return prefix + rest.replace(JOB_LABEL, label => paint(label, '1;35'));
}
