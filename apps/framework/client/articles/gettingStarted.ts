import type { DocArticle } from '../docs';
import { serviceExampleSources } from '../generated/service-examples';
import { serviceLabEvidence, serviceLabSamples, serviceLabTesting } from './serviceLab';

const serverEvidence = serviceLabEvidence('server', 'firstApplication', 'Runs health, greeting, validation and not-found requests through the real HTTP application.', 'Node.js 24 or newer; Fastify. No database, external service or listening port.');

export const installationArticle: DocArticle = {
	id: 'installation', area: 'start', group: 'Standalone use', label: 'Install packages separately', title: 'Install packages in an existing project',
	summary: 'Use this path when you want individual framework services in an existing project. For a new db3 app, start with the app creator.',
	packageName: '@db3.ai/app', sourcePath: 'packages/app/README.md', includeSourceDocument: false,
	sections: [
		{ id: 'starter', title: 'Want a working app shell?', paragraphs: [
			'The `@db3.ai/create` preview generates a Vue/DOM Studio app with password login, private notes and optional AI summaries using your own server-side API key. Start there for a complete first feature. This page covers installing the runtime for a smaller HTTP app or script.',
		], links: [{ label: 'Create the notes and AI starter', articleId: 'starter-app' }] },
		{ id: 'requirements', title: 'Before you start', paragraphs: [
			'Use Node.js 24 or newer and npm for these walkthroughs. Start in a new directory, outside the framework repository. The first HTTP app needs no Vue, database or cloud credentials.',
			'The runtime package is `@db3.ai/app`. Its matching `@db3.ai/pure` dependency contains portable helpers. Fastify is optional: install it for this HTTP example, not for a script that only uses Storage.',
		] },
		{ id: 'publication-status', title: 'Publication status', paragraphs: [
			'The framework and creator are not published to npm yet. The intended released install command is shown below, but it will not work until the first release. Use matching package tarballs supplied by a maintainer for now.',
		], codeSampleId: 'released-install' },
		{ id: 'install', title: 'Install the current preview', paragraphs: [
			'Obtain the matching App and Pure tarballs from a framework maintainer. Replace both `/path/to/` values below with those files. Install them together because the unreleased App package depends on the matching Pure version.',
			'Nothing in this command publishes your application. Marking it private also protects against accidentally running `npm publish` from the app directory.',
		], codeSampleId: 'install-preview' },
		{ id: 'development-tools', title: 'Add the development tools', paragraphs: [
			'`tsx` runs the copied TypeScript examples, TypeScript checks them, and Vitest runs your application tests. Fastify owns the HTTP listener; `App` owns framework services.',
		], codeSampleId: 'tools', links: [{ label: 'Create and run your first app', articleId: 'create-app' }] },
		{ id: 'database-labs', title: 'Configure SQL when a guide needs it', paragraphs: [
			'Auth, ActiveRecord, Media, database-backed Queue and Scheduler need MariaDB/MySQL. Their isolated labs require a dedicated local test account allowed to create and drop databases prefixed `db3_app_test_`. Do not use production credentials. Storage and the first HTTP app do not need SQL.',
			'Save the configuration below as `.env` in your new app directory, replacing the user and password. Keep `.env` out of Git. `DATABASE_URL`, if set in your shell, takes precedence; unset it unless it deliberately points at your test server.',
			'Each lab creates a unique database and removes it in `finally`. A forcibly killed process may leave a test database or temporary directory to inspect. The lab’s `Database.install()` is not your production migration workflow.',
		], codeSampleId: 'test-env', links: [{ label: 'Native MariaDB setup', articleId: 'starter-app', sectionId: 'database' }, { label: 'Optional Docker setup', articleId: 'starter-app', sectionId: 'docker' }, { label: 'Test-account grants in the source-backed starter guide', articleId: 'starter-app', sectionId: 'testing' }] },
		{ id: 'troubleshooting', title: 'When installation fails', paragraphs: [
			'An npm 404 for `@db3.ai/app` is expected before publication. For the preview, check that both tarball paths exist and their versions match. Do not substitute an unrelated npm package with a similar name.',
			'If SQL reports connection refused, check its host and port. Access denied usually means credentials or grants; a socket-only account may not allow TCP login. Database creation needs additional test-account privileges beyond reading an existing database.',
			'If port 3000 is occupied, choose another `PORT` when starting the HTTP example. None of the guides requires a global TypeScript or framework CLI installation.',
		] },
		{ id: 'coverage', title: 'What is working, and what comes next', paragraphs: [
			'The minimal HTTP guide below has a real HTTP test and uses installed package artifacts. The separate Notes + AI starter adds a generated Vue shell, authentication and migrations. Until npm publication, install the matching preview tarballs.',
		], links: [{ label: 'Create an app and test it', articleId: 'create-app' }, { label: 'Your standalone application layout', articleId: 'create-app', sectionId: 'layout' }] },
	],
	codeSamples: [
		{ id: 'released-install', title: 'After publication only', language: 'bash', code: 'npm install @db3.ai/app' },
		{ id: 'install-preview', title: 'Current preview: run in a new directory', language: 'bash', code: 'mkdir my-db3-app\ncd my-db3-app\nnpm init -y\nnpm pkg set type=module\nnpm pkg set private=true --json\nnpm install /path/to/db3.ai-pure-0.1.0.tgz /path/to/db3.ai-app-0.1.0.tgz' },
		{ id: 'tools', title: 'Install HTTP and development dependencies', language: 'bash', code: 'npm install fastify@^5\nnpm install --save-dev tsx@^4 typescript@^6 @types/node@^24 vitest@^4' },
		{ id: 'test-env', title: '.env (test databases only)', language: 'bash', code: 'DB_CONNECTION=mariadb\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USER=your_test_user\nDB_PASSWORD=your_test_password\nDB_DATABASE=db3_app_test\nDB_TEST_DATABASE_PREFIX=db3_app_test' },
	], relatedIds: ['create-app', 'app', 'auth'],
};

export const firstAppArticle: DocArticle = {
	id: 'create-app', area: 'start', group: 'Standalone use', label: 'Minimal HTTP app', title: 'Build a minimal HTTP app',
	summary: 'Start an HTTP server, return a JSON response, reject invalid input and test it without opening a port.',
	packageName: '@db3.ai/app/server', sourcePath: 'packages/app/src/server/README.md', includeSourceDocument: false,
	examplePaths: ['packages/app/src/server/examples/createFirstServer.ts', 'packages/app/src/server/examples/startFirstServer.ts'], testPath: serverEvidence.testPath, verifiedExample: serverEvidence,
	sections: [
		{ id: 'setup', title: 'Set up the files', paragraphs: [
			'Complete Installation first, including Fastify and the development tools. Then copy the shipped example files into your app. This is ordinary application code you can edit, not a second framework repository.',
		], codeSampleId: 'copy-lab', links: [{ label: 'Installation and prerequisites', articleId: 'installation' }] },
		{ id: 'layout', title: 'Your application layout', paragraphs: [
			'This is your standalone app, not the framework source tree. After copying the two server files and adding the test below, it has this layout. Keep your application files together in this new directory.',
			'Keep the code in `examples/` while learning. When you move it into your own source folder, update the start command and test import together. Add a private `.env` only when a database-backed guide needs it, and exclude it and `node_modules/` from Git.',
		], codeSampleId: 'app-layout' },
		{ id: 'application', title: 'Create the application', paragraphs: [
			'`createFirstServer()` returns a server without listening yet. It creates one framework `App`, attaches cleanup to Fastify, and registers health and greeting routes. Keeping construction separate from listening is what makes it easy to test.',
			'The greeting route validates its parameters and wraps its work in `requestContext.run()`. Request-owned values stay in that asynchronous context rather than becoming process-global state.',
		], codeSampleId: 'server-source' },
		{ id: 'process', title: 'Own the process boundary', paragraphs: [
			'The entry point chooses the greeting and port, starts a local listener and closes it on Ctrl-C or SIGTERM. It listens on `127.0.0.1`; production binding, HTTPS, supervision and proxy trust need deliberate deployment configuration.',
		], codeSampleId: 'start-source' },
		{ id: 'run', title: 'Run the app', paragraphs: [
			'Run this from your app directory. Leave the process running while you try the requests in another terminal. No database tables are created.',
		], codeSampleId: 'start-command' },
		{ id: 'use', title: 'Make a request', paragraphs: [
			'The health route returns `{"status":"ready"}`. The greeting returns `{"message":"Hello, Ada!"}`. An unknown route returns 404; a name longer than 80 characters returns 400.',
		], codeSampleId: 'requests' },
		serviceLabTesting('server', 'firstApplication'),
		{ id: 'run-tests', title: 'Run your tests', paragraphs: [
			'The test uses `server.inject()` against the same application factory. It covers a successful response, configuration, invalid input and a missing route, then closes the framework. No mock App, TCP port or SQL account is involved.',
		], codeSampleId: 'test-lab' },
		{ id: 'next', title: 'Build the next feature', paragraphs: [
			'Change the greeting and run the test. Add another route and its success and failure cases. Move your own application code out of `examples/` when you settle on a structure; keep the test import in sync.',
			'This is a working backend starting point, not a full SaaS shell. Authentication, durable records, file ownership and background processing belong to the next guides.',
		], links: [{ label: 'App lifecycle and service configuration', articleId: 'app' }, { label: 'Add Auth', articleId: 'auth' }, { label: 'Write files with Storage', articleId: 'storage' }] },
	],
	codeSamples: [
		...serviceLabSamples('server', 'startFirstServer', 'firstApplication').filter(sample => sample.id !== 'run-lab'),
		{ id: 'app-layout', title: 'Standalone app after adding the test', language: 'txt', code: 'my-db3-app/\n\tpackage.json\n\tpackage-lock.json\n\texamples/\n\t\tcreateFirstServer.ts\n\t\tstartFirstServer.ts\n\ttests/\n\t\tserver/\n\t\t\tfirstApplication.test.ts' },
		{ id: 'server-source', title: 'examples/createFirstServer.ts', language: 'typescript', code: serviceExampleSources.createFirstServer },
		{ id: 'start-source', title: 'examples/startFirstServer.ts', language: 'typescript', code: serviceExampleSources.startFirstServer },
		{ id: 'start-command', title: 'Start locally', language: 'bash', code: 'npx tsx examples/startFirstServer.ts' },
		{ id: 'requests', title: 'In a second terminal', language: 'bash', code: 'curl http://127.0.0.1:3000/health\ncurl http://127.0.0.1:3000/hello/Ada' },
	], relatedIds: ['installation', 'app', 'auth', 'storage'],
};

export const appArticle: DocArticle = {
	id: 'app', area: 'services', group: 'Foundation', label: 'App', title: 'App',
	summary: 'Create one application at boot. Configure its services, use request-local state and close the resources you own.',
	packageName: '@db3.ai/app/server', sourcePath: 'packages/app/src/server/README.md', includeSourceDocument: true,
	sections: [
		{ id: 'setup', title: 'Create one App per process', paragraphs: ['`App` is the framework service hub, not an HTTP server. Your HTTP server, command or worker creates it once at boot. The first-app guide shows a complete Fastify entry point with no database requirement.'], links: [{ label: 'Install, run and test the first app', articleId: 'create-app' }] },
		{ id: 'services', title: 'Use a service', paragraphs: ['Import `App` and `app` from `@db3.ai/app/server`. Constructing `new App(options)` makes it active. `app().storage`, `app().auth`, `app().queue` and the other getters create services lazily and reuse them.', 'Do not create another App per request. The active App is process-global; creating a second replaces the active reference. Calling `app()` before boot throws an explicit error.'] },
		{ id: 'configuration', title: 'Configure the runtime', paragraphs: ['Pass general values through `config`. Use `storage`, `auth`, `queue`, `log`, `url` and `serializer` options for the corresponding service. Cache, Media and Security also read their named configuration sections.', 'Database-backed services resolve the active App database. Normal feature functions should not accept optional Knex arguments. Use `ActiveRecord.withDb()` for a scoped transaction; migrations remain an application deployment step.', 'Set `dbOptions.syncColumns` to false for a migration-owned application schema. The default development-oriented safe column synchronization is not a substitute for reviewed production migrations.'], links: [{ label: 'Model and database workflow', articleId: 'active-record' }] },
		{ id: 'request-context', title: 'Keep request state isolated', paragraphs: ['Wrap the complete request work in `application.requestContext.run()`. Use `set()`, `get()` and `remember()` inside that boundary. `remember()` shares a value or in-flight promise within one request and removes rejected promises so a later attempt can retry.', 'Auth relies on this context for current user and token state. Do not keep authenticated users on process-global application properties. A route handler wrapper covers its callback, not earlier middleware that ran outside it.'] },
		{ id: 'run-and-close', title: 'Run and shut down', paragraphs: ['The host owns listening, signals and worker processes. Close the HTTP listener or stop accepting work before `App.close()`. The first-app entry point handles SIGINT and SIGTERM.', '`App.close()` clears the active reference, detaches the scheduler recorder, clears event listeners, closes Cache and Logging, and destroys a framework-owned database connection. An injected database remains caller-owned.', 'It does not drain queue workers or close a Redis queue driver. Stop workers and close their owned transports before closing the App, while jobs can still resolve `app()`. Custom application services must also close any resources they introduce.'], links: [{ label: 'The complete process entry point', articleId: 'create-app', sectionId: 'process' }, { label: 'Run a dedicated scheduler', articleId: 'scheduler', sectionId: 'production' }] },
		{ id: 'testing', title: 'Testing', paragraphs: ['Construct the real application factory and use HTTP injection for route tests. Close it in `finally`. Use a generated disposable database when testing database-backed features; do not mock ActiveRecord or point tests at an application database.'], links: [{ label: 'Copy and run the application test', articleId: 'create-app', sectionId: 'testing' }] },
		{ id: 'coverage', title: 'Coverage and reference', paragraphs: ['The first-app test exercises configuration, request handling, validation and shutdown. Service-owned Server tests additionally cover request isolation and active-context lifecycle. Custom service shutdown and production deployment need their own application tests.', 'The linked service reference includes an example of extending App. Use the `AppOptions` and `RequestContext` API reference for the full set of options.'], links: [{ label: 'App and request-context API', articleId: 'app-api' }] },
	], relatedIds: ['create-app', 'auth', 'storage', 'scheduler'],
};
