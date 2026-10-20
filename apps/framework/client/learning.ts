/** One documentation destination that readers can use before videos are recorded. */
export interface LearningResource {
	label: string;
	articleId: string;
}

/** A proposed video lesson with a concrete outcome and recording brief. */
export interface LearningLesson {
	title: string;
	minutes: number;
	summary: string;
	coverage: readonly string[];
	resource: LearningResource;
}

/** A planned course built around a single application outcome. */
export interface LearningCourse {
	id: string;
	title: string;
	eyebrow: string;
	summary: string;
	project: string;
	audience: string;
	prerequisite: string;
	priority: string;
	lessons: readonly LearningLesson[];
}

/**
 * Returns the canonical route for the catalogue or one course outline.
 *
 * @param courseId - Optional stable course identifier.
 * @returns Public learning route.
 */
export function learningPath(courseId?: string): string {
	return courseId ? `/framework/learn/${encodeURIComponent(courseId)}` : '/framework/learn';
}

export const learningCourses: readonly LearningCourse[] = [
	{
		id: 'build-your-first-app',
		title: 'Build your first db3 app',
		eyebrow: 'Start here · record first',
		summary: 'Create a db3 app, then extend its private notes starter with collections. Each lesson leaves the app working.',
		project: 'A private notes app with sign-in, note collections, and an optional AI summary.',
		audience: 'Developers new to db3 who know basic TypeScript and Vue.',
		prerequisite: 'Node.js 24+, npm, and a local MariaDB/MySQL instance for the data lessons.',
		priority: 'The first three lessons form a short pilot. Record the rest after the setup path works for a new developer.',
		lessons: [
			{ title: 'What we are building', minutes: 3, summary: 'Show the starter’s private notes and the new collection workflow we will build.', coverage: ['Create, edit, and privately view a note in the finished app.', 'Point out what the starter supplies and what this course will add.'], resource: { label: 'Starter application', articleId: 'starter-app' } },
			{ title: 'Create and run the project', minutes: 8, summary: 'Follow the current creator guide, configure local data, run migrations, and open the app.', coverage: ['Check runtime and database prerequisites before creating the project.', 'Show the expected first screen and one common setup failure.'], resource: { label: 'Create the starter', articleId: 'starter-app' } },
			{ title: 'Find your way around', minutes: 6, summary: 'Trace one request through the Vue client, server route, App services, and test.', coverage: ['Locate client, server, migrations, and tests.', 'Change a small piece of UI copy and confirm the result.'], resource: { label: 'Project structure', articleId: 'project-structure' } },
			{ title: 'Model a collection', minutes: 9, summary: 'Add a collection model and connect notes to it through a migration.', coverage: ['Explain field definitions and logical data types.', 'Generate, apply, and check the migration with local data.'], resource: { label: 'ActiveRecord', articleId: 'active-record' } },
			{ title: 'Build the collection workflow', minutes: 10, summary: 'Connect a Vue form to server routes for creating collections and moving notes into them.', coverage: ['Validate incoming data and return a useful error.', 'Keep ownership decisions on the server and show the saved result in Vue.'], resource: { label: 'Build an application API', articleId: 'guide-api' } },
			{ title: 'Keep collections private', minutes: 8, summary: 'Use authentication and owner-scoped reads for collection and note actions.', coverage: ['Try another account’s collection and note URLs.', 'Explain the authorization boundary and expected denial.'], resource: { label: 'Authentication', articleId: 'auth' } },
			{ title: 'Test the whole feature', minutes: 9, summary: 'Exercise valid input, invalid input, and another user’s collections through the application.', coverage: ['Assert the persisted effect as well as the response.', 'Run the project checks and inspect a failing test.'], resource: { label: 'Testing guide', articleId: 'testing' } },
			{ title: 'Finish and choose a next path', minutes: 5, summary: 'Review the app, run the build, and identify the checks needed before any deployment.', coverage: ['Recap what the learner can now change independently.', 'Preview the AI feature and AI-assisted development courses without assuming a hosting product.'], resource: { label: 'Build an AI feature', articleId: 'ai' } },
		],
	},
	{
		id: 'ai-features',
		title: 'Build AI features into your app',
		eyebrow: 'Dedicated AI path · record second',
		summary: 'Turn the notes app into a useful AI-assisted product feature while keeping data access, failures, and usage visible.',
		project: 'A private note assistant that summarises notes and answers questions using only approved app functions.',
		audience: 'App developers who have completed the starter workflow or know its structure.',
		prerequisite: 'A working db3 app and a provider key configured on the server for optional live demos.',
		priority: 'Begin with the summary and one authorized tool. Add streaming and background work once the basic feature is solid.',
		lessons: [
			{ title: 'Pick a useful AI task', minutes: 5, summary: 'Define the note assistant’s input, expected output, and the cases where it should decline or fail.', coverage: ['Show the user problem and one realistic before/after.', 'Keep the original note as the source of truth.'], resource: { label: 'AI overview', articleId: 'ai' } },
			{ title: 'Add a server-side summary', minutes: 9, summary: 'Use the existing AI service to summarise an owner-authorized note.', coverage: ['Configure the key in server settings and handle a missing key.', 'Load the note by owner before sending content to a provider.'], resource: { label: 'Generate text', articleId: 'ai' } },
			{ title: 'Return dependable output', minutes: 8, summary: 'Use structured generation where the UI needs fields rather than free-form prose.', coverage: ['Define the expected shape and reject unusable output.', 'Keep provider text separate from trusted application instructions.'], resource: { label: 'Structured data', articleId: 'ai-embeddings' } },
			{ title: 'Give an agent one safe tool', minutes: 11, summary: 'Build an agent that can read an approved note through an application-owned function.', coverage: ['Validate tool arguments and constrain the user and scope from the request.', 'Show a denied access attempt and an allowed tool call.'], resource: { label: 'Agents and tools', articleId: 'ai-agents' } },
			{ title: 'Show progress and recover', minutes: 9, summary: 'Stream useful run events, restore a conversation, and explain when to queue longer work.', coverage: ['Show progress, completed output, and provider failure in the UI.', 'Point to saved conversations and worker registration for background runs.'], resource: { label: 'Conversations', articleId: 'ai-conversations' } },
			{ title: 'Test cost and failure boundaries', minutes: 8, summary: 'Test the feature without a paid provider call and inspect recorded usage.', coverage: ['Simulate provider errors and assert no data leaks or partial writes.', 'Review usage records and set application-specific limits before release.'], resource: { label: 'AI usage', articleId: 'ai-usage' } },
		],
	},
	{
		id: 'vibe-code-with-db3',
		title: 'Vibe code with db3',
		eyebrow: 'AI-assisted development · record third',
		summary: 'Use a coding agent to add a real feature to a db3 app, then review and verify what it changed.',
		project: 'Ask a coding agent to add note tags to the same app, then review the data, UI, and tests.',
		audience: 'Developers and product builders using an AI coding assistant with a local checkout.',
		prerequisite: 'A working starter app, source control, and an AI coding assistant of your choice.',
		priority: 'Keep this course short and tool-agnostic. Use one complete change to teach review habits.',
		lessons: [
			{ title: 'Give the agent a bounded task', minutes: 6, summary: 'Describe the note-tagging outcome, constraints, and acceptance checks.', coverage: ['Point the agent to the app instructions and the relevant framework guide.', 'Ask for one slice of work rather than an entire product.'], resource: { label: 'Project structure', articleId: 'project-structure' } },
			{ title: 'Inspect the proposed change', minutes: 8, summary: 'Review the model, migration, route, and UI changes against the public framework APIs.', coverage: ['Check that data access stays on the server and uses the current user.', 'Catch invented imports, unnecessary abstractions, and missing migration work.'], resource: { label: 'Project structure', articleId: 'project-structure' } },
			{ title: 'Run the app together', minutes: 8, summary: 'Test the new feature in a browser and use concrete failures to guide the next edit.', coverage: ['Try adding, removing, and filtering tags.', 'Record the observed bug and ask for a focused repair.'], resource: { label: 'Build an application API', articleId: 'guide-api' } },
			{ title: 'Prove the boundaries', minutes: 9, summary: 'Run checks and test another account, invalid input, and migration behavior.', coverage: ['Keep framework and app behavior real while simulating external providers.', 'Compare the changed files and test results to the acceptance checks.'], resource: { label: 'Testing guide', articleId: 'testing' } },
			{ title: 'Keep or revert with confidence', minutes: 5, summary: 'Review the final diff, write down what passed, and commit only the intended change.', coverage: ['Separate local checks from any deployment claim.', 'Show how to revert the feature cleanly if its behavior is not right.'], resource: { label: 'Testing guide', articleId: 'testing' } },
		],
	},
];

/**
 * Finds a published outline by its stable course identifier.
 *
 * @param courseId - Course slug from the URL.
 * @returns Matching outline, or null for an unknown course.
 */
export function findLearningCourse(courseId: string): LearningCourse | null {
	return learningCourses.find(course => course.id === courseId) ?? null;
}

/**
 * Totals the proposed recording time for one course.
 *
 * @param course - Course whose lesson estimates should be summed.
 * @returns Approximate number of minutes.
 */
export function learningMinutes(course: LearningCourse): number {
	return course.lessons.reduce((total, lesson) => total + lesson.minutes, 0);
}
