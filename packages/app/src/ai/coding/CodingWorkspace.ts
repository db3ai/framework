/**
 * Outcome of one shell command run inside a coding workspace.
 */
export interface CodingCommandResult {
	/** Standard output, already bounded by the workspace. */
	stdout: string;
	/** Standard error, already bounded by the workspace. */
	stderr: string;
	/** Process exit code, or null when the process was killed or never started. */
	exitCode: number | null;
	/** True when the workspace stopped the command at its time limit. */
	timedOut: boolean;
}

/**
 * Where a coding agent's code lives: a runner container, a desktop folder or a test
 * directory. Paths arrive relative and validated; the implementation owns isolation.
 */
export interface CodingWorkspace {
	/** Runs one shell command from the workspace root. */
	run(command: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<CodingCommandResult>;

	/** Reads a UTF-8 text file, or null when it does not exist. */
	readFile(path: string): Promise<string | null>;

	/** Creates or replaces a UTF-8 text file, with its parent folders. */
	writeFile(path: string, content: string): Promise<void>;

	/** Removes a file. */
	deleteFile(path: string): Promise<void>;
}
