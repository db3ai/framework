import type { ProjectDefinition } from '../../shared/contracts.js';

/**
 * Narrows projects to the selected one and to processes matching a search.
 *
 * @param projects - All projects.
 * @param projectId - Selected project id, or `all`.
 * @param query - Case-insensitive text matched against project, process, script and args.
 * @returns Projects to show; with a query, projects with no matching process are dropped.
 */
export function filterProjects(projects: ProjectDefinition[], projectId: string, query: string): ProjectDefinition[] {
	const scoped = projectId === 'all' ? projects : projects.filter(project => project.id === projectId);
	const needle = query.trim().toLowerCase();
	if (!needle) return scoped;
	return scoped
		.map(project => ({
			...project,
			processes: project.processes.filter(process =>
				[project.name, process.name, process.script, ...process.args].some(text => text.toLowerCase().includes(needle))),
		}))
		.filter(project => project.processes.length);
}
