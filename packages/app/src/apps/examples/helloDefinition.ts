import { defineApp } from '@db3.ai/app/apps';
import HelloApp from './hello/App';

/** Explicit composition of the same service for hosts that do not use folder discovery. */
export const helloDefinition = defineApp({
	manifest: { id: 'hello', name: 'Hello', version: '0.1.0', apiVersion: 1 },
	/** Receives the existing application runtime. Construction has no side effects. */
	create: host => new HelloApp(host),
	routes: HelloApp.routes,
	/** Delegates runtime readiness and cleanup to the feature service. */
	start: context => context.service.start(context),
	/** Delegates retry-safe installation work after migrations have completed. */
	afterInstall: host => new HelloApp(host).install(),
	/** Delegates removal preflight while retaining the app's data. */
	beforeUninstall: host => new HelloApp(host).uninstall(),
});
