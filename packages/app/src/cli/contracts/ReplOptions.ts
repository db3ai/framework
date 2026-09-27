/** Terminal REPL context and streams, reusable by application development tools. */
export interface ReplOptions {
	/** Named values available to expressions; installed again after `.clear`. */
	values: Readonly<Record<string, unknown>>;
	/** Prompt shown before each expression. Defaults to `db3> `. */
	prompt?: string;
	/** Input stream. Defaults to the current process's standard input. */
	input?: NodeJS.ReadableStream;
	/** Output stream. Defaults to the current process's standard output. */
	output?: NodeJS.WritableStream;
}
