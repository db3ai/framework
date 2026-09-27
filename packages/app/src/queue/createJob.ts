import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CreateJobOptions, CreatedJob } from './contracts/CreateJob';

/**
 * Generates the source for an application-owned job using framework conventions.
 *
 * CLI and editor integrations can preview the same template before writing it.
 * @param name - PascalCase class name ending in Job.
 * @returns TypeScript source with payload validation and an explicit unfinished handler.
 */
export function jobTemplate(name: string): string {
	if (!/^[A-Z][A-Za-z0-9]*Job$/.test(name)) throw new Error('Use a PascalCase class name ending in Job, such as GenerateReportJob.');
	return `import { QueueableJob } from '@db3.ai/app/queue';

/** Data persisted with each ${name} dispatch. */
export interface ${name}Data extends Record<string, unknown> {
	message: string;
}

/** Application job restored by queue workers from its persisted data. */
export class ${name} extends QueueableJob<${name}Data> {
	static jobName = '${name}';

	/** Validates payloads supplied by both callers and persisted queue records. */
	constructor(data: ${name}Data) {
		if (!data || typeof data.message !== 'string' || !data.message.trim()) throw new Error('${name} requires a message.');
		super(data);
	}

	/** Performs this job's work; keep external side effects safe to retry. */
	async handle(): Promise<void> {
		throw new Error('Implement ${name}.handle() before dispatching this job.');
	}
}
`;
}

/**
 * Creates a job in server/jobs without replacing an existing application file.
 *
 * @param options - Application root and validated class name.
 * @returns Created path and source for a CLI, Studio or editor integration.
 * @example
 * await createJob({ appDirectory: process.cwd(), name: 'GenerateReportJob' });
 */
export async function createJob(options: CreateJobOptions): Promise<CreatedJob> {
	const source = jobTemplate(options.name);
	const directory = resolve(options.appDirectory, 'server/jobs');
	const path = join(directory, `${options.name}.ts`);
	await mkdir(directory, { recursive: true });
	await writeFile(path, source, { encoding: 'utf8', flag: 'wx' });
	return { path, source };
}
