/** Redacts common credential forms while preserving exception wording and stack locations. */
export function redactLogEmail(text: string): string {
	return text
		.replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi, '[REDACTED authorization]')
		.replace(/\b(?:sk-|sk_|rk_|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[REDACTED key]')
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED token]')
		.replace(/(["']?(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|token|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
		.replace(/((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, url => url
			.replace(/(\/\/)[^/@\s]+@/, '$1[REDACTED]@')
			.replace(/[?#].*$/, '?[REDACTED parameters]'));
}
