import type { DocArticle } from '../docs';
import { serviceExampleSources } from '../generated/service-examples';
import { createApiReference } from './apiReference';

export const appsArticle: DocArticle = {
	id: 'apps', area: 'services', group: 'Application', label: 'Feature apps', title: 'Create a feature app',
	summary: 'Add an authenticated greeting to your application, install it, and control when its service starts and stops.',
	packageName: '@db3.ai/app/apps', sourcePath: 'packages/app/src/apps/README.md',
	examplePaths: ['packages/app/src/apps/examples/hello/App.ts', 'packages/app/src/apps/examples/hello/manifest.json', 'packages/app/src/apps/examples/helloDefinition.ts', 'packages/app/src/apps/examples/helloGuideSamples.ts'],
	testPath: 'packages/app/src/apps/tests/examples/helloDefinition.test.ts',
	additionalTestPaths: ['packages/app/src/apps/tests/Apps.test.ts', 'scripts/tests/framework-app-consumer.test.mjs', 'scripts/tests/framework-create-consumer.test.mjs'],
	sections: [
		{ id: 'start', title: 'Before you start', paragraphs: [
			'Use a generated db3 application with dependencies installed, MariaDB configured, host migrations applied and a working sign-in. Follow Create an app first if you do not have one. Run the commands below from that application’s root.',
			'You will create a backend-only app called hello. A signed-in request to `/api/apps/hello` will return a greeting. No browser component, AI key or feature-owned database table is needed; the host still uses SQL to remember installation state.',
		], links: [{ label: 'Create and configure your application', articleId: 'starter-app' }] },
		{ id: 'concepts', title: 'App, AppService and defineApp', paragraphs: [
			'The framework `App` is the shared runtime created once per process by your existing `server/app.ts`. A feature app groups related behaviour inside `apps/hello`. Its `App.ts` exports an `AppService` subclass that receives the existing runtime.',
			'For the normal generated application, use a folder and manifest as shown below. The host discovers them automatically. `defineApp()` is an alternative for a host that explicitly composes its features in code. It describes a feature; calling it does not install or start anything.',
			'Discovery means the code is available. Installation records an enabled version and applies its migrations. Boot creates the service for this process and runs its startup hook. Only a successfully booted, enabled service is ready to use.',
		] },
		{ id: 'manifest', title: 'Create the feature folder and manifest', paragraphs: [
			'Create `apps/hello` and save this file as `apps/hello/manifest.json`. The folder name supplies the identifier hello. If you include an id in the JSON, it must match. Keep credentials and private configuration out of this public metadata.',
		], codeSampleId: 'hello-manifest' },
		{ id: 'service', title: 'Add the service and authenticated route', paragraphs: [
			'Save the following as `apps/hello/App.ts`. The generated host mounts its GET route at `/api/apps/hello` and supplies the signed-in user’s identity. The feature must still enforce ownership for any records it later reads or writes.',
			'The readiness flag makes cleanup observable in this small example. In a real integration, `start(context)` can acquire subscriptions or connections; register their cleanup immediately with `context.defer()`. Keep constructors and module imports free of resource startup.',
		], codeSampleId: 'hello-service' },
		{ id: 'install', title: 'Install Hello', paragraphs: [
			'Stop your development server and any workers before running these commands. `apps:list` should first show Hello as available. `apps:install` records its version as enabled. The CLI closes its process afterwards, so `ready: false` in a CLI listing is expected.',
			'This app has no models, so it needs no feature migration. The host’s installation records are managed by the Apps service. Do not add Hello to the host’s model registry.',
		], codeSampleId: 'hello-install' },
		{ id: 'run', title: 'Make the first request', paragraphs: [
			'Start the application with `npm run dev`. Sign in through its browser UI, then open `/api/apps/hello` on that same origin. In the default development setup that is `http://localhost:5173/api/apps/hello`. You should receive a JSON message containing your user ID.',
			'Try the URL in a private browser window without signing in: it should return 401. Hello has no client component and deliberately adds no navigation link. The Apps administrator screen can still show its metadata and installation state.',
		], codeSampleId: 'hello-output' },
		{ id: 'lifecycle', title: 'Understand installation, startup and cleanup', paragraphs: [
			'`install()` runs after the app’s migrations during install or upgrade. It must tolerate retries. `start(context)` runs during process boot, after required dependencies have services. Boot never applies migrations.',
			'`context.defer(cleanup)` registers process-owned cleanup in reverse order. It also runs if startup fails. Use it to unsubscribe listeners and close resources; there is no separate `AppService` `stop()` hook.',
			'Disabling removes runtime availability but retains installation data. Uninstalling runs `uninstall()` for app-specific preflight and durable deregistration; it keeps tables, records and migration history. A later install can recover that data.',
			'`App.close()` closes feature resources before the shared framework services. Do not cache a feature service across disable/enable; retrieve the currently available service for each operation.',
		] },
		{ id: 'runtime-use', title: 'Call the service from application code', paragraphs: [
			'The generated app prepares service types through `npm run check`. After the host has booted, `app().hello` is the typed optional feature service. Handle absence when the feature is disabled, uninstalled or unavailable.',
			'Calls through the HTTP adapter participate in lifecycle draining automatically. For direct application operations that must finish before an online management action, use `apps.run()` as below. Supply a user ID already authenticated by your host.',
		], codeSampleId: 'hello-use' },
		{ id: 'define-app', title: 'Optional: compose with defineApp()', paragraphs: [
			'Use this alternative when you own the host composition and want an explicit app map. Keep the same `apps/hello/App.ts` and save this file as `apps/helloDefinition.ts`. The explicit map replaces automatic discovery for that host; include every feature you want it to manage.',
			'The definition’s `create(host)` receives the existing runtime. `afterInstall(host)` corresponds to `AppService.install()`; `start(context)` delegates startup; `beforeUninstall(host)` corresponds to `AppService.uninstall()`. Definition routes, models, jobs and schedules must be supplied explicitly when used.',
		], codeSampleId: 'hello-definition' },
		{ id: 'compose-host', title: 'Pass the definition to the existing host', paragraphs: [
			'In `server/app.ts`, import helloDefinition and add apps to the existing `App` options. Keep the rest of your database, authentication and configuration wiring. Do not create a second `App`.',
			'The same `apps:install hello` command and normal server boot still apply. For a custom host, install in a stopped maintenance process, await `host.apps.boot()` before serving requests, mount `registerAppRoutes()` with real authentication, and await `host.close()` on shutdown. The generated application already supplies these boundaries.',
		], codeSampleId: 'hello-composition' },
		{ id: 'testing', title: 'Test the feature in your application', paragraphs: [
			'Create `tests/hello.test.ts` with the test below. It discovers your actual `apps/hello` folder, installs it into a disposable MariaDB database and exercises real HTTP routing. The test-only authorization callback stands in for a signed-in user; never use that header check in your production host.',
			'Set `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER` and `TEST_DB_PASSWORD` for a dedicated local test account allowed to create and drop `db3_app_test_*` databases. The test explicitly ignores the application `DATABASE_URL` and removes its temporary database in finally. No live application data is used.',
		], codeSampleId: 'hello-test' },
		{ id: 'testing-explicit', title: 'Test explicit composition too', paragraphs: [
			'If you chose the optional defineApp() path, add the import below to tests/hello.test.ts and replace its host construction with the new App expression. Keep every assertion and the cleanup block. Run the same test command to verify the definition actually wires startup and routes.',
		], codeSampleId: 'hello-test-explicit' },
		{ id: 'run-tests', title: 'Run and extend the test', paragraphs: [
			'Run these commands from your application root. The test verifies the greeting, anonymous rejection, deferred cleanup after disable, and a fresh service after enable. The type check also regenerates optional service types.',
			'When you add records, extend the test with a second user and assert that one user cannot read or change the other’s data. Test any install retry or resource cleanup that your feature adds.',
		], codeSampleId: 'hello-test-command' },
		{ id: 'failures', title: 'When something goes wrong', paragraphs: [
			'Hello missing from `apps:list`: check the immediate `apps/hello` directory and root `manifest.json`. A duplicate local folder and npm package with the same id is rejected. The root `App.ts` must default-export a class extending `AppService`.',
			'404 after installing: restart the server so it boots the enabled app; inspect `apps:list` and startup errors. 401 while enabled: sign in on the same browser origin. For a custom host, verify the authentication callback in `registerAppRoutes()`.',
			'A failed migration or install hook leaves the installation failed and unavailable. Repair the cause and retry `apps:install`; do not edit already applied migrations. A rejected uninstall preflight retains the installation. Resolve outstanding app-owned work before retrying.',
			'An unknown `app().hello` type: run `npm run check` after adding the manifest. With explicit composition, `host.apps.hello` is inferred from the supplied map. Server code changes require restarting the process; discovery does not replace already loaded modules.',
		] },
		{ id: 'production', title: 'Manage running applications deliberately', paragraphs: [
			'Use the stopped-process CLI workflow when web replicas or separate workers share this database. The database advisory lock serializes installers; it cannot stop another running process.',
			'`host.apps.manage(action, id)` supports online actions in an explicitly authorized single-process host. It blocks new app requests, drains existing work, closes feature resources, applies the action and boots remaining apps. Concurrent management returns 409; new app requests during the change return 503.',
			'The generated administrator UI requires `APP_ADMIN_EMAIL`. Production additionally requires `APPS_MANAGE_ONLINE=true`; enable it only for a single-process deployment. Apps are trusted code in the host process, and installation is host-wide rather than per tenant.',
		] },
		{ id: 'next', title: 'Add storage, navigation and packaging', paragraphs: [
			'For owned data, declare static models on the root `AppService` and use tables prefixed `hello_`. Run `npm run db3 -- apps:make-migration hello add_records`, review and commit the app’s database migration and snapshot, then install the new version. Keep feature models out of the host’s schema registry.',
			'For a UI, add `client/index.ts` with a default component export and manifest navigation. For viewer-specific badges and permissions, implement `navigation(context)` using the authenticated actor. Menu visibility never replaces route authorization.',
			'The supporting service reference explains complete npm extraction, dependency declarations, navigation contracts and authored down migrations. Uninstall never runs down migrations automatically. Use the Apps API for exact signatures.',
		], links: [{ label: 'Apps API', articleId: 'apps-api' }, { label: 'Models and fields', articleId: 'active-record' }, { label: 'Migrations', articleId: 'migrations' }] },
		{ id: 'disable', title: 'When you finish: disable or remove Hello', paragraphs: [
			'After completing the examples and tests above, try the lifecycle actions. With all application processes stopped, run `apps:disable hello`, then restart the server. The endpoint should now return 404. Stop the server again, enable Hello and restart: its greeting should return after sign-in.',
			'To remove the feature, stop consumers and run `apps:uninstall hello` while the code is still present. You can then remove `apps/hello`. Restart servers and rebuild the browser after adding or removing packaged or browser-facing features.',
			'If you chose explicit composition, first remove the `helloDefinition` import and hello map entry from `server/app.ts` after uninstalling. Preserve any other definitions. Remove `apps/helloDefinition.ts`, then `apps/hello`, so no imports point at deleted code.',
			'Also remove `tests/hello.test.ts` and any optional `greetWithHello` helper or callers you added for this tutorial. Run `npm run check` after removing the feature to catch remaining imports and refresh generated service types.',
		], codeSampleId: 'hello-manage' },
	],
	codeSamples: [
		{ id: 'hello-test-explicit', title: 'Two edits to tests/hello.test.ts for explicit composition', language: 'typescript', code: serviceExampleSources.helloTestExplicit },
		{ id: 'hello-test', title: 'tests/hello.test.ts', language: 'typescript', code: serviceExampleSources.helloTest },
		{ id: 'hello-manifest', title: 'apps/hello/manifest.json', language: 'json', code: serviceExampleSources.helloManifest },
		{ id: 'hello-service', title: 'apps/hello/App.ts', language: 'typescript', code: serviceExampleSources.helloApp },
		{ id: 'hello-install', title: 'From your application root, with consumers stopped', language: 'bash', code: 'npm run check\nnpm run db3 -- apps:list\nnpm run db3 -- apps:install hello\nnpm run db3 -- apps:list' },
		{ id: 'hello-output', title: 'Signed-in response (your user ID will differ)', language: 'json', code: '{ "message": "Hello, YOUR_USER_ID!" }' },
		{ id: 'hello-manage', title: 'Run each action with application processes stopped', language: 'bash', code: '# Disable, then restart and try the endpoint\nnpm run db3 -- apps:disable hello\n\n# Stop again, enable, then restart\nnpm run db3 -- apps:enable hello\n\n# Stop again before uninstalling; retained data is kept\nnpm run db3 -- apps:uninstall hello' },
		{ id: 'hello-use', title: 'Inside an authenticated server operation', language: 'typescript', code: serviceExampleSources.helloUse },
		{ id: 'hello-definition', title: 'apps/helloDefinition.ts (explicit composition only)', language: 'typescript', code: serviceExampleSources.helloDefinition },
		{ id: 'hello-composition', title: 'Edit server/app.ts; retain the other existing options', language: 'typescript', code: "import { helloDefinition } from '../apps/helloDefinition';\n\n// Add this property inside your existing new App({ ... }) options:\napps: { hello: helloDefinition }," },
		{ id: 'hello-test-command', title: 'Run the feature test and application type check', language: 'bash', code: 'npm test -- tests/hello.test.ts\nnpm run check' },
	],
	relatedIds: ['starter-app', 'app', 'apps-api', 'migrations'],
	keywords: ['defineApp AppService feature app install enable disable uninstall lifecycle start cleanup'],
};

export const appsApiArticle = createApiReference({
	id: 'apps-api', label: 'Apps API', packageName: '@db3.ai/app/apps', sourcePath: 'packages/app/src/apps/README.md', guideId: 'apps',
	references: [
		['define-app', 'Define a feature in code', 'dist/apps/defineApp.d.ts'],
		['registry', 'Installation and runtime', 'dist/apps/Apps.d.ts'],
		['service', 'Root App service and hooks', 'dist/apps/AppService.d.ts'],
		['discovery', 'Folder and npm discovery', 'dist/apps/discoverApps.d.ts'],
		['vite', 'Browser discovery plugin', 'dist/apps/appsPlugin.d.ts'],
		['definition', 'Programmatic definition', 'dist/apps/contracts/AppDefinition.d.ts'],
		['manifest', 'Manifest and navigation', 'dist/apps/contracts/AppManifest.d.ts'],
		['navigation', 'Runtime navigation contribution', 'dist/apps/contracts/AppNavigation.d.ts'],
		['navigation-context', 'Verified navigation viewer', 'dist/apps/contracts/AppNavigationContext.d.ts'],
		['navigation-badge', 'Accessible count badges', 'dist/apps/contracts/AppNavigationBadge.d.ts'],
		['navigation-result', 'Collected navigation and partial failures', 'dist/apps/contracts/AppNavigationResult.d.ts'],
		['description', 'Visual catalog and client loader', 'dist/apps/contracts/AppDescription.d.ts'],
		['routes', 'Transport-independent routes', 'dist/apps/contracts/AppRoute.d.ts'],
		['fastify', 'Host authorization adapter', 'dist/apps/registerAppRoutes.d.ts'],
		['commands', 'Maintenance commands', 'dist/apps/commands/index.d.ts'],
	],
});
