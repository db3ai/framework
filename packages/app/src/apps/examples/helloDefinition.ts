import { defineSubApp } from '@db3.ai/app/apps';
import HelloApp from './hello/App';

/** Explicit composition of the same service for hosts that do not use folder discovery. */
export const helloDefinition = defineSubApp({
	manifest: { id: 'hello', name: 'Hello', version: '0.1.0', apiVersion: 1 },
	/** Receives the existing application runtime. Construction has no side effects. */
	create: app => new HelloApp(app),
	routes: HelloApp.routes,
	/** Delegates runtime readiness and cleanup to the feature service. */
	start: context => context.service.start(context),
	/** Delegates retry-safe installation work after migrations have completed. */
	afterInstall: app => new HelloApp(app).install(),
	/** Delegates removal preflight while retaining the app's data. */
	beforeUninstall: app => new HelloApp(app).uninstall(),
});
