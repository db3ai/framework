import { applyDiff, applyPatchTool, shellTool, tool, type ApplyPatchOperation, type Editor, type Shell, type ShellAction, type ShellResult } from '@openai/agents';
import { z } from 'zod';
import type { AgentTool } from '../contracts/Agent';
import type { CodingWorkspace } from './CodingWorkspace';

/** Options shared by the coding tools of one agent. */
export interface CodingToolOptions {
	/** Time limit for a command when the model does not ask for one. Defaults to two minutes. */
	defaultTimeoutMs?: number;
	/** Upper bound for any command's time limit. Defaults to ten minutes. */
	maxTimeoutMs?: number;
	/** Characters kept from each command's stdout and stderr. Defaults to 20,000. */
	maxOutputLength?: number;
	/** Returns the active run's signal so Stop also ends a running command. */
	signal?: () => AbortSignal | undefined;
}

/** One step of the agent's visible plan. */
const planStep = z.object({
	step: z.string().min(1).max(500),
	status: z.enum(['pending', 'in_progress', 'completed']),
});

/**
 * The tools coding models are trained on: the Responses API's native `shell` and
 * `apply_patch`, and Codex's `update_plan`, all working through `workspace`.
 */
export function codingTools(workspace: CodingWorkspace, options: CodingToolOptions = {}): AgentTool[] {
	return [
		Object.assign(shellTool({ shell: codingShell(workspace, options) }), { title: 'Run command', description: 'Run shell commands in the workspace.' }),
		Object.assign(applyPatchTool({ editor: codingEditor(workspace) }), { title: 'Edit files', description: 'Create, change, move or delete files in the workspace.' }),
		Object.assign(tool({
			name: 'update_plan',
			description: 'Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.',
			parameters: z.object({
				explanation: z.string().max(2_000).nullable().describe('Optional explanation for this plan update.'),
				plan: z.array(planStep).max(50).describe('The list of steps.'),
			}),
			/** The plan is shown from the call itself; the model only needs an acknowledgement. */
			execute: async () => 'Plan updated',
		}), { title: 'Update plan', description: 'Show the steps of the current task.' }),
	];
}

/**
 * Runs each command of a `shell` call in order, bounding time and output.
 *
 * @param workspace - Where commands run.
 * @param options - Time and output limits.
 * @returns SDK shell implementation.
 */
function codingShell(workspace: CodingWorkspace, options: CodingToolOptions): Shell {
	const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
	const maxTimeoutMs = options.maxTimeoutMs ?? 600_000;
	const maxOutputLength = options.maxOutputLength ?? 20_000;
	return {
		/** Stops at the first command that cannot finish, as a terminal would for `&&`. */
		async run(action: ShellAction): Promise<ShellResult> {
			const timeoutMs = Math.min(Math.max(action.timeoutMs ?? defaultTimeoutMs, 1_000), maxTimeoutMs);
			const limit = Math.min(action.maxOutputLength ?? maxOutputLength, maxOutputLength);
			const output: ShellResult['output'] = [];
			for (const command of action.commands) {
				const signal = options.signal?.();
				signal?.throwIfAborted();
				const result = await workspace.run(command, { timeoutMs, signal });
				output.push({
					stdout: boundOutput(result.stdout, limit),
					stderr: boundOutput(result.stderr, limit),
					outcome: result.timedOut ? { type: 'timeout' } : { type: 'exit', exitCode: result.exitCode },
				});
				if (result.timedOut) break;
			}
			return { output, maxOutputLength: limit };
		},
	};
}

/**
 * Applies `apply_patch` operations through the workspace's file methods.
 *
 * @param workspace - Where files change.
 * @returns SDK editor implementation.
 */
function codingEditor(workspace: CodingWorkspace): Editor {
	return {
		/** Creates a file whose diff contains only added lines. */
		async createFile(operation) {
			const path = workspacePath(operation.path);
			if (await workspace.readFile(path) !== null) throw new Error(`${path} already exists.`);
			await workspace.writeFile(path, applyDiff('', operation.diff, 'create'));
			return { status: 'completed', output: `Created ${path}` };
		},
		/** Applies a diff to an existing file, optionally moving it. */
		async updateFile(operation) {
			const path = workspacePath(operation.path);
			const current = await workspace.readFile(path);
			if (current === null) throw new Error(`${path} does not exist.`);
			const next = applyDiff(current, operation.diff);
			const destination = operation.moveTo ? workspacePath(operation.moveTo) : path;
			await workspace.writeFile(destination, next);
			if (destination !== path) await workspace.deleteFile(path);
			return { status: 'completed', output: destination === path ? `Updated ${path}` : `Moved ${path} to ${destination}` };
		},
		/** Deletes an existing file. */
		async deleteFile(operation: Extract<ApplyPatchOperation, { type: 'delete_file' }>) {
			const path = workspacePath(operation.path);
			if (await workspace.readFile(path) === null) throw new Error(`${path} does not exist.`);
			await workspace.deleteFile(path);
			return { status: 'completed', output: `Deleted ${path}` };
		},
	};
}

/**
 * Validates a model-chosen path as a plain path inside the workspace.
 *
 * @param value - Path from the model.
 * @returns Normalized relative path.
 */
export function workspacePath(value: string): string {
	const path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
	const parts = path.split('/');
	if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || parts.some(part => part === '..' || part === '') || path.includes('\0')) {
		throw new Error(`Use a relative path inside the workspace: ${value}`);
	}
	return path;
}

/**
 * Keeps the start and end of long output, which is where errors usually are.
 *
 * @param text - Command output.
 * @param limit - Characters to keep.
 * @returns Bounded output.
 */
function boundOutput(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.slice(0, half)}\n… ${text.length - limit} characters omitted …\n${text.slice(-half)}`;
}
