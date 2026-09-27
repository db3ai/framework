import { createJob } from '../createJob';
import type { CreateJobOptions, CreatedJob } from '../contracts/CreateJob';

/**
 * Creates an app-owned job through the shared source-generation operation.
 * @param options - Application directory and validated job class name.
 * @returns Created file and source, usable by terminal and editor callers alike.
 */
export default async function makeJob(options: CreateJobOptions): Promise<CreatedJob> {
	return createJob(options);
}
