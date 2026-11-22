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
 * The only operations a coding agent needs from the place its code lives.
 *
 * A workspace can be a container on a remote runner, a folder on a desktop or a
 * temporary test directory. Paths are always relative to the workspace root and
 * are validated by the framework before any method receives them. The
 * implementation owns isolation: the agent never chooses a host path, a user or
 * network access.
 */
export interface CodingWorkspace {
	/**
	 * Runs one shell command from the workspace root.
	 *
	 * @param command - Shell command text chosen by the model.
	 * @param options - Time limit and cancellation for this command.
	 * @returns Bounded output and exit status.
	 */
	run(command: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<CodingCommandResult>;

	/**
	 * Reads a UTF-8 text file.
	 *
	 * @param path - Validated relative path.
	 * @returns File content, or null when the file does not exist.
	 */
	readFile(path: string): Promise<string | null>;

	/**
	 * Creates or replaces a UTF-8 text file, creating parent directories.
	 *
	 * @param path - Validated relative path.
	 * @param content - Complete new file content.
	 */
	writeFile(path: string, content: string): Promise<void>;

	/**
	 * Removes a file.
	 *
	 * @param path - Validated relative path.
	 */
	deleteFile(path: string): Promise<void>;
}
