import { articleSections } from './articleContent';
import { serviceExampleOutputs, serviceExampleSources } from './generated/service-examples';
import { activeRecordArticle } from './articles/activeRecord';
import { activeRecordApiArticle } from './articles/activeRecordApi';
import { workspaceNotesArticle } from './articles/workspaceNotes';
import { problemRecipesArticle } from './articles/problemRecipes';
import { appArticle, firstAppArticle, installationArticle } from './articles/gettingStarted';
import { authArticle } from './articles/auth';
import { storageArticle } from './articles/storage';
import { apiWorkflowArticle, authApiArticle, authWorkflowArticle } from './articles/starterWorkflows';
import { backgroundArticle, retriesArticle, schedulerApiArticle } from './articles/backgroundWork';
import { flowsApiArticle, flowsArticle } from './articles/flows';
import { serializationApiArticle, serializationArticle, ssrApiArticle, ssrArticle, urlApiArticle, urlArticle } from './articles/runtimeServices';
import { mediaApiArticle, privateFilesArticle, storageApiArticle, streamsArticle } from './articles/fileWorkflows';
import { mediaArticle } from './articles/media';
import { schedulerArticle } from './articles/scheduler';
import { starterAppArticle } from './articles/starterApp';
import { queueGuideSections, queueGuideSamples, queueGuideEvidence, queueGuidePaths } from './articles/queueGuide';
import { queueApiArticle } from './articles/queueApi';
import { appConfigArticle, configApiArticle, configArticle } from './articles/config';
import { introductionArticle } from './articles/introduction';
import { inAppArticle, inAppApiArticle } from './articles/inApp';
import { websocketArticle, websocketApiArticle } from './articles/websocket';
import { realtimeTutorials } from './articles/realtime';
import { mailApiArticle, mailArticle } from './articles/mail';
import { validationApiArticle, validationArticle } from './articles/validation';
import { cacheApiArticle, cacheArticle } from './articles/cache';
import { appsArticle, appsApiArticle } from './articles/apps';
import { eventsApiArticle, eventsArticle } from './articles/events';
import { loggingApiArticle, loggingArticle } from './articles/logging';
import { securityApiArticle, securityArticle } from './articles/security';
import { encryptedFieldsArticle, fieldsApiArticle, fieldsArticle, queriesArticle } from './articles/fieldNotes';
import { migrationsApiArticle, migrationsArticle } from './articles/migrations';
import { modelDataArticle, transactionsArticle } from './articles/dataRecipes';
import { apiIndexArticle, appApiArticle, packageAppArticle, packagePureArticle, testingArticle, testingWorkflowArticle } from './articles/qualityAndPackages';
import { aiApiArticle, aiArticles } from './articles/ai';
import { serviceLabEvidence, serviceLabSamples, serviceLabTesting } from './articles/serviceLab';

/**
 * Stable identifiers for the primary documentation destinations.
 */
export type DocAreaId = 'start' | 'ai' | 'guides' | 'services' | 'cookbook' | 'examples' | 'api';

/**
 * One primary destination shown in the global documentation rail.
 */
export interface DocArea {
	id: DocAreaId;
	label: string;
	description: string;
}

/**
 * One step in a short task-oriented guide overview.
 */
export interface DocGuideStep {
	title: string;
	description: string;
}

/**
 * One source sample rendered by the shared DOM Studio code viewer.
 */
export interface DocCodeSample {
	id: string;
	title: string;
	language: string;
	code: string;
	/** Deterministic output rendered beside the imported example source. */
	output?: string;
	/** Syntax language used to render the example output. */
	outputLanguage?: string;
	/** Short ordered explanation of the important runtime behaviour. */
	explanation?: string[];
}

/**
 * One prose section inside a documentation article.
 */
export interface DocContentSection {
	id: string;
	title: string;
	paragraphs: string[];
	codeSampleId?: string;
	/** Optional explanatory visual rendered alongside the canonical prose. */
	visual?: 'framework-vision';
	/** Heading depth used by long-form service documentation. */
	level?: 2 | 3;
	/** Related current articles or precise reference sections, never dead TODO links. */
	links?: DocSectionLink[];
}

/** A registered documentation destination shown beside the relevant explanation. */
export type DocSectionLink = {
	/** Text describing what the reader will find. */
	label: string;
	/** Canonical article identifier, checked by the documentation tests. */
	articleId: string;
	/** Optional section anchor inside the destination article. */
	sectionId?: string;
	href?: never;
} | {
	/** Text identifying an authoritative external source. */
	label: string;
	/** Absolute HTTPS source URL, checked by documentation tests. */
	href: string;
	articleId?: never;
	sectionId?: never;
};

/**
 * Behavioural-test evidence shown beside an executable documentation example.
 */
export interface VerifiedExample {
	/** Observable workflow executed by the referenced test. */
	description: string;
	/** Service-owned behavioural test that supplies the verification evidence. */
	testPath: string;
	/** Focused command a reader can run from the repository root. */
	command: string;
	/** Stable behavioural outcome readers should expect from the test. */
	expectedOutput: string;
	/** Runtime or controlled dependency assumptions required by the test. */
	environment: string;
}

/**
 * Searchable documentation article assembled by the docs application.
 */
export interface DocArticle {
	id: string;
	area: DocAreaId;
	group: string;
	label: string;
	title: string;
	summary: string;
	packageName: string;
	sourcePath: string;
	/** Whether both page formats link to the supporting public service reference; defaults to true. Required instructions belong in sections. */
	includeSourceDocument?: boolean;
	/** Package-relative emitted declarations explicitly rendered by this reference. */
	declarationPaths?: string[];
	/** Service-owned example files rendered by this article. */
	examplePaths?: string[];
	/** Behaviour test that executes the documented workflow. */
	testPath?: string;
	/** Additional tests for other examples on the page, separate from its primary verified workflow. */
	additionalTestPaths?: string[];
	steps?: DocGuideStep[];
	sections: DocContentSection[];
	codeSamples?: DocCodeSample[];
	verifiedExample?: VerifiedExample;
	relatedIds?: string[];
	keywords?: string[];
}

/**
 * Group of articles displayed together in contextual navigation.
 */
export interface DocNavigationGroup {
	title: string;
	articles: DocArticle[];
}

/**
 * Previous and next destinations surrounding one article.
 */
export interface DocArticleNavigation {
	previous: DocArticle | null;
	next: DocArticle | null;
}

/**
 * Search command consumed by DOM Studio's keyboard-first command palette.
 */
export interface DocumentationCommand {
	value: string;
	label: string;
	description: string;
	keywords: string[];
}

export const docAreas: DocArea[] = [
	{ id: 'start', label: 'Start', description: 'Install the framework and build a first application.' },
	{ id: 'ai', label: 'AI', description: 'Build AI features inside your application.' },
	{ id: 'guides', label: 'Guides', description: 'Follow complete workflows from request to result.' },
	{ id: 'services', label: 'Services', description: 'Explore every reusable framework service.' },
	{ id: 'cookbook', label: 'Cookbook', description: 'Solve common application and operations problems.' },
	{ id: 'examples', label: 'Examples', description: 'Inspect tested, source-backed framework examples.' },
	{ id: 'api', label: 'API', description: 'Browse package contracts and public exports.' },
];

const queueExamplePaths: string[] = [
	'packages/app/src/queue/examples/GenerateReportJob.ts',
	'packages/app/src/queue/examples/createAndProcessReportJob.ts',
	'packages/app/src/queue/examples/dispatchReportWorkflows.ts',
	'packages/app/src/queue/examples/manageReportRetries.ts',
];
const queueExampleOutputPaths: string[] = [
	'packages/app/src/queue/examples/outputs/create-and-process-report-job.json',
	'packages/app/src/queue/examples/outputs/dispatch-report-workflows.json',
	'packages/app/src/queue/examples/outputs/manage-report-retries.json',
];
const queueExampleTestPath = 'packages/app/src/queue/tests/examples/createAndProcessReportJob.test.ts';
const queueVerifiedExample: VerifiedExample = {
	description: 'Executes the imported Queue examples through the real Queue service with a deterministic service-owned driver.',
	testPath: queueExampleTestPath,
	command: 'npm test --workspace packages/app -- src/queue/tests/examples/createAndProcessReportJob.test.ts',
	expectedOutput: '3 tests pass · dispatch, chain, batch, retry policy, and replay are exercised',
	environment: 'Node.js · deterministic in-memory queue driver',
};

const queueOverviewArticle: DocArticle = {
	id: 'queue-overview',
	area: 'services',
	group: 'Application',
	label: 'Queue',
	title: 'Process work outside requests',
	summary: 'Queue provides durable background jobs with database or Redis storage, named worker pools, retries, attempt leases, chains, batches, and persisted failure history.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/README.md',
	examplePaths: [...queueExamplePaths, ...queueExampleOutputPaths],
	testPath: queueExampleTestPath,
	steps: [
		{ title: 'Model durable work', description: 'Put JSON-safe application identity in a QueueableJob.' },
		{ title: 'Dispatch the job', description: 'Choose its queue, delay, and retry policy.' },
		{ title: 'Run workers', description: 'Register jobs and process the matching named queue.' },
	],
	sections: [
		{
			id: 'when-to-use-queue',
			title: 'When to use Queue',
			paragraphs: [
				'Use Queue when work must survive the request that created it, may need retries, or should run in a separate worker process. Typical jobs include AI requests, email delivery, file processing, imports, and expensive report generation.',
				'Use Events for immediate in-process reactions. Use Scheduler to decide when recurring work becomes due. Use Flows when several durable steps need explicit orchestration and observable state. Scheduler and Flows may dispatch Queue jobs, but they do not replace the Queue lifecycle.',
			],
		},
		{
			id: 'two-job-shapes',
			title: 'The two job shapes',
			paragraphs: [
				'QueueableJob is the application-authored definition: constructor data, serialization, handle logic, and optional failure hooks. QueueJob is the driver-created runtime record: queue identity, driver id, attempt count, and the durable payload envelope.',
				'Keeping these roles separate gives job authors a small new `MyJob(data)` API while preserving the metadata workers need for claiming, retries, lease fencing, monitoring, and results.',
			],
		},
		{
			id: 'first-job',
			title: 'A complete first job',
			paragraphs: [
				'Register job classes during worker startup, dispatch constructed instances from application code, and let each worker restore a fresh instance before `handle()` runs. The imported example below uses the same public subpath imports an application uses.',
			],
			codeSampleId: 'queue-first-job',
		},
		{
			id: 'drivers-and-workers',
			title: 'Drivers, queues, and workers',
			paragraphs: [
				'The database driver is the straightforward default and stores active and failed jobs through the application database. The Redis driver keeps the same Queue API while using ready lists, delayed and reserved sets, a job hash, and persisted failure storage.',
				'Named queues separate workloads that need different concurrency or resources. Dispatch to a name such as reports, then run workers for that same name with queue:work --queue=reports. A worker processes only its configured queue.',
			],
		},
	],
	codeSamples: [
		{
			id: 'queue-first-job',
			title: 'createAndProcessReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.createAndProcessReportJob,
		},
	],
	verifiedExample: queueVerifiedExample,
	relatedIds: ['queue-creating-jobs', 'queue-lifecycle', 'queue-chains', 'queue-failures'],
	keywords: ['queue background jobs database redis worker durable asynchronous'],
};

const queueJobArticle: DocArticle = {
	id: 'queue-creating-jobs',
	area: 'services',
	group: 'Application',
	label: 'Creating jobs',
	title: 'Dispatch a queued job',
	summary: 'Jobs encapsulate discrete units of work that can be processed asynchronously. When dispatched, a job is serialized, restored for every attempt, and executed through `handle()`.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/README.md',
	examplePaths: queueExamplePaths.slice(0, 2),
	testPath: queueExampleTestPath,
	steps: [
		{ title: 'Create a job class', description: 'Define the data and handle logic.' },
		{ title: 'Register and dispatch', description: 'Push the job onto a queue for processing.' },
		{ title: 'Process the job', description: 'A worker restores the job and runs `handle()`.' },
	],
	sections: [
		{
			id: 'create-job-class',
			title: '1. Create a job class',
			paragraphs: [
				'Application jobs extend QueueableJob and own one JSON-safe data object. Store stable identifiers and input values rather than open connections, service instances, request objects, streams, or other process-local state.',
				'Validate durable data in the constructor. The same constructor runs after every rehydration, so corrupt or obsolete payloads fail before application work starts. Most jobs can use the inherited `toJSON()` and `fromJSON()` implementations.',
			],
			codeSampleId: 'job-class',
		},
		{
			id: 'dispatch-job',
			title: '2. Register and dispatch the job',
			paragraphs: [
				'Register each job class during worker startup. Application code dispatches a constructed instance, so the durable payload and runtime object stay aligned. Dispatch also auto-registers the instance in the current process, but separate worker processes still need startup registration or a jobResolver.',
			],
			codeSampleId: 'dispatch-job',
		},
		{
			id: 'dispatch-options',
			title: '3. Choose dispatch options deliberately',
			paragraphs: [
				'DispatchOptions can select a named queue, delay initial availability, set maximum attempts, configure backoff, limit the retry window, and attach framework-owned origin metadata. Keep business identifiers inside job data and orchestration correlation inside origin.',
				'Named queues matter operationally: a job dispatched to reports will wait until a reports worker is running. They are a capacity boundary, not merely a label.',
			],
		},
		{
			id: 'handle-job',
			title: '4. Handle the restored job',
			paragraphs: [
				'For each attempt, Queue reads the persisted data, constructs a new job instance, and calls `handle()`. Resolve ordinary application services through `app()` inside the handler. The optional context argument is reserved for queue runtime metadata such as the claimed record and processing Queue.',
				'Make handlers safe to retry. A worker can lose its lease after external work succeeds, so application writes and provider calls should use idempotency keys, state checks, or transactions where appropriate.',
			],
		},
	],
	codeSamples: [
		{
			id: 'job-class',
			title: 'TypeScript',
			language: 'typescript',
			code: serviceExampleSources.generateReportJob,
		},
		{
			id: 'dispatch-job',
			title: 'TypeScript',
			language: 'typescript',
			code: serviceExampleSources.createAndProcessReportJob,
		},
	],
	verifiedExample: queueVerifiedExample,
	relatedIds: ['queue-overview', 'queue-lifecycle', 'queue-chains', 'queue-failures'],
	keywords: ['queue worker background job'],
};

const queueLifecycleArticle: DocArticle = {
	id: 'queue-lifecycle',
	area: 'services',
	group: 'Application',
	label: 'Job lifecycle',
	title: 'Understand job attempts',
	summary: 'Follow one job from serialization and durable storage through claiming, fresh rehydration, lease renewal, success, retry, deferral, or terminal failure.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/Queue.ts',
	examplePaths: queueExamplePaths.slice(0, 2),
	testPath: queueExampleTestPath,
	steps: [
		{ title: 'Persist', description: 'Serialize application data into a durable envelope.' },
		{ title: 'Claim and restore', description: 'Lease one record and build a fresh job instance.' },
		{ title: 'Commit an outcome', description: 'Delete, release, defer, fail, or report lease loss.' },
	],
	sections: [
		{
			id: 'dispatch-and-persist',
			title: '1. Dispatch and persist',
			paragraphs: [
				'Queue serializes the QueueableJob into a payload containing its durable job name, display name, JSON-safe data, retry policy, UUID, optional origin, and any remaining chain. The driver adds its own record id, queue name, availability time, and reservation state.',
				'The job class itself is never persisted. Deploy worker code that can resolve every durable job name currently present in storage before removing or renaming that class.',
			],
		},
		{
			id: 'claim-and-rehydrate',
			title: '2. Claim and rehydrate',
			paragraphs: [
				'A worker asks its driver for one available job. Claiming increments the attempt count and creates a time-limited reservation. Queue resolves the registered class and calls `fromJSON()` to create a fresh instance from payload.data.',
				'Fresh instances prevent accidental process memory from leaking between attempts. Constructor validation, `handle()`, `onRetry()`, and `onFinalFailure()` operate on the same rehydrated instance for that attempt.',
			],
			codeSampleId: 'lifecycle-job',
		},
		{
			id: 'leases-and-heartbeats',
			title: '3. Renew the attempt lease',
			paragraphs: [
				'Long-running handlers receive periodic lease heartbeats at roughly one third of retryAfterSeconds. Before Queue records success, release, deferral, or failure, it verifies that the same attempt still owns the durable record.',
				'If ownership is lost, Queue returns lease_lost and does not mutate the newer owner. Treat that result as an ambiguity boundary: the handler may already have produced external effects even though this worker cannot commit the queue outcome.',
			],
		},
		{
			id: 'attempt-outcomes',
			title: '4. Commit one outcome',
			paragraphs: [
				'Success dispatches the next chained job, deletes the completed record, and publishes a succeeded event. An ordinary error releases the job with its persisted backoff when more attempts remain. QueueRetryLaterError defers without consuming the attempt. Exhausted retries move the record into failed storage.',
				'`workNextJob()` returns succeeded, released, deferred, failed, or lease_lost. It returns null only when no job was available on the requested queue.',
			],
			codeSampleId: 'lifecycle-process',
		},
	],
	codeSamples: [
		{
			id: 'lifecycle-job',
			title: 'GenerateReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.generateReportJob,
		},
		{
			id: 'lifecycle-process',
			title: 'createAndProcessReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.createAndProcessReportJob,
		},
	],
	verifiedExample: queueVerifiedExample,
	relatedIds: ['queue-overview', 'queue-creating-jobs', 'queue-failures'],
	keywords: ['queue lifecycle attempt claim lease heartbeat rehydrate succeeded released deferred failed'],
};

const queueChainsArticle: DocArticle = {
	id: 'queue-chains',
	area: 'services',
	group: 'Application',
	label: 'Chains & batches',
	title: 'Compose background work',
	summary: 'Run dependent jobs in order with chains, or dispatch independent jobs together with batches, while application models retain visible workflow progress.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/Queue.ts',
	examplePaths: ['packages/app/src/queue/examples/dispatchReportWorkflows.ts'],
	testPath: queueExampleTestPath,
	steps: [
		{ title: 'Choose dependency', description: 'Decide whether jobs must wait for one another.' },
		{ title: 'Dispatch the shape', description: 'Use chain for order or batch for independence.' },
		{ title: 'Track product state', description: 'Persist progress on the application model.' },
	],
	sections: [
		{
			id: 'chains',
			title: 'Use chains for dependent work',
			paragraphs: [
				'`queue.chain()` persists only the first job. Each successful job dispatches the next serialized job onto the same named queue. A released or deferred attempt pauses the chain, and a terminal failure prevents the remaining jobs from being dispatched.',
				'Jobs may also call `chain()` on themselves or override `defaultChain()` when the sequence is intrinsic to that job type. Prefer the queue service call when application orchestration chooses the sequence.',
			],
			codeSampleId: 'workflow-dispatch',
		},
		{
			id: 'batches',
			title: 'Use batches for independent work',
			paragraphs: [
				'`queue.batch()` dispatches every job independently and returns every driver-owned id. Workers can process the jobs in any order and failures do not prevent siblings from running.',
				'A batch is dispatch convenience, not a durable batch aggregate. If the product must show total, processing, completed, and failed counts, store that state on an application model or use a Flow when the orchestration itself needs a durable record.',
			],
		},
		{
			id: 'choose-a-shape',
			title: 'Choose the smallest useful shape',
			paragraphs: [
				'Use one job when one retry boundary is enough. Use a chain when later work is invalid until earlier work succeeds. Use a batch when jobs are independent and parallelism is useful. Use a Flow when branches, nested steps, replay, or an inspectable graph are part of the product requirement.',
			],
		},
		{
			id: 'job-registration',
			title: 'Register every job in worker processes',
			paragraphs: [
				'All classes that can appear in a chain must be resolvable when a worker reaches them. Register those classes during boot or configure a jobResolver. This is especially important after deployment because chained payloads may outlive the process that dispatched them.',
			],
		},
	],
	codeSamples: [
		{
			id: 'workflow-dispatch',
			title: 'dispatchReportWorkflows.ts',
			language: 'typescript',
			code: serviceExampleSources.dispatchReportWorkflows,
		},
	],
	verifiedExample: queueVerifiedExample,
	relatedIds: ['queue-overview', 'queue-creating-jobs', 'queue-lifecycle', 'flows'],
	keywords: ['queue chain batch pipeline parallel workflow orchestration'],
};

const queueFailuresArticle: DocArticle = {
	id: 'queue-failures',
	area: 'services',
	group: 'Application',
	label: 'Retries & failures',
	title: 'Recover failed work',
	summary: 'Configure durable retry policies, defer provider backpressure without consuming attempts, observe hooks, inspect terminal failures, and replay work without erasing its audit record.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/README.md',
	examplePaths: ['packages/app/src/queue/examples/manageReportRetries.ts'],
	testPath: queueExampleTestPath,
	steps: [
		{ title: 'Classify the failure', description: 'Separate ordinary errors from intentional backpressure.' },
		{ title: 'Apply durable policy', description: 'Persist attempts, backoff, and retry horizon.' },
		{ title: 'Inspect and replay', description: 'Preserve failed history while dispatching a replacement.' },
	],
	sections: [
		{
			id: 'ordinary-retries',
			title: 'Ordinary failures consume attempts',
			paragraphs: [
				'When `handle()` throws an ordinary error, Queue releases the job if `maxTries` and `retryUntil` still allow another attempt. The supported strategies are `linear` and `exponential`. For a constant delay, set `initialSeconds` and `maxSeconds` to the same value; there is no `fixed` strategy.',
				'Use jitter when many jobs may fail together, and set retryUntilSeconds when an old result stops being useful even if attempts remain. Application handlers should throw the original meaningful error so failed storage and diagnostics remain useful.',
			],
			codeSampleId: 'retry-management',
		},
		{
			id: 'provider-backpressure',
			title: 'Provider backpressure does not consume an attempt',
			paragraphs: [
				'Throw QueueRetryLaterError when a provider explicitly asks the application to wait, such as a Retry-After response. Queue restores the claimed attempt and defers availability by the requested number of seconds.',
				'Do not use deferral for ordinary bugs or unknown failures. A job that can defer forever needs an application-owned deadline or state check so provider outages do not create immortal work.',
			],
		},
		{
			id: 'retry-hooks',
			title: 'Observe retries and terminal failure',
			paragraphs: [
				'Override `onRetry()` after Queue has safely released an ordinary failed attempt. Override `onFinalFailure()` after the driver has durably recorded terminal failure. Hook errors are reported through onLifecycleError and do not reverse the queue transition.',
				'Use hooks for diagnostics or small application state updates. Keep the main recovery contract in durable application data rather than depending on a hook to make the queue transition valid.',
			],
		},
		{
			id: 'inspect-and-replay',
			title: 'Inspect and replay terminal failures',
			paragraphs: [
				'`failedJobs()` returns recent driver-owned terminal records without exposing database tables or Redis keys. `retryFailed()` dispatches a new active job with a new UUID and retryOf metadata pointing to the failed record.',
				'The original failed record remains untouched for audit. Replaying is therefore a new attempt chain, not deletion or mutation of history. Confirm the underlying application state still permits the operation before replaying old work.',
			],
		},
	],
	codeSamples: [
		{
			id: 'retry-management',
			title: 'manageReportRetries.ts',
			language: 'typescript',
			code: serviceExampleSources.manageReportRetries,
		},
	],
	verifiedExample: queueVerifiedExample,
	relatedIds: ['queue-overview', 'queue-lifecycle', 'queue-chains'],
	keywords: ['queue retry retries failed failure backoff defer backpressure retry later replay failedJobs retryFailed'],
};

const queueArticle: DocArticle = {
	...queueOverviewArticle,
	title: 'Queue',
	summary: 'Create a job in your app, dispatch it from a route or service, and let a worker handle it in the background.',
	examplePaths: [...queueExamplePaths, ...queueExampleOutputPaths, ...queueGuidePaths],
	testPath: queueGuideEvidence.testPath,
	verifiedExample: queueGuideEvidence,
	sections: [
		...queueGuideSections.filter(section => section.id.startsWith('app-')),
		{
			id: 'when-to-use-queue',
			title: 'When to use Queue',
			paragraphs: queueOverviewArticle.sections[0].paragraphs,
			level: 2,
		},
		{
			id: 'queue-mental-model',
			title: 'QueueableJob and QueueJob',
			paragraphs: queueOverviewArticle.sections[1].paragraphs,
			level: 3,
		},
		{
			id: 'drivers-and-workers',
			title: 'Drivers and named queues',
			paragraphs: queueOverviewArticle.sections[3].paragraphs,
			level: 3,
		},
		{
			id: 'creating-jobs',
			title: 'Creating jobs',
			paragraphs: queueJobArticle.sections[0].paragraphs,
			codeSampleId: 'job-class',
			level: 2,
		},
		{
			id: 'register-and-dispatch',
			title: 'Register and dispatch',
			paragraphs: queueJobArticle.sections[1].paragraphs,
			codeSampleId: 'dispatch-job',
			level: 3,
		},
		{
			id: 'dispatch-options',
			title: 'Dispatch options',
			paragraphs: queueJobArticle.sections[2].paragraphs,
			level: 3,
		},
		{
			id: 'job-lifecycle',
			title: 'Job lifecycle',
			paragraphs: queueLifecycleArticle.sections[0].paragraphs,
			level: 2,
		},
		{
			id: 'claim-and-rehydrate',
			title: 'Claim and rehydrate',
			paragraphs: queueLifecycleArticle.sections[1].paragraphs,
			level: 3,
		},
		{
			id: 'leases-and-heartbeats',
			title: 'Leases and heartbeats',
			paragraphs: queueLifecycleArticle.sections[2].paragraphs,
			level: 3,
		},
		{
			id: 'attempt-outcomes',
			title: 'Attempt outcomes',
			paragraphs: queueLifecycleArticle.sections[3].paragraphs,
			level: 3,
		},
		{
			id: 'chains-and-batches',
			title: 'Chains and batches',
			paragraphs: queueChainsArticle.sections[2].paragraphs,
			codeSampleId: 'workflow-dispatch',
			level: 2,
		},
		{
			id: 'chains',
			title: 'Dependent work with chains',
			paragraphs: [...queueChainsArticle.sections[0].paragraphs, 'The successor is dispatched before the predecessor is deleted. These are separate operations, so a crash or lost lease between them can duplicate the successor. Chains are not an atomic workflow handoff; make every step repeatable and reconcile important business state.'],
			level: 3,
		},
		{
			id: 'batches',
			title: 'Independent work with batches',
			paragraphs: [...queueChainsArticle.sections[1].paragraphs, '`batch()` pushes jobs sequentially, not in one transaction. If dispatch throws partway through, earlier jobs remain queued. It supplies no all-or-nothing enqueue, completion callback, cancellation or aggregate progress record.'],
			level: 3,
		},
		{
			id: 'register-chained-jobs',
			title: 'Register every chained job',
			paragraphs: queueChainsArticle.sections[3].paragraphs,
			level: 3,
		},
		{
			id: 'retries-and-failures',
			title: 'Retries and failures',
			paragraphs: queueFailuresArticle.sections[0].paragraphs,
			codeSampleId: 'retry-management',
			level: 2,
		},
		{
			id: 'provider-backpressure',
			title: 'Provider backpressure',
			paragraphs: queueFailuresArticle.sections[1].paragraphs,
			level: 3,
		},
		{
			id: 'retry-hooks',
			title: 'Retry and final-failure hooks',
			paragraphs: queueFailuresArticle.sections[2].paragraphs,
			level: 3,
		},
		{
			id: 'inspect-and-replay',
			title: 'Inspect and replay failures',
			paragraphs: queueFailuresArticle.sections[3].paragraphs,
			level: 3,
		},
		{
			id: 'testing-and-ownership',
			title: 'Testing and module ownership',
			paragraphs: [
				'Queue owns its contracts, drivers, documentation, examples, behaviour tests, integration tests, fixtures, and test support. Application jobs remain in the consuming app because their payload and handle logic express product behaviour.',
				'The examples on this page are imported from `packages/app/src/queue/examples`. The displayed outputs are checked by tests beside those examples. Use the copied tests in your app when you change a job.',
			],
			level: 2,
		},
		...queueGuideSections.filter(section => !section.id.startsWith('app-')),
	],
	codeSamples: [
		...queueGuideSamples,
		{
			id: 'job-class',
			title: 'GenerateReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.generateReportJob,
			explanation: [
				'The constructor validates the same durable data used after rehydration.',
				'Only JSON-safe application identity is persisted in the queue payload.',
				'`handle()` resolves normal services from the active application context.',
			],
		},
		{
			id: 'dispatch-job',
			title: 'createAndProcessReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.createAndProcessReportJob,
			output: serviceExampleOutputs.createAndProcessReportJob,
			outputLanguage: 'json',
			explanation: [
				'The worker registers the job class before it claims stored work.',
				'Dispatch persists the job data and returns the driver-owned id.',
				'`workNextJob()` restores a fresh instance and returns the attempt status.',
			],
		},
		{
			id: 'workflow-dispatch',
			title: 'dispatchReportWorkflows.ts',
			language: 'typescript',
			code: serviceExampleSources.dispatchReportWorkflows,
			output: serviceExampleOutputs.dispatchReportWorkflows,
			outputLanguage: 'json',
			explanation: [
				'The chain initially persists one job and dispatches its successor only after success.',
				'The batch persists both independent jobs immediately on the reports queue.',
				'Visible aggregate progress still belongs on an application model or Flow.',
			],
		},
		{
			id: 'retry-management',
			title: 'manageReportRetries.ts',
			language: 'typescript',
			code: serviceExampleSources.manageReportRetries,
			output: serviceExampleOutputs.manageReportRetries,
			outputLanguage: 'json',
			explanation: [
				'Ordinary failures consume attempts and use the persisted exponential backoff policy.',
				'QueueRetryLaterError carries provider backpressure without consuming an ordinary attempt.',
				'Replay creates a replacement job while preserving the original failed audit record.',
			],
		},
	],
	relatedIds: ['queue-api', 'starter-app', 'scheduler', 'storage', 'example-queue'],
	keywords: ['queue background job jobs worker lifecycle chain batch retry failure backoff replay lease redis database'],
};

const projectStructureArticle: DocArticle = {
	id: 'project-structure',
	area: 'start',
	group: 'Get started',
	label: 'Project structure',
	title: 'Your application structure',
	summary: 'Keep the generated app independent. Add product code and tests in your app; import shared services from the framework package.',
	packageName: '@db3.ai/app',
	sourcePath: 'apps/starter/README.md',
	includeSourceDocument: false,
	steps: [
		{ title: 'Start with your app', description: 'The creator gives you server, UI, database and test files.' },
		{ title: 'Add a feature', description: 'Keep its model, route, UI and behaviour test together in the app.' },
		{ title: 'Use framework services', description: 'Import supported APIs from @db3.ai/app subpaths.' },
	],
	sections: [
		{
			id: 'standalone', title: 'The generated starter is an ordinary app',
			paragraphs: ['You do not need the framework monorepo or a packages directory. The creator gives you the structure below. `server/config.ts` reads settings, `server/app.ts` creates the framework App, `server/http/createServer.ts` owns routes, and `server/index.ts` owns the process.', 'Add your model under `server/models`, register it in `server/database/models.ts` and generate a migration under `server/database/migrations`. Change the UI under `client` and add behaviour tests under `tests`. The starter guide runs that complete first change.'],
			codeSampleId: 'starter-layout', links: [{ label: 'Create and extend the starter', articleId: 'starter-app' }, { label: 'A smaller HTTP-only layout', articleId: 'create-app', sectionId: 'layout' }],
		},
		{
			id: 'apps-own-products',
			title: 'Apps own product behaviour',
			paragraphs: [
				'Keep routes, product models, screens, prompts, application jobs, and business orchestration inside the consuming app. Framework packages should provide reusable mechanics and stable contracts without absorbing one product’s policy.',
				'This boundary keeps apps easy to understand and prevents the framework from becoming a second application hidden behind generic names.',
			],
			links: [{ label: 'Extend the starter', articleId: 'starter-app' }, { label: 'Model your data', articleId: 'guide-model-data' }, { label: 'Build an API', articleId: 'guide-api' }],
		},
	],
	codeSamples: [
		{ id: 'starter-layout', title: 'Your generated app', language: 'text', code: 'my-app/\n\tpackage.json\n\t.env.example\n\tdocker-compose.yml\n\tclient/\n\t\tApp.vue\n\t\tapi.ts\n\tserver/\n\t\tconfig.ts\n\t\tcli.config.ts\n\t\tapp.ts\n\t\tindex.ts\n\t\thttp/createServer.ts\n\t\tmodels/Note.ts\n\t\tdatabase/\n\t\t\tmodels.ts\n\t\t\tmigrations/\n\t\t\tschema.snapshot.json\n\ttests/\n\t\tapp.test.ts\n\t\taiAllowance.test.ts' },
	],
	relatedIds: ['starter-app', 'app-config', 'guide-model-data', 'guide-api'],
	keywords: ['project structure application folders models routes migrations tests'],
};

const queueExamplesArticle: DocArticle = {
	id: 'example-queue',
	area: 'examples',
	group: 'Verified examples',
	label: 'Queue jobs',
	title: 'Build and operate queued work',
	summary: 'Follow the complete imported Queue example set: define durable data, register and process a job, compose chains and batches, configure retry policy, defer backpressure, and replay terminal failures.',
	packageName: '@db3.ai/app/queue',
	sourcePath: 'packages/app/src/queue/examples',
	examplePaths: [...queueExamplePaths, ...queueExampleOutputPaths, 'packages/app/src/queue/examples/runQueueWorkflows.ts'],
	testPath: 'packages/app/src/queue/tests/examples/runQueueWorkflows.test.ts',
	additionalTestPaths: [queueExampleTestPath],
	steps: [
		{ title: 'Define', description: 'Create a validated, JSON-safe QueueableJob.' },
		{ title: 'Compose', description: 'Dispatch one job, a chain, or an independent batch.' },
		{ title: 'Recover', description: 'Apply backoff, defer backpressure, and replay failures.' },
	],
	sections: [
		{ id: 'setup', title: 'Run the installed SQL example', paragraphs: ['Complete Installation’s tarball/development setup and dedicated SQL test account first. Copy the shipped Queue examples below. These are application helper functions, not self-starting commands; the runner constructs the App, installs a disposable schema, registers the job and cleans up.', 'The job logs a report identity. For real file-backed report generation, start with the Queue guide. The deterministic output panels farther down illustrate deterministic in-memory tests; the SQL runner gives the actual independent-consumer result.'], codeSampleId: 'copy-lab', links: [{ label: 'SQL prerequisites', articleId: 'installation', sectionId: 'database-labs' }, { label: 'Generate a file-backed report', articleId: 'queue-overview' }] },
		{ id: 'run', title: 'Compare chain and batch behavior', paragraphs: ['Run from your independent app root. Expect empty-chain rejection with zero writes, one initial chain job, one remaining successor after its predecessor, two immediate batch jobs, four successful outcomes and zero jobs left.'], codeSampleId: 'run-lab' },
		{ id: 'sql-runner', title: 'Inspect the complete application runner', paragraphs: ['The bounded calls deliberately process this lab’s known jobs. A production queue needs registered workers and an application idempotency policy; this demonstration does not guarantee atomic chain handoff after a crash.'], codeSampleId: 'sql-runner-source' },
		serviceLabTesting('queue', 'runQueueWorkflows'),
		{ id: 'run-tests', title: 'Run and extend the consumer test', paragraphs: ['Save the exact test in the documented folder, then change the report identities or add one batch job. Keep the invalid-input and final-queue assertions.'], codeSampleId: 'test-lab' },
		{ id: 'coverage', title: 'Coverage and related recovery', paragraphs: ['This consumer scenario proves real SQL chaining, batch dispatch, queue counts and empty-input recovery. Advanced lease loss, retry state, failure retention and provider backpressure have their own tests and guides. It does not prove Redis conformance or deployment crash safety.'], links: [{ label: 'Backpressure and deadlines', articleId: 'cookbook-retries' }, { label: 'Detailed Queue API', articleId: 'queue-api' }] },
		{
			id: 'example-job-definition',
			title: '1. Define the job',
			paragraphs: [
				'The constructor validates the same durable data supplied by application code and restored by workers. `handle()` resolves ordinary services from the active application.',
			],
			codeSampleId: 'example-job',
		},
		{
			id: 'example-dispatch',
			title: '2. Register, dispatch, and process',
			paragraphs: [
				'The worker process registers the class before it claims persisted work. The dispatching process constructs the job, and `workNextJob()` exposes the detailed attempt outcome.',
			],
			codeSampleId: 'example-dispatch-code',
		},
		{
			id: 'example-workflows',
			title: '3. Chain dependent work or batch independent work',
			paragraphs: [
				'The pipeline persists the next report only after success. The batch queues every report immediately on the reports worker pool.',
			],
			codeSampleId: 'example-workflows-code',
		},
		{
			id: 'example-recovery',
			title: '4. Configure and recover retries',
			paragraphs: [
				'The retry example persists exponential backoff, distinguishes explicit provider backpressure, and replays a failed record without deleting its audit history.',
			],
			codeSampleId: 'example-recovery-code',
		},
	],
	codeSamples: [
		...serviceLabSamples('queue', 'runQueueWorkflows'),
		{ id: 'sql-runner-source', title: 'examples/runQueueWorkflows.ts', language: 'typescript', code: serviceExampleSources.runQueueWorkflows },
		{
			id: 'example-job',
			title: 'GenerateReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.generateReportJob,
			explanation: queueArticle.codeSamples?.find(sample => sample.id === 'job-class')?.explanation,
		},
		{
			id: 'example-dispatch-code',
			title: 'createAndProcessReportJob.ts',
			language: 'typescript',
			code: serviceExampleSources.createAndProcessReportJob,
			output: serviceExampleOutputs.createAndProcessReportJob,
			outputLanguage: 'json',
			explanation: queueArticle.codeSamples?.find(sample => sample.id === 'dispatch-job')?.explanation,
		},
		{
			id: 'example-workflows-code',
			title: 'dispatchReportWorkflows.ts',
			language: 'typescript',
			code: serviceExampleSources.dispatchReportWorkflows,
			output: serviceExampleOutputs.dispatchReportWorkflows,
			outputLanguage: 'json',
			explanation: queueArticle.codeSamples?.find(sample => sample.id === 'workflow-dispatch')?.explanation,
		},
		{
			id: 'example-recovery-code',
			title: 'manageReportRetries.ts',
			language: 'typescript',
			code: serviceExampleSources.manageReportRetries,
			output: serviceExampleOutputs.manageReportRetries,
			outputLanguage: 'json',
			explanation: queueArticle.codeSamples?.find(sample => sample.id === 'retry-management')?.explanation,
		},
	],
	verifiedExample: serviceLabEvidence('queue', 'runQueueWorkflows', 'Rejects an empty chain, then processes sequential and independent jobs on real SQL.', 'Disposable SQL; no external report provider.'),
	relatedIds: ['queue-overview'],
	keywords: ['queue example tested verified source imported'],
};

const serviceArticles: DocArticle[] = [
	appArticle,
	configArticle,
	validationArticle,
	activeRecordArticle,
	fieldsArticle,
	queriesArticle,
	migrationsArticle,
	authArticle,
	cacheArticle,
	appsArticle,
	eventsArticle,
	queueArticle,
	schedulerArticle,
	flowsArticle,
	storageArticle,
	mediaArticle,
	mailArticle,
	inAppArticle,
	websocketArticle,
	loggingArticle,
	securityArticle,
	urlArticle,
	serializationArticle,
	ssrArticle,
	...aiArticles,
	testingArticle,
	apiIndexArticle,
];

const startArticles: DocArticle[] = [
	introductionArticle,
	starterAppArticle,
	installationArticle,
	firstAppArticle,
	appConfigArticle,
	projectStructureArticle,
];

const guideArticles: DocArticle[] = [
	workspaceNotesArticle,
	apiWorkflowArticle,
	modelDataArticle,
	backgroundArticle,
	privateFilesArticle,
	authWorkflowArticle,
	testingWorkflowArticle,
];

const cookbookArticles: DocArticle[] = [
	problemRecipesArticle,
	...realtimeTutorials,
	transactionsArticle,
	retriesArticle,
	streamsArticle,
	encryptedFieldsArticle,
];

const exampleArticles: DocArticle[] = [
	queueExamplesArticle,
];

const apiArticles: DocArticle[] = [
	packageAppArticle,
	packagePureArticle,
	appApiArticle,
	aiApiArticle,
	activeRecordApiArticle,
	queueApiArticle,
	configApiArticle,
	mailApiArticle,
	inAppApiArticle,
	websocketApiArticle,
	validationApiArticle,
	cacheApiArticle,
	appsApiArticle,
	eventsApiArticle,
	loggingApiArticle,
	securityApiArticle,
	fieldsApiArticle,
	migrationsApiArticle,
	storageApiArticle,
	mediaApiArticle,
	urlApiArticle,
	serializationApiArticle,
	ssrApiArticle,
	flowsApiArticle,
	schedulerApiArticle,
	authApiArticle,
];

export const docArticles: DocArticle[] = [
	...startArticles,
	...guideArticles,
	...serviceArticles,
	...cookbookArticles,
	...exampleArticles,
	...apiArticles,
];

const docArticleAliases: Record<string, string> = {
	'queue-creating-jobs': 'queue-overview',
	'queue-lifecycle': 'queue-overview',
	'queue-chains': 'queue-overview',
	'queue-failures': 'queue-overview',
};

/**
 * Builds command-palette records from the canonical documentation catalogue.
 *
 * @returns Searchable commands that retain stable article identifiers.
 */
export function documentationCommands(): DocumentationCommand[] {
	return docArticles.map(article => {
		const area = docAreas.find(candidate => candidate.id === article.area)?.label ?? 'Documentation';

		return {
			value: article.id,
			label: article.title,
			description: `${area} · ${article.group} · ${article.packageName}`,
			keywords: [
				article.label,
				article.summary,
				article.sourcePath,
				...(article.keywords ?? []),
				...articleSections(article).flatMap(section => [section.title, ...section.paragraphs]),
				...(article.codeSamples ?? []).map(sample => sample.code),
			],
		};
	});
}

/**
 * Returns contextual navigation groups for one area and optional package.
 *
 * @param area - Primary documentation area to assemble.
 * @param packageName - Optional package used to narrow API reference entries.
 * @returns Ordered navigation groups with their matching articles.
 */
export function navigationGroups(area: DocAreaId, packageName?: string): DocNavigationGroup[] {
	const matchingArticles = docArticles.filter((article) => {
		if (article.area !== area) return false;
		if (area !== 'api' || !packageName) return true;

		return article.packageName === packageName;
	});
	const groups = new Map<string, DocArticle[]>();

	for (const article of matchingArticles) {
		const group = groups.get(article.group) ?? [];

		group.push(article);
		groups.set(article.group, group);
	}

	return [...groups.entries()].map(([title, articles]) => ({ title, articles }));
}

/**
 * Finds one documentation article by its stable identifier.
 *
 * @param id - Stable article identifier.
 * @returns Matching article, or null when the identifier is unknown.
 */
export function findArticle(id: string): DocArticle | null {
	const canonicalId = docArticleAliases[id] ?? id;

	return docArticles.find(article => article.id === canonicalId) ?? null;
}

/**
 * Searches the documentation catalogue by user-visible content and ownership.
 *
 * @param query - Search phrase entered by the reader.
 * @returns At most twelve relevance-ordered article matches.
 */
export function searchDocumentation(query: string): DocArticle[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

	if (terms.length === 0) return [];

	return docArticles
		.map(article => ({
			article,
			score: searchScore(article, terms),
		}))
		.filter(result => result.score > 0)
		.sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
		.slice(0, 12)
		.map(result => result.article);
}

/**
 * Resolves the previous and next articles inside the active primary area.
 *
 * @param article - Current article used as the navigation anchor.
 * @returns Adjacent destinations, using null at either end of the area.
 */
export function articleNavigation(article: DocArticle): DocArticleNavigation {
	const areaArticles = docArticles.filter(candidate => candidate.area === article.area);
	const index = areaArticles.findIndex(candidate => candidate.id === article.id);

	return {
		previous: index > 0 ? areaArticles[index - 1] : null,
		next: index >= 0 && index < areaArticles.length - 1 ? areaArticles[index + 1] : null,
	};
}


/**
 * Scores one article against normalized search terms.
 *
 * @param article - Candidate article.
 * @param terms - Lowercase terms to match.
 * @returns Positive relevance score when every term matches.
 */
function searchScore(article: DocArticle, terms: string[]): number {
	const title = `${article.title} ${article.label} ${(article.keywords ?? []).join(' ')}`.toLowerCase();
	const ownership = `${article.packageName} ${article.sourcePath} ${article.group}`.toLowerCase();
	const body = `${article.summary} ${articleSections(article).flatMap(section => [section.title, ...section.paragraphs]).join(' ') + ' ' + (article.codeSamples ?? []).map(sample => sample.code).join(' ')}`.toLowerCase();
	let score = 0;

	for (const term of terms) {
		if (title.includes(term)) score += 6;
		else if (ownership.includes(term)) score += 3;
		else if (body.includes(term)) score += 1;
		else return 0;
	}

	return score;
}
