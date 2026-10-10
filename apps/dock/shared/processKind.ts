import type { ProcessKind } from './contracts.js';

/**
 * Classifies an npm script by its name and body.
 *
 * db3 apps conventionally use `api`, `dev`/`web`, `queue` and `scheduler`
 * scripts; the body is checked as a fallback for renamed scripts.
 *
 * @param scriptName - The package.json script key.
 * @param body - The script's command text.
 * @returns The process kind.
 */
export function processKind(scriptName: string, body = ''): ProcessKind {
	const name = scriptName.toLowerCase();
	const text = body.toLowerCase();
	if (/(^|[:\-_])(queue|worker|jobs?)($|[:\-_])/.test(name) || /queue(:work|\.ts|\.js)|queue:work/.test(text)) return 'queue';
	if (/(^|[:\-_])(scheduler|cron|schedule)($|[:\-_])/.test(name) || /scheduler(:work|\.ts|\.js)/.test(text)) return 'scheduler';
	if (/(^|[:\-_])(api|server|backend)($|[:\-_])/.test(name)) return 'api';
	if (/(^|[:\-_])(dev|web|client|frontend|start|serve|preview)($|[:\-_])/.test(name) || /\bvite\b|\bnuxt\b|\bnext\b/.test(text)) return 'web';
	return 'script';
}

/** Script names Dock adds automatically when a project is first added. */
export const DEFAULT_SCRIPT_NAMES = ['api', 'dev', 'web', 'queue', 'worker', 'scheduler'];
