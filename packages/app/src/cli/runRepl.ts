import { start } from 'node:repl';
import { inspect } from 'node:util';
import type { ReplOptions } from './contracts';

/**
 * Runs a Node terminal REPL until `.exit`, end-of-input or a stream failure.
 *
 * Expressions support top-level await and persistent variables. Context values
 * stay inside the REPL's VM rather than becoming process-wide globals. The
 * caller retains ownership of its application and closes it after this resolves.
 *
 * @param options - Context values, prompt and optional terminal streams.
 * @returns Resolves after the terminal session exits; rejects on stream errors.
 */
export async function runRepl(options: ReplOptions): Promise<void> {
	const input: NodeJS.ReadableStream = options.input ?? process.stdin;
	const output: NodeJS.WritableStream = options.output ?? process.stdout;
	const terminal = Boolean((output as NodeJS.WriteStream).isTTY);
	const session = start({
		prompt: options.prompt ?? 'db3> ', input, output, terminal,
		useGlobal: false, ignoreUndefined: true,
		/** Formats results without invoking arbitrary model or service getters. */
		writer: value => inspect(value, { colors: terminal, depth: 6, getters: false }),
	});
	/** Restores the app bindings when Node creates or clears the session context. */
	function installValues(): void {
		for (const [name, value] of Object.entries(options.values)) {
			Object.defineProperty(session.context, name, { value, configurable: true, enumerable: true, writable: true });
		}
	}
	try {
		installValues();
		session.on('reset', installValues);
		await new Promise<void>((resolve, reject) => {
			/** Releases stream listeners after normal exit or failure. */
			function cleanup(): void {
				input.off('error', fail);
				output.off('error', fail);
				session.off('error', fail);
				session.off('exit', finish);
			}
			/** Completes the session after Node has processed its exit command. */
			function finish(): void { cleanup(); resolve(); }
			/** Preserves the original stream failure while releasing the REPL. */
			function fail(error: Error): void { cleanup(); session.close(); reject(error); }
			input.once('error', fail);
			output.once('error', fail);
			session.once('error', fail);
			session.once('exit', finish);
		});
	} finally {
		session.off('reset', installValues);
		session.close();
	}
}
