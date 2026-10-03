import type { DocArticle } from '../docs';

/** The generated app walkthrough; publication status is deliberately separate from local proof. */
export const starterAppArticle: DocArticle = {
	id: 'starter-app', area: 'start', group: 'Get started', label: 'Create an app', title: 'Create your app',
	summary: 'Create an account, save a private note and summarise it with AI. Start with working application code you can change.',
	packageName: '@db3.ai/create', sourcePath: 'apps/starter/README.md',
	testPath: 'apps/starter/tests/app.test.ts',
	sections: [
		{ id: 'before-you-start', title: 'Before you start', paragraphs: [
			'Use Node.js 24+, npm and MariaDB. The starter uses Vue, DOM Studio and Fastify with the DB3 framework. Docker is optional. The generated app runs independently of the framework repository.',
			'An OpenAI API key is optional. Registration, login and private notes work without one. Each developer supplies their own server-side key to enable the AI example.',
		] },
		{ id: 'create', title: 'Create the app', paragraphs: [
			'`@db3.ai/create` generates your starter app. It is not published to npm yet, so use the package tarballs in the preview instructions below.',
			'Once released, the creator makes a new directory, waits for your local database configuration, installs dependencies, applies committed migrations and starts development. It refuses an existing directory and never copies an AI key from your machine.',
		], codeSampleId: 'create' },
		{ id: 'preview', title: 'Run the unpublished preview', paragraphs: [
			'Obtain the matching Create, App and Pure tarballs from a maintainer. Replace the three `/path/to/` values with their absolute file paths. Run this command in the directory where you want to create your app.',
			'The generated README is part of the app and covers database setup, configuration, testing and production boundaries. Follow it before starting the server.',
		], codeSampleId: 'preview' },
		{ id: 'database', title: 'Use a local MariaDB database', paragraphs: [
			'On macOS with Homebrew, run `brew install mariadb`, then `brew services start mariadb`. Open `mariadb` with an administrator account, then run the SQL below to create a dedicated starter database and TCP user. Replace the example password with a strong local password; use the same value in `.env`.',
			'Set `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER` and `DB_PASSWORD` in `.env`. Keep this file out of Git. Remove an inherited `DATABASE_URL` unless you deliberately want it to override those settings. Never point this starter at an existing app database.',
		], codeSampleId: 'database-sql' },
		{ id: 'database-env', title: 'Configure the starter environment', paragraphs: [
			'From your application directory, copy `.env.example` to `.env` only if `.env` does not already exist. Preserve any existing application settings and update the database values below. In the framework repository, the file is `apps/starter/.env`; generated applications keep it at their root.',
			'The database is named `db3-starter`; the database login is `db3_starter`. The hyphenated database name must be enclosed in backticks in SQL. The account is restricted to this database on local TCP, not granted global administration privileges.',
			'Keep `.env` ignored by Git and never use `VITE_` for database credentials. Restart an already-running development server after changing `.env`.',
		], codeSampleId: 'database-env' },
		{ id: 'database-check', title: 'Apply and verify migrations', paragraphs: [
			'Run these commands from the application directory. Migrations create the tables inside the existing database; they do not create the database or its login. `db:check` should report `matches: true` and no pending migrations.',
			'If connection is refused, check that MariaDB is running on port 3306. If access is denied, check the password and the account host: `127.0.0.1` uses TCP and may differ from a socket login. If the database is unknown, create it first and check `DB_DATABASE`. Remove an inherited `DATABASE_URL` if it overrides your local settings.',
		], codeSampleId: 'database-check' },
		{ id: 'docker', title: 'Or use Docker for MariaDB', paragraphs: [
			'After release, add `-- --docker` to the create command. This starts MariaDB in Docker while Node still runs locally. For a generated-only preview, set `DB_PORT=33067` and a non-empty `DB_PASSWORD` in `.env`, then run `docker compose up -d --wait db`.',
			'Use a local Docker engine. A remote context publishes the port on another computer, so the creator refuses remote endpoints. Standalone `docker-compose` installations are also recognised.',
			'`docker compose stop` retains the database volume. Removing the volume deletes its data. Changing an environment password does not reset an existing database account.',
		] },
		{ id: 'run', title: 'Run it and save a note', paragraphs: [
			'After installing the preview packages and configuring MariaDB, run the commands below. Open `http://localhost:5173`, create an account and save a note. Reload: the note should still be there. Sign out and back in: your private notes should return.',
			'The app uses a real Auth session in an HttpOnly cookie, and the Note model uses `save()` to persist data. The server assigns ownership; a browser cannot choose another account’s owner ID. A second account cannot read, delete or summarise your note.',
		], codeSampleId: 'run' },
		{ id: 'ai', title: 'Summarise a note with your own AI key', paragraphs: [
			'Add your own `OPENAI_API_KEY` to the generated app’s server `.env`, then restart. The key belongs to the developer operating the app. End users do not need to enter individual keys. Never expose it through `VITE_` variables, Vue code or Git.',
			'Click Summarise with AI on a saved note. Only that note is sent to OpenAI. The result is shown separately; it does not overwrite your original. The prompt and authorization live in `server/ai/summariseNote.ts`; the shared Ai service is imported from `@db3.ai/app/ai`.',
			'Provider charges apply. The example caps input and output, disables automatic retries and uses a timeout. Its in-memory attempt limits are not a spending cap. Missing keys leave notes usable; provider failures show a safe error. Review AI output before using it.',
		], codeSampleId: 'ai' },
		{ id: 'change', title: 'Build the next feature', paragraphs: [
			'Run `npx db3 --help` from the app root to see framework commands. `server/cli.config.ts` registers the app’s service commands and bootstrap; the framework handles arguments, execution and shutdown.',
			'Start with `server/models/Note.ts` and `client/App.vue`. Add a field, update HTTP validation and the UI, then run `npm run db:make:migration -- add_note_field`. Review the generated migration, run `npm run db:migrate`, and commit the migration with its schema snapshot.',
			'For an optional field, use `field.string({ required: false, maxLength: 160 })`, not `nullable: true`. The generated README shows the full subtitle extension. The migration command runs type checking first so an invalid field option cannot silently produce a migration.',
			'The starter keeps application code visible. DB3 owns Auth, ActiveRecord and the reusable AI client. Your app owns routes, authorization, prompts and product policy.',
		], links: [{ label: 'ActiveRecord and fields', articleId: 'active-record' }, { label: 'Authentication', articleId: 'auth' }, { label: 'Application services', articleId: 'app' }] },
		{ id: 'repl', title: 'Explore your app in the terminal', paragraphs: [
			'Run `npx db3 repl` or `npm run repl` from your app root. The terminal opens with your application and model registry loaded, so you can use `app()`, `Note` and `models.Note` directly.',
			'Expressions support top-level `await`. Query your notes or inspect migration status, then type `.exit` or press Ctrl+D to close the session and its database connections. These expressions use your configured app database.',
		], codeSampleId: 'repl' },
		{ id: 'testing', title: 'Test your app', paragraphs: [
			'Run the commands below from the generated app. `npm test` needs a dedicated test MariaDB account with CREATE/DROP permissions for `db3_app_test_*`; configure the `TEST_DB_*` variables as described in its README. Missing infrastructure fails instead of skipping.',
			'The tests run real Auth, notes and committed migrations in disposable databases. Only OpenAI HTTP is simulated. They cover registration/login/logout, persistence, owner isolation, missing keys and provider failure without spending money or using your real API key.',
		], codeSampleId: 'test' },
		{ id: 'coverage', title: 'What this starter covers', paragraphs: [
			'The starter includes a landing page, password accounts, private notes and optional AI summaries. It includes Google provider configuration, but no Google sign-in screen. Add the routes and UI before enabling Google login.',
			'Password-reset screens, email verification, organisations, billing and shared application spending limits are not included. Before deploying, add the features and operational controls your application needs. DOM Studio has its own licence.',
		], links: [{ label: 'Problem-solving recipes and planned guides', articleId: 'solve-a-problem' }, { label: 'Start with a minimal HTTP server instead', articleId: 'create-app' }] },
	],
	codeSamples: [
		{ id: 'database-sql', title: 'Run once in an administrator MariaDB session', language: 'sql', code: "CREATE DATABASE `db3-starter` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER 'db3_starter'@'127.0.0.1' IDENTIFIED BY 'replace-with-your-local-password';\nGRANT ALL PRIVILEGES ON `db3-starter`.* TO 'db3_starter'@'127.0.0.1';" },
		{ id: 'database-env', title: 'Database settings in .env', language: 'bash', code: 'DB_CONNECTION=mariadb\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_DATABASE=db3-starter\nDB_USER=db3_starter\nDB_PASSWORD=replace-with-your-local-password' },
		{ id: 'database-check', title: 'Migrate, check and start locally', language: 'bash', code: 'npm run db:migrate\nnpm run db:check\nnpm run dev' },
		{ id: 'create', title: 'After publication only', language: 'bash', code: 'npm create @db3.ai@latest my-app' },
		{ id: 'preview', title: 'Current preview: supplied package tarballs', language: 'bash', code: 'npm exec --yes --package=/path/to/db3.ai-create-0.1.0.tgz -- create-db3 my-app --no-install\ncd my-app\nnpm install /path/to/db3.ai-pure-0.1.0.tgz /path/to/db3.ai-app-0.1.0.tgz' },
		{ id: 'run', title: 'Apply committed migrations, then start', language: 'bash', code: 'npm run db:migrate\nnpm run dev' },
		{ id: 'ai', title: 'Your app’s server .env', language: 'bash', code: 'OPENAI_API_KEY=your-own-key\nOPENAI_MODEL=gpt-4.1-mini' },
		{ id: 'test', title: 'Check the generated app', language: 'bash', code: 'npm run check\nnpm run build\nnpm test' },
		{ id: 'repl', title: 'Inside the application REPL', language: 'typescript', code: 'await Note.query().limit(5).all()\nawait app().db.migrations.status()' },
	],
	relatedIds: ['installation', 'active-record', 'auth', 'solve-a-problem'],
};
