import type { DocArticle } from '../../docs';
import { serviceExampleSources } from '../../generated/service-examples';

/** Build a shared Kanban board. Application workflow and recovery boundaries. */
export const kanbanTutorial: DocArticle = {
	"id": "realtime-kanban",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Kanban and Pinia",
	"title": "Build a shared Kanban board",
	"summary": "Sync committed model changes into Pinia using one authorized socket and revisioned HTTP snapshots.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"examplePaths": [
		"packages/app/src/websocket/examples/board/boardSnapshot.ts",
		"packages/app/src/websocket/examples/board/LiveBoard.ts",
		"packages/app/src/websocket/examples/board/registerBoardRoutes.ts",
		"packages/app/src/websocket/examples/board/createBoardStore.ts",
		"packages/app/src/websocket/examples/board/createBoardClient.ts",
		"packages/app/src/websocket/examples/board/SummarizeBoardJob.ts",
		"packages/app/src/websocket/examples/createChannelSync.ts"
	],
	"testPath": "packages/app/src/websocket/tests/examples/liveBoard.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Set up the shared board",
			"paragraphs": [
				"Build a board where a card moved by one member appears in another member’s browser. Start with a configured application, two accounts and the main WebSocket guide. This tutorial supplies the small application models, routes and Pinia store; it does not install an automatic ORM broadcaster."
			],
			"links": [
				{
					"label": "Set up the shared connection",
					"articleId": "websocket",
					"sectionId": "setup"
				}
			]
		},
		{
			"id": "board-setup",
			"title": "2. Build a shared Kanban board",
			"paragraphs": [
				"Inside your configured application, copy the seven source files below into `server/boards`, `shared/boardSnapshot.ts` and `client/realtime`, adjusting only their relative imports. Keep `LiveBoard`, `SummarizeBoardJob` and registerBoardRoutes on the server. Keep `boardSnapshot` shared; `createChannelSync`, `createBoardStore` and `createBoardClient` belong in the browser. Install `pinia` and `vue` in the browser application and `zod` for the shared validator. The recipe uses existing Auth, ActiveRecord, the database queue driver and one WebSocket endpoint.",
				"Register `LiveBoard` with your application models, generate and apply its migration using the application database commands, and retain the normal Auth and Queue tables. Do not call `Database.install()` on a deployed database; the test uses it only for disposable databases. Create a board through trusted server code with members set to the two real account IDs, `revision`: 0, activity: null and a cards array such as [{ id: \"card-1\", title: \"Ship the board\", column: \"todo\" }]. The example limits a board to 100 cards.",
				"In the existing HTTP bootstrap, call `registerBoardRoutes(server, application)`. Mount `LiveBoard.endpoint()` at `/ws` with `registerWebSockets`, the current App and exact allowed browser origins. If `/ws` already exists, merge its channel definitions into that endpoint instead of mounting a second WebSocket service. The recipe HTTP adapter uses bearer Auth; a cookie-based app should use its established cookie and CSRF policies for HTTP and `resolveToken` for the socket.",
				"Open the same board as two authorized users. Move a card in one browser. The server saves it, commits the transaction and publishes `changed` on `board:{id}`; the other browser loads the authorized snapshot and updates Pinia. These are application-owned examples, not an automatic ActiveRecord change feed."
			],
			"links": [
				{
					"label": "Application and migrations",
					"articleId": "starter-app"
				},
				{
					"label": "Database queue setup",
					"articleId": "queue-overview"
				}
			]
		},
		{
			"id": "board-contract",
			"title": "3. Validate the public snapshot",
			"paragraphs": [
				"Copy this file to `shared/boardSnapshot.ts`. Only the public projection crosses HTTP. Membership and internal queue data stay on the server. Channel payloads trigger a read; they never get blindly merged into Pinia. Validate both the response shape and its board ID."
			],
			"codeSampleId": "board-snapshot"
		},
		{
			"id": "model-events",
			"title": "4. Publish after saving a model",
			"paragraphs": [
				"Copy `LiveBoard.ts` and `SummarizeBoardJob.ts` together into `server/boards` and point their snapshot import at `shared/boardSnapshot.ts`. A model method owns the change, permission check, row lock and `revision`. The HTTP route supplies the authenticated user ID; a submitted `userId` is never trusted. Stale moves return a conflict instead of overwriting someone else’s edit.",
				"Publish once the transaction has committed. Call these top-level methods outside an outer transaction. The event is a small invalidation; the subsequent snapshot is the source of truth. If publication fails, the saved change remains saved and the failure is logged. Reconnect, page focus or manual refresh can reconcile state; a permanently connected client can remain stale after a lost publication. Guaranteed eventual delivery requires a transactional outbox and retry worker, which this recipe does not implement.",
				"For a large board, replace full snapshots with versioned card upsert/delete events plus a snapshot fallback on a `revision` gap. Include deletion tombstones, tenant scope and a server `revision`; do not use browser timestamps as ordering. A generic model broadcaster must define its public projection and audience rather than exposing `record.toJSON()` indiscriminately."
			],
			"codeSampleId": "live-board"
		},
		{
			"id": "board-http",
			"title": "5. Keep reads and writes authorized",
			"paragraphs": [
				"Copy this adapter into `server/boards`. Both HTTP reads and writes verify board membership. WebSocket subscription checks are independent: access to a GET does not grant a channel, and an open socket does not authorize a later mutation. The same membership policy is reused on each subscription and each event delivery."
			],
			"codeSampleId": "board-routes"
		},
		{
			"id": "pinia-sync",
			"title": "6. Sync a Pinia store",
			"paragraphs": [
				"Copy the store factory into `client/realtime` and update its shared snapshot import. The store applies the successful mutation response immediately; other users learn of it through `changed` events. Older HTTP responses cannot replace a newer `revision`. A conflicting save asks the user to refresh rather than silently retrying an edit against different data.",
				"This store owns one selected board. Reuse it across routes and derive the button state from `busy`. Vue pages read the same store, so leaving the page does not reset the operation. A full reload creates a new store and loads `activity.status` from SQL."
			],
			"codeSampleId": "board-store"
		},
		{
			"id": "snapshot-recovery",
			"title": "7. Subscribe, then reconcile state",
			"paragraphs": [
				"Copy `createChannelSync.ts` into `client/realtime`. Create it once per browser tab, at application startup. Other features call `watch()` with their channel and authorized snapshot loader. Each binding gets an initial HTTP read and another read after the subscription acknowledgement, including reconnects. That second read closes the gap between loading state and installing channel membership.",
				"If an event arrives during a GET, the binding runs another GET afterwards. Bursts coalesce while a read is in progress. Stopping a feature binding removes only its listener and ignores late HTTP responses; it does not close the shared socket. Access denial stops the binding and clears the store through `fail()`. After restoring permission, create a new binding.",
				"There is no timed polling. Explicit refresh calls `binding.refresh()`. For focus recovery, register a visibilitychange handler that calls refresh when the page becomes visible, and remove that handler on app teardown. A failed HTTP read shows an error instead of retrying forever. Permission revocation prevents future delivery; it cannot retract bytes already displayed in an existing tab."
			],
			"codeSampleId": "channel-sync"
		},
		{
			"id": "board-browser",
			"title": "8. Connect the board at app startup",
			"paragraphs": [
				"Copy `createBoardClient.ts` beside the two browser helpers. Call `createBoardClient({ baseUrl: location.origin, boardId, pinia, token: () => auth.token })` once after login, using your existing Pinia instance. Provide the returned store to your board page; do not recreate the client for each component or route. Other features share its sync object. Call `close()` on logout, identity replacement or app teardown; it stops listeners and clears this store.",
				"Render a button with `disabled` bound to `!store.snapshot || store.busy` and `aria-busy` bound to `store.busy`. On click generate `crypto.randomUUID()`, retain it until the start outcome is known, and call `store.start(requestId)`. Label it Working… while `busy`; display `store.error` on failure. Use `store.move(cardId, column)` from your drag/drop handler and `binding.refresh()` for a Refresh button. Keep local drag preview separate from the authoritative saved cards."
			],
			"codeSampleId": "board-client"
		},
		{
			"id": "job-source",
			"title": "9. Include the board’s job implementation",
			"paragraphs": [
				"LiveBoard imports this job for the optional summary button. Register it on every boards worker; the background-jobs tutorial walks through dispatch, persisted loading and final failure. It computes a small summary and never deploys infrastructure."
			],
			"links": [
				{
					"label": "Background jobs and loading",
					"articleId": "realtime-jobs"
				}
			],
			"codeSampleId": "board-job"
		},
		{
			"id": "testing",
			"title": "10. Test changes, conflict and recovery",
			"paragraphs": [
				"Run `npm test --workspace @db3.ai/app -- src/websocket/tests/examples/liveBoard.test.ts` from the framework repository with disposable MariaDB test credentials. In a consuming app, reproduce these cases in its normal integration suite. These exact sources are also compiled and run against installed package exports.",
				"Open two authorized test sessions. Move a card, then submit a stale revision: the first change appears remotely and the second save returns 409. An unrelated account receives neither the board nor its events. Disconnect one session, save another change, reconnect and confirm the snapshot catches up.",
				"Refresh during an in-flight GET, then log out before a mutation response arrives. The store must apply the newest revision and remain empty after logout. Close test sessions. The app root owns the socket; route components dispose their own bindings.",
				"A lost post-commit event can leave a continuously connected store stale until explicit, focus or reconnect refresh. Add a transactional outbox if that delay is unacceptable; no timer polls the board."
			],
			"links": [
				{
					"label": "Durable jobs",
					"articleId": "realtime-jobs"
				},
				{
					"label": "Saved-action alerts",
					"articleId": "realtime-actions"
				}
			]
		}
	],
	"codeSamples": [
		{
			"id": "board-snapshot",
			"title": "shared/boardSnapshot.ts",
			"language": "typescript",
			"code": serviceExampleSources.boardSnapshot
		},
		{
			"id": "live-board",
			"title": "server/boards/LiveBoard.ts",
			"language": "typescript",
			"code": serviceExampleSources.liveBoard
		},
		{
			"id": "board-routes",
			"title": "server/boards/registerBoardRoutes.ts",
			"language": "typescript",
			"code": serviceExampleSources.registerBoardRoutes
		},
		{
			"id": "board-store",
			"title": "client/realtime/createBoardStore.ts",
			"language": "typescript",
			"code": serviceExampleSources.createBoardStore
		},
		{
			"id": "channel-sync",
			"title": "client/realtime/createChannelSync.ts",
			"language": "typescript",
			"code": serviceExampleSources.createChannelSync
		},
		{
			"id": "board-client",
			"title": "client/realtime/createBoardClient.ts",
			"language": "typescript",
			"code": serviceExampleSources.createBoardClient
		},
		{
			"id": "board-job",
			"title": "server/boards/SummarizeBoardJob.ts",
			"language": "typescript",
			"code": serviceExampleSources.summarizeBoardJob
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial kanban and pinia"
	]
};
