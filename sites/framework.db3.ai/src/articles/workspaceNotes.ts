import type { DocArticle } from '../docs';
import { noteEvidence, noteExamplePaths, noteTestPath } from './activeRecord';
import { serviceExampleOutputs, serviceExampleSources } from '../generated/service-examples';

export const workspaceNotesArticle: DocArticle = {
	id: 'guide-workspace-notes', area: 'guides', group: 'Solve a problem', label: 'Workspace notes',
	title: 'Keep one workspace’s notes separate from another’s',
	summary: 'Run a small database workflow: create a note, protect ownership, list the right records, reject invalid input and roll back a failed write.',
	packageName: '@db3.ai/app/db', sourcePath: 'packages/app/src/db/README.md', examplePaths: noteExamplePaths, testPath: noteTestPath, verifiedExample: noteEvidence,
	includeSourceDocument: false,
	sections: [
		{ id: 'outcome', title: 'What we are building', paragraphs: [
			'A note belongs to a workspace. Request data may change its title and body, but cannot move it to another workspace. Reading, editing and deleting always includes the trusted workspace identity.',
			'This is a runnable database lab, not a complete SaaS starter. It combines App, ActiveRecord, fields and transactions. Your application still owns authentication and membership checks. We deliberately pass an already-authorized workspace into the feature functions.',
		] },
		{ id: 'install', title: 'Install the example', paragraphs: [
			'Use Node.js 24, npm, and a running MariaDB/MySQL server. Use a test account with permission to create and drop db3_app_test_* databases. The script creates a uniquely named database and removes it in `finally`; it does not use your application database. If the process is killed, inspect the exact leftover test database before removing it.',
			'The framework is pre-release. Obtain the matching @db3.ai/pure and @db3.ai/app tarballs from the framework maintainer before starting. Replace the two /path/to paths below with those files. There is no public npm initializer to substitute at this stage.',
			'Run these commands in a new directory. They copy the actual shipped example files, so you can edit and rerun them without relying on a sibling repository.',
		], codeSampleId: 'install-consumer' },
		{ id: 'configure', title: 'Use a test database account', paragraphs: [
			'Create a .env file in that directory with your local test connection. Replace the placeholders; do not commit credentials. DB_DATABASE and the prefix below identify the test namespace, not a database the script assumes already exists.',
			'Access denied means the account or authentication method is wrong. Connection refused means the server/port is unavailable. This lab uses TCP credentials; a socket-only local account is not enough. Creating a database also needs the appropriate database privileges.',
		], codeSampleId: 'database-config' },
		{ id: 'run', title: 'Run it and inspect the result', paragraphs: [
			'Run this from the directory containing .env. The output below is checked by the example test. IDs and timestamps are omitted so you can compare the result directly.',
			'The script adds a second workspace, attempts to inject its identity into a note, checks validation, then makes a two-note transaction fail. Only the authorized note is listed, and the failed transaction leaves the previous count unchanged.',
		], codeSampleId: 'run-command' },
		{ id: 'runner', title: 'Read the complete runner', paragraphs: [
			'This is the script you just ran. It uses the model and note functions from the ActiveRecord guide, then cleans up its test database.',
		], codeSampleId: 'run-example' },
		{ id: 'try-it', title: 'Try a few changes', paragraphs: [
			'Change the note title and run again. Try a blank title or 121 characters: `save()` should fail with RecordValidationError. Change the update/delete workspace to the other workspace: the scoped lookup should throw RecordNotFoundError.',
			'Run the type check below after editing. It checks your copied source against the installed package declarations.',
			'These checks exercise field protection and database scoping, not your real authentication system. A production endpoint must derive workspaceId from verified membership and recheck the appropriate permission for each operation.',
		], codeSampleId: 'type-check-command', links: [{ label: 'Model and feature function source', articleId: 'active-record', sectionId: 'define-fields' }, { label: 'Every record and query signature', articleId: 'active-record-api' }] },
		{ id: 'application', title: 'Move it into your application', paragraphs: [
			'Keep KnowledgeNote and the feature functions. Use your normal App boot, register the model with your application’s migration manager, and apply reviewed migrations. Do not copy the disposable database creation or `Database.install()` into request/server startup.',
			'Follow the API and Migrations guides for the next application boundaries. Conflict resolution and reversible soft-delete workflows remain TODO recipes; they are not hidden prerequisites for this lab.',
		], links: [{ label: 'Authenticated API', articleId: 'guide-api' }, { label: 'Migrations', articleId: 'migrations' }, { label: 'More problems to solve', articleId: 'solve-a-problem' }] },
	],
	codeSamples: [
		{ id: 'install-consumer', title: 'Run in a new directory', language: 'bash', code: 'mkdir db3-notes\ncd db3-notes\nnpm init -y\nnpm pkg set type=module\nnpm install /path/to/db3.ai-pure-0.1.0.tgz /path/to/db3.ai-app-0.1.0.tgz\nnpm install --save-dev tsx@^4 typescript@^6 @types/node@^24 vitest@^4\nmkdir examples\ncp node_modules/@db3.ai/app/src/db/examples/KnowledgeNote.ts examples/\ncp node_modules/@db3.ai/app/src/db/examples/workspaceNotes.ts examples/\ncp node_modules/@db3.ai/app/src/db/examples/createNotesTogether.ts examples/\ncp node_modules/@db3.ai/app/src/db/examples/runWorkspaceNotes.ts examples/' },
		{ id: 'database-config', title: '.env (local test credentials)', language: 'bash', code: 'DB_CONNECTION=mariadb\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USER=your_test_user\nDB_PASSWORD=your_test_password\nDB_DATABASE=db3_app_test\nDB_TEST_DATABASE_PREFIX=db3_app_test' },
		{ id: 'run-command', title: 'Run the walkthrough', language: 'bash', code: 'npx tsx examples/runWorkspaceNotes.ts', output: serviceExampleOutputs.workspaceNotes, outputLanguage: 'json' },
		{ id: 'run-example', title: 'runWorkspaceNotes.ts', language: 'typescript', code: serviceExampleSources.runWorkspaceNotes },
		{ id: 'type-check-command', title: 'Check the example types', language: 'bash', code: 'npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts' },
	],
	relatedIds: ['active-record', 'active-record-api', 'solve-a-problem'], keywords: ['workspace notes tenant isolation transaction rollback validation CRUD problem walkthrough'],
};
