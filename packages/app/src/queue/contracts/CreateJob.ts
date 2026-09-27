/** Application location and class name for a convention-based job scaffold. */
export interface CreateJobOptions {
	/** Absolute or working-directory-relative application root. */
	appDirectory: string;
	/** PascalCase TypeScript class name ending in Job. */
	name: string;
}

/** Created application file and its source, suitable for opening in an editor. */
export interface CreatedJob {
	path: string;
	source: string;
}
