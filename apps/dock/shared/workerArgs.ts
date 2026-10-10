/**
 * How a db3 queue worker chooses which queues to claim.
 * Mirrors the `queue:work` console flags in `@db3.ai/app/queue`.
 */
export type WorkerSelection =
	| { mode: 'queues'; queues: string[] }
	| { mode: 'all'; exclude: string[] }
	| { mode: 'pool'; pool: string };

/** Optional tuning flags for a queue worker. */
export interface WorkerTuning {
	/** Polling interval in milliseconds. */
	interval?: number;
	/** Jobs processed per worker tick (not concurrency). */
	maxJobs?: number;
	/** Process title. */
	name?: string;
}

/**
 * Builds the arguments passed after `npm run queue --` for a worker.
 *
 * @param selection - Queues, all-except or a named pool.
 * @param tuning - Optional interval, max jobs and process title.
 * @returns Argument list starting with `queue:work`.
 */
export function workerArgs(selection: WorkerSelection, tuning: WorkerTuning = {}): string[] {
	const args = ['queue:work'];
	if (selection.mode === 'pool') {
		args.push(`--pool=${selection.pool}`);
	} else if (selection.mode === 'all') {
		args.push('--queues=*');
		const exclude = unique(selection.exclude);
		if (exclude.length) args.push(`--exclude-queues=${exclude.join(',')}`);
	} else {
		const queues = unique(selection.queues);
		args.push(queues.length ? `--queues=${queues.join(',')}` : '--queue=default');
	}
	if (tuning.interval && tuning.interval > 0) args.push(`--interval=${Math.round(tuning.interval)}`);
	if (tuning.maxJobs && tuning.maxJobs > 0) args.push(`--max-jobs=${Math.round(tuning.maxJobs)}`);
	if (tuning.name) args.push(`--name=${tuning.name}`);
	return args;
}

/**
 * Suggests a short display label for a worker selection, such as `emails, reports`.
 *
 * @param selection - The worker selection.
 * @returns Human-readable label.
 */
export function workerLabel(selection: WorkerSelection): string {
	if (selection.mode === 'pool') return `pool ${selection.pool}`;
	if (selection.mode === 'all') return selection.exclude.length ? `all except ${unique(selection.exclude).join(', ')}` : 'all queues';
	const queues = unique(selection.queues);
	return queues.length ? queues.join(', ') : 'default';
}

/**
 * Suggests a process title for a worker, safe for `--name`.
 *
 * @param projectName - Project display name.
 * @param selection - The worker selection.
 * @returns Lower-case slug such as `db3-ai-queue-emails-reports`.
 */
export function workerProcessName(projectName: string, selection: WorkerSelection): string {
	const suffix = selection.mode === 'pool'
		? selection.pool
		: selection.mode === 'all'
			? 'all'
			: unique(selection.queues).join('-') || 'default';
	return slug(`${projectName}-queue-${suffix}`);
}

/**
 * Quotes arguments for display as a shell command.
 *
 * @param script - npm script name.
 * @param args - Arguments after `--`.
 * @returns Command text such as `npm run queue -- queue:work --queues='*'`.
 */
export function displayCommand(script: string, args: string[]): string {
	const quoted = args.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`));
	return ['npm', 'run', script, ...(quoted.length ? ['--', ...quoted] : [])].join(' ');
}

function unique(names: string[]): string[] {
	return [...new Set(names.map(name => name.trim()).filter(Boolean))];
}

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
