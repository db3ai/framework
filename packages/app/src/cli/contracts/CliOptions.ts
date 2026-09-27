/** Process adapters shared by direct CLI execution and embedded command runners. */
export interface CliOptions {
	/** Application root. Defaults to the current working directory. */
	directory?: string;
	/** Interactive input used by `db3 repl`. Defaults to process.stdin. */
	input?: NodeJS.ReadableStream;
	/** Interactive output used by `db3 repl`. Defaults to process.stdout. */
	output?: NodeJS.WritableStream;
	/** Standard output adapter. Defaults to console.log. */
	write?: (message: string) => void;
	/** Error output adapter. Defaults to console.error. */
	writeError?: (message: string) => void;
}
