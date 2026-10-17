import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AddHostRequest, HostDefinition } from '../../shared/hostContracts.js';
import { DockRequestError } from '../projects/ProjectStore.js';

interface StoredHosts {
	version: 1;
	hosts: HostDefinition[];
}

/**
 * Owns the list of Docker hosts, saved to a JSON file (by default
 * `~/.db3-dock/hosts.json`). The file can be edited by hand for settings the UI
 * does not offer, such as `publicNetworks` or explicit `apps` groups.
 */
export class HostStore {
	private hosts: HostDefinition[] = [];

	/**
	 * @param file - JSON config path.
	 */
	constructor(private readonly file: string) {}

	/** Loads the config file; a missing file means no hosts. */
	async load(): Promise<void> {
		try {
			const config = JSON.parse(await readFile(this.file, 'utf8')) as StoredHosts;
			this.hosts = (config.hosts ?? []).filter(host => host?.id && host.name);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			this.hosts = [];
		}
	}

	/** Hosts in display order. */
	list(): HostDefinition[] {
		return this.hosts.map(host => ({ ...host }));
	}

	/**
	 * @param id - Host id.
	 * @returns The host.
	 * @throws DockRequestError when unknown.
	 */
	get(id: string): HostDefinition {
		const host = this.hosts.find(item => item.id === id);
		if (!host) throw new DockRequestError(`Unknown server "${id}".`, 404);
		return host;
	}

	/**
	 * Adds a host.
	 *
	 * @param request - Name and SSH destination (empty for this machine).
	 * @returns The saved host.
	 */
	async add(request: AddHostRequest): Promise<HostDefinition> {
		const name = request.name?.trim() || request.ssh?.trim().replace(/^.*@/, '') || 'This machine';
		const ssh = request.ssh?.trim() || undefined;
		if (ssh && !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(ssh)) throw new DockRequestError('Use an SSH destination such as steve@mac-server or a ~/.ssh/config alias.');
		const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
		let id = base;
		for (let suffix = 2; this.hosts.some(host => host.id === id); suffix++) id = `${base}-${suffix}`;
		const host: HostDefinition = { id, name, ...(ssh ? { ssh } : {}) };
		this.hosts.push(host);
		await this.save();
		return host;
	}

	/**
	 * @param id - Host id.
	 */
	async remove(id: string): Promise<void> {
		this.get(id);
		this.hosts = this.hosts.filter(host => host.id !== id);
		await this.save();
	}

	private async save(): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify({ version: 1, hosts: this.hosts } satisfies StoredHosts, null, '\t')}\n`);
		await rename(temporary, this.file);
	}
}
