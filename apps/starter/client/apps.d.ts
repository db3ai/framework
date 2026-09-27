declare module 'virtual:db3/apps' {
	const apps: import('@db3.ai/app/apps/contracts').AppClientDefinition<import('vue').Component>[];
	export default apps;
}
