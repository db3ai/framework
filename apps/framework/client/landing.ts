import { Blocks, Bot, Braces, GitBranch, LockKeyhole } from '@lucide/vue';
import { markRaw, type Component } from 'vue';

/**
 * One documentation destination exposed through landing-page navigation.
 */
export interface LandingNavigationItem {
	label: string;
	value: string;
}

/**
 * One framework advantage displayed in the landing-page capability list.
 */
export interface LandingCapability {
	title: string;
	description: string;
	target: string;
	icon: Component;
}

/**
 * One product shape supported by the framework runtime.
 */
export interface LandingUseCase {
	title: string;
	description: string;
	target: string;
}

export const frameworkNavigation: LandingNavigationItem[] = [
	{ label: 'Framework overview', value: 'welcome' },
	{ label: 'Application runtime', value: 'app' },
	{ label: 'Project structure', value: 'project-structure' },
];

export const guideNavigation: LandingNavigationItem[] = [
	{ label: 'Create your application', value: 'starter-app' },
	{ label: 'Build with AI', value: 'ai' },
	{ label: 'Build a field-aware API', value: 'guide-api' },
];

export const serviceNavigation: LandingNavigationItem[] = [
	{ label: 'Application services', value: 'app' },
	{ label: 'Models and data', value: 'active-record' },
	{ label: 'Queues and background work', value: 'queue-overview' },
	{ label: 'Storage and media', value: 'storage' },
];

export const landingCapabilities: LandingCapability[] = [
	{
		title: 'Build AI into your app',
		description: 'Add server-side AI features alongside your application models, files and background jobs.',
		target: 'ai',
		icon: markRaw(Bot),
	},
	{
		title: 'Build & ship faster',
		description: 'Opinionated structure, field-owned data contracts, and practical tooling take an application from idea to production quickly.',
		target: 'starter-app',
		icon: markRaw(Braces),
	},
	{
		title: 'Workflows that scale',
		description: 'Queues, events, schedules, and durable flows keep important work moving beyond the request boundary.',
		target: 'queue-overview',
		icon: markRaw(GitBranch),
	},
	{
		title: 'Secure by default',
		description: 'Authentication, authorization, validation, and encrypted values share predictable application-owned boundaries.',
		target: 'security',
		icon: markRaw(LockKeyhole),
	},
	{
		title: 'Extensible & type-safe',
		description: 'TypeScript contracts keep services, drivers, models, jobs, and application code aligned as the product grows.',
		target: 'api-reference',
		icon: markRaw(Blocks),
	},
];

export const landingUseCases: LandingUseCase[] = [
	{
		title: 'SaaS products',
		description: 'Compose accounts, auth, billing-facing models, APIs, mail, and background work inside one application runtime.',
		target: 'starter-app',
	},
	{
		title: 'AI-assisted workflows',
		description: 'Run tool-backed, observable workflows with access to the same models, queues, storage, and application context.',
		target: 'flows',
	},
	{
		title: 'API-first services',
		description: 'Validate input, query logical model fields, and serialize consistent response shapes without duplicate conversion layers.',
		target: 'guide-api',
	},
	{
		title: 'Internal platforms',
		description: 'Build operational tools on the same framework services that run requests, scheduled work, and durable jobs.',
		target: 'scheduler',
	},
];

export const mobileLandingNavigation: LandingNavigationItem[] = [
	...frameworkNavigation,
	...guideNavigation,
	...serviceNavigation,
	{ label: 'API reference', value: 'api-reference' },
];
