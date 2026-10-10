import type { ProcessSnapshot, ProjectDefinition } from '../../shared/contracts.js';
import { initials, isUp } from './presentation.js';

/** One entry in the project sidebar and switcher. */
export interface ProjectNavItem {
	id: string;
	label: string;
	initials: string;
	running: number;
	total: number;
	/** `ok` when everything runs, `bad` when something crashed, `off` otherwise. */
	health: 'ok' | 'bad' | 'off';
}

/**
 * Builds the project navigation, starting with "All projects".
 *
 * @param projects - Projects in order.
 * @param snapshots - Live process state by id.
 * @returns Navigation items.
 */
export function projectNav(projects: ProjectDefinition[], snapshots: Map<string, ProcessSnapshot>): ProjectNavItem[] {
	const items = projects.map(project => {
		const states = project.processes.map(process => snapshots.get(process.id));
		return item(project.id, project.name, initials(project.name), states);
	});
	const all = projects.flatMap(project => project.processes.map(process => snapshots.get(process.id)));
	return [item('all', 'All projects', '∗', all), ...items];
}

function item(id: string, label: string, badge: string, states: Array<ProcessSnapshot | undefined>): ProjectNavItem {
	const running = states.filter(isUp).length;
	const crashed = states.some(state => state?.status === 'crashed');
	return {
		id,
		label,
		initials: badge,
		running,
		total: states.length,
		health: crashed ? 'bad' : states.length && running === states.length ? 'ok' : 'off',
	};
}
