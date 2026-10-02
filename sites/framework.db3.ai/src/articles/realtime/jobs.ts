import type { DocArticle } from '../../docs';

/** Keep job progress visible after reload. Application workflow and recovery boundaries. */
export const jobsTutorial: DocArticle = {
	"id": "realtime-jobs",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Background jobs",
	"title": "Keep job progress visible after reload",
	"summary": "Make loading state durable so a button reflects server work across navigation, disconnects and reloads.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/websocket/tests/examples/liveBoard.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Add a server-owned activity",
			"paragraphs": [
				"Use the shared board’s Summary action as the runnable starting point. Its LiveBoard model keeps the latest activity ID, status and result. A larger app can use a separate operation model so each run has its own history and audience."
			],
			"links": [
				{
					"label": "Create the model, routes and store",
					"articleId": "realtime-kanban"
				}
			]
		},
		{
			"id": "start",
			"title": "2. Commit the run and dispatch together",
			"paragraphs": [
				"Copy `SummarizeBoardJob.ts` beside `LiveBoard`. Register `SummarizeBoardJob` with `application.queue.registerJob()` at boot in every worker. Run your application’s worker on the `boards` queue. The HTTP process and worker must use the database queue driver and the same SQL database; `startSummary` commits activity: queued and queue insertion in the same SQL transaction. A dispatch failure rolls both back.",
				"The executable recipe requires the database queue driver on the same database. The row lock allows only one active summary per board. Return the committed snapshot and run identity promptly. If you use a different queue system, design an outbox or recovery process instead of assuming the SQL write and dispatch are atomic."
			]
		},
		{
			"id": "loading",
			"title": "3. Give the button immediate feedback",
			"paragraphs": [
				"The browser sets `submitting` immediately, then uses the server’s queued/running state. The queued job belongs to the server, not to a socket or HTTP request. The worker saves running, computes a summary, saves completed and publishes `changed`. No page component waits for the job, and closing the browser never cancels it. The sample calculation is intentionally quick; replace it with your slow server operation. The test proves recovery and separate-process execution, not a simulated delay.",
				"Bind disabled and aria-busy to the store’s loading state. Keep the request ID across an uncertain start response; refresh before retrying with that same ID. A browser timeout is not proof that the job failed. On a fresh page load, GET the latest activity instead of starting another job."
			]
		},
		{
			"id": "worker",
			"title": "4. Execute and save terminal status",
			"paragraphs": [
				"Create `SummarizeBoardJob.ts` from the source in the Kanban tutorial. Register the class in every worker and run the application’s worker on the `boards` queue. The queue restores the job payload in a separate process.",
				"The handler rechecks permission, saves running, performs the work, then saves completed. Its terminal failure hook saves failed. Compare the run ID before updating so an older job cannot replace a newer run. The example’s deterministic summary is quick; substitute your real work and add side-effect idempotency and lease checks where required."
			],
			"links": [
				{
					"label": "Exact job source",
					"articleId": "realtime-kanban",
					"sectionId": "job-source"
				},
				{
					"label": "Queue retries",
					"articleId": "queue-overview"
				}
			]
		},
		{
			"id": "delivery",
			"title": "5. Notify through the API",
			"paragraphs": [
				"When workers run separately, configure `webSockets.publish` with the trusted receiver URL and service token, and register the private publish route on the API. Keep that token out of browser code. A mounted API sends locally; a worker posts to the API, which authorizes every browser recipient again. Follow the main guide’s worker publishing setup.",
				"Use the app-owned channel binding to GET the latest snapshot after changed and after each subscription acknowledgement. This closes the snapshot/subscription race. Keep a top-level activity store if the user needs progress on multiple routes."
			],
			"links": [
				{
					"label": "Configure worker publication",
					"articleId": "websocket",
					"sectionId": "workers"
				}
			]
		},
		{
			"id": "failure",
			"title": "6. Handle failures and cancellation",
			"paragraphs": [
				"One active summary is allowed per board. The latest request ID deduplicates an uncertain start response; this is not an unlimited idempotency ledger for historic runs. The job fences updates by run ID, and terminal state cannot be overwritten by an old job. This small recipe uses one ordinary attempt and records final failure through `onFinalFailure`. A real long-running side effect needs provider idempotency, queue lease ownership, retry-aware status and an authorized cancellation operation if cancellation is offered.",
				"Queue failure persistence and the application failure hook are separate writes. Monitor hook errors and reconcile abandoned runs server-side; never infer failure from a disconnected browser. Add a persistent in-app notification after final completion if the person must find the result on a later visit. WebSocket delivery is best effort and has no replay or durable receipt.",
				"Cancellation is an authorized server action with durable requested/cancelled state, not a client-side AbortController. Killing a browser fetch must not undo a deployment, payment or AI run. The sample does not implement cancellation or an indefinite idempotency ledger."
			]
		},
		{
			"id": "testing",
			"title": "7. Run the reload test",
			"paragraphs": [
				"Run `npm test --workspace @db3.ai/app -- src/websocket/tests/examples/liveBoard.test.ts`. It closes the first client, creates a fresh Pinia client that sees queued, runs a separate worker process, and observes completed over the authenticated HTTP publication path.",
				"Also test SQL dispatch failure, concurrent starts, revoked access, stale-job failure hooks and logout during an HTTP response. For a manual check, stop the board worker, click Summary, navigate away, reload, then restart the worker. Loading should end from the saved outcome. Clean up the dedicated test sessions."
			],
			"links": [
				{
					"label": "Track a deployment through several stages",
					"articleId": "realtime-deployments"
				}
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial background jobs"
	]
};
