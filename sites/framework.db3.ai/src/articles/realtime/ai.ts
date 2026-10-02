import type { DocArticle } from '../../docs';

/** Keep AI execution running when the browser closes. Application workflow and recovery boundaries. */
export const aiTutorial: DocArticle = {
	"id": "realtime-ai",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Reconnectable AI",
	"title": "Keep AI execution running when the browser closes",
	"summary": "Use queued execution now, then design saved progress so a viewer can reconnect without restarting the run.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/ai/tests/Ai.integration.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Separate the run from its viewer",
			"paragraphs": [
				"Start with the AI guide’s HelpAgent and a configured database queue. Register AgentRunJob and the queued agent class in both HTTP and worker bootstraps. Call Agent.queue() from an authorized application action and return its jobId, conversationId and aiRequestId. The worker owns execution; the browser owns only a view.",
				"Queued execution and final history are implemented. Durable token replay is not: this tutorial separates the runnable queue foundation from the application work required to add reconnectable progress."
			],
			"links": [
				{
					"label": "Agents and queue registration",
					"articleId": "ai"
				},
				{
					"label": "Durable loading tutorial",
					"articleId": "realtime-jobs"
				}
			]
		},
		{
			"id": "state",
			"title": "2. Give the UI a durable run identity",
			"paragraphs": [
				"Store your operation status and returned agent identities with the owning user/workspace and immutable input. On navigation or reload, resolve that same run through an authorized HTTP endpoint. Never dispatch another AI request merely because the stream disconnected.",
				"A page can show queued/running immediately and recover final conversation history after completion. Existing AI integration tests exercise queued execution and saved results. The UI endpoint and operation projection remain your application’s responsibility."
			]
		},
		{
			"id": "live",
			"title": "3. Decide what must be recoverable",
			"paragraphs": [
				"Agent.stream() emits live events to its caller. Agent.runQueued() currently uses a no-op sink, so merely subscribing to a channel does not expose a queued token stream. An application must integrate event capture into server-owned execution before promising progress replay. There is no subscribeToAgent or resumeStream API to call.",
				"For a text view, persist bounded cumulative text and tool/status checkpoints with a monotonically increasing revision. Batch updates by size/time and replace the client snapshot; never append an entire checkpoint as a new token. Save final output/status even when nobody is connected."
			]
		},
		{
			"id": "replay",
			"title": "4. Use a cursor when every event matters",
			"paragraphs": [
				"If the renderer requires each token, tool or status event, persist an ordered per-run log. Give every event a sequence and attempt identity; retain an authorized public projection rather than provider diagnostics or hidden reasoning. Keep a snapshot with a high-water mark and define retention limits.",
				"Subscribe before replaying saved events. Merge live and replayed events by sequence, ignore duplicates and detect gaps; a serialized handoff or captured high-water mark closes the history/live race. When the cursor is older than retention, return a reset snapshot and a new cursor. These persistence/replay contracts are integration work, not existing framework endpoints."
			]
		},
		{
			"id": "execution",
			"title": "5. Recover execution separately from viewing",
			"paragraphs": [
				"Fence state writes by the active attempt and make tool side effects idempotent. A browser reconnect must not repeat billing or tools. Cancellation is an explicit authorized server operation; closing a fetch or socket only stops viewing.",
				"Persist before signaling. Use the authenticated worker publisher for live hints and a transactional outbox if connected viewers must eventually receive hints through a publisher outage. The WebSocket transport alone supplies neither token retention nor guaranteed notification."
			],
			"links": [
				{
					"label": "Worker publication",
					"articleId": "websocket",
					"sectionId": "workers"
				}
			]
		},
		{
			"id": "testing",
			"title": "6. Test the current foundation and the extension separately",
			"paragraphs": [
				"The AI service suite tests queued agent reconstruction and persisted results using a controlled external provider. Run `npm run test:service --workspace @db3.ai/app -- ai` with the documented disposable database configuration. The job tutorial separately proves reloadable UI status.",
				"Before enabling your replay extension, close the browser mid-tool, let the worker finish without viewers, reconnect during generation, duplicate/reorder events, overlap replay and live delivery, expire a cursor, revoke access and crash after provider completion. Assert that the same run resumes viewing and no tool or charge is repeated. These durable replay tests are not currently implemented by the guide."
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial reconnectable ai"
	]
};
