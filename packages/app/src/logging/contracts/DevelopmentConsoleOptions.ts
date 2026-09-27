import type { Writable } from 'node:stream';

/** Terminal capabilities for the one renderer that owns a development output stream. */
export interface DevelopmentConsoleOptions {
	/** Output destination; defaults to process.stdout. The caller retains stream ownership. */
	output?: Writable & { isTTY?: boolean; columns?: number; rows?: number };
	/** Enable pending-row redraws. Defaults to the output's terminal capability. */
	interactive?: boolean;
	/** Enable structural ANSI colours. Defaults to terminal support, respecting NO_COLOR. */
	color?: boolean;
	/** Coordinate console.log/warn and direct stdout/stderr writes in this process. Defaults to true for interactive stdout. */
	coordinateStdio?: boolean;
}
