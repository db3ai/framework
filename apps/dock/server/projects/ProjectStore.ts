import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import type { AddProcessRequest, ProcessDefinition, ProjectDefinition } from '../../shared/contracts.js';
import { consoleArgs } from '../../shared/consoleArgs.js';
import { DEFAULT_SCRIPT_NAMES, processKind } from '../../shared/processKind.js';
import { readPackageScripts } from './readPackageScripts.js';

interface StoredConfig {
	version: 1;
	projects: Array<Omit<ProjectDefinition, 'processes'> & { processes: Array<Omit<ProcessDefinition, 'saved'>> }>;
}

/** Raised for requests that name an unknown project or process, or an invalid folder. */
export class DockRequestError extends Error {
	constructor(message: string, readonly statusCode = 400) {
		super(message);
		this.name = 'DockRequestError';
	}
}

/**
 * Owns the list of projects and their process definitions.
 *
 * Saved definitions persist to a JSON file (by default `~/.db3-dock/projects.json`).
 * Definitions added with `save: false` live in memory until Dock exits.
 */
export class ProjectStore {
	private projects: ProjectDefinition[] = [];

	/**
	 * @param file - JSON config path.
	 */
	constructor(private readonly file: string) {}

	/** Loads the config file; a missing file means no projects. */
	async load(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(this.file, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				this.projects = [];
				return;
			}
			throw error;
		}
		const config = JSON.parse(raw) as StoredConfig;
		this.projects = (config.projects ?? []).map(project => ({
			...project,
			processes: (project.processes ?? []).map(process => ({ ...process, args: process.args ?? [], saved: true })),
		}));
	}

	/** All projects in display order. */
	list(): ProjectDefinition[] {
		return this.projects.map(project => ({ ...project, processes: [...project.processes] }));
	}

	/**
	 * @param id - Project id.
	 * @returns The project.
	 * @throws DockRequestError when unknown.
	 */
	get(id: string): ProjectDefinition {
		const project = this.projects.find(item => item.id === id);
		if (!project) throw new DockRequestError(`Unknown project "${id}".`, 404);
		return project;
	}

	/**
	 * Finds the project that owns a process.
	 *
	 * @param processId - Process id.
	 * @returns Project and process.
	 * @throws DockRequestError when unknown.
	 */
	findProcess(processId: string): { project: ProjectDefinition; process: ProcessDefinition } {
		for (const project of this.projects) {
			const process = project.processes.find(item => item.id === processId);
			if (process) return { project, process };
		}
		throw new DockRequestError(`Unknown process "${processId}".`, 404);
	}

	/**
	 * Adds a project folder with its conventional db3 scripts (`api`, `dev`, `web`,
	 * `queue`, `worker`, `scheduler`) as initial processes.
	 *
	 * @param folder - Path to a folder containing package.json; `~` is expanded.
	 * @param name - Optional display name; defaults to the folder name.
	 * @returns The new or existing project for that folder.
	 */
	async addProject(folder: string, name?: string): Promise<ProjectDefinition> {
		const path = resolve(expandHome(folder.trim()));
		const existing = this.projects.find(project => project.path === path);
		if (existing) return existing;
		try {
			if (!(await stat(path)).isDirectory()) throw new Error();
		} catch {
			throw new DockRequestError(`"${folder}" is not a folder.`);
		}
		let info;
		try {
			info = await readPackageScripts(path);
		} catch {
			throw new DockRequestError(`No readable package.json in "${folder}".`);
		}
		const projectName = name?.trim() || basename(path);
		const project: ProjectDefinition = { id: uniqueId(projectName), name: projectName, path, processes: [] };
		for (const scriptName of DEFAULT_SCRIPT_NAMES) {
			const script = info.scripts.find(item => item.name === scriptName);
			if (!script) continue;
			const args = script.kind === 'queue'
				? consoleArgs(script.body, ['queue:work'])
				: script.kind === 'scheduler' ? consoleArgs(script.body, ['scheduler:work']) : [];
			project.processes.push({ id: uniqueId(`${projectName}-${script.name}`), name: script.name, script: script.name, args, kind: script.kind, saved: true });
		}
		this.projects.push(project);
		await this.save();
		return project;
	}

	/**
	 * Removes a project and its definitions.
	 *
	 * @param id - Project id.
	 * @returns The removed project.
	 */
	async removeProject(id: string): Promise<ProjectDefinition> {
		const project = this.get(id);
		this.projects = this.projects.filter(item => item !== project);
		await this.save();
		return project;
	}

	/**
	 * Adds one or more identical processes to a project.
	 *
	 * @param projectId - Project id.
	 * @param request - Script, args, name and count.
	 * @returns The new definitions.
	 */
	async addProcesses(projectId: string, request: AddProcessRequest): Promise<ProcessDefinition[]> {
		const project = this.get(projectId);
		const script = String(request.script ?? '').trim();
		if (!script) throw new DockRequestError('A script is required.');
		const count = Math.min(16, Math.max(1, Math.floor(Number(request.count) || 1)));
		const args = Array.isArray(request.args) ? request.args.map(String) : [];
		const baseName = String(request.name ?? '').trim() || script;
		const kind = request.kind ?? processKind(script);
		const added: ProcessDefinition[] = [];
		for (let index = 0; index < count; index++) {
			const name = count > 1 ? `${baseName} #${index + 1}` : baseName;
			added.push({ id: uniqueId(`${project.name}-${name}`), name, script, args, kind, saved: !!request.save });
		}
		project.processes.push(...added);
		if (request.save) await this.save();
		return added;
	}

	/**
	 * Adds a session-only definition for a job found running outside Dock when the
	 * project has no idle definition for that script (for example a second worker).
	 *
	 * @param projectId - Project id.
	 * @param script - npm script the job runs.
	 * @returns The new definition.
	 */
	addDiscovered(projectId: string, script: string): ProcessDefinition {
		const project = this.get(projectId);
		const definition: ProcessDefinition = {
			id: uniqueId(`${project.name}-${script}`),
			name: script,
			script,
			args: [],
			kind: processKind(script),
			saved: false,
			discovered: true,
		};
		project.processes.push(definition);
		return definition;
	}

	/**
	 * Removes a process definition.
	 *
	 * @param processId - Process id.
	 */
	async removeProcess(processId: string): Promise<void> {
		const { project, process } = this.findProcess(processId);
		project.processes = project.processes.filter(item => item !== process);
		if (process.saved) await this.save();
	}

	private async save(): Promise<void> {
		const config: StoredConfig = {
			version: 1,
			projects: this.projects.map(project => ({
				id: project.id,
				name: project.name,
				path: project.path,
				processes: project.processes.filter(process => process.saved).map(({ saved: _saved, ...process }) => process),
			})),
		};
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(config, null, '\t')}\n`);
		await rename(temporary, this.file);
	}
}

function expandHome(path: string): string {
	if (path === '~' || path.startsWith('~/')) return `${process.env.HOME ?? ''}${path.slice(1)}`;
	return path;
}

function uniqueId(label: string): string {
	const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
	return `${slug}-${randomUUID().slice(0, 6)}`;
}
