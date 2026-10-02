import type { DocArticle } from '../../docs';

/** Show who is viewing a document. Application workflow and recovery boundaries. */
export const presenceTutorial: DocArticle = {
	"id": "realtime-presence",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Document presence",
	"title": "Show who is viewing a document",
	"summary": "Track people and browser views, handle departures, and keep presence separate from saved membership.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/websocket/tests/WebSockets.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Run the existing room example",
			"paragraphs": [
				"Start a configured starter app with `npm run db:migrate` and `npm run dev`. Open Live rooms in two dedicated test tabs. The runnable example already displays room presence and cursors; SQL stores room content, while presence lives in the API process. Use the members or studio room when identity and access gates matter."
			],
			"links": [
				{
					"label": "Create the starter application",
					"articleId": "starter-app"
				},
				{
					"label": "Connection and session setup",
					"articleId": "websocket",
					"sectionId": "setup"
				}
			]
		},
		{
			"id": "identity",
			"title": "2. Choose the unit of presence",
			"paragraphs": [
				"Read `server/collaboration/RoomController.ts` and its open/close lifecycle. A connection represents one tab. Keep a map of connection IDs to the authenticated account and viewed resource, then derive a distinct-user avatar list with a connection count. Two tabs for one account must not show two different people.",
				"For an anonymous room, use a server-issued connection identity. Never accept a browser-supplied account ID, role or avatar URL as proof of membership. Only send profile fields that the current document’s viewers may see."
			]
		},
		{
			"id": "document-view",
			"title": "3. Add explicit view and leave actions",
			"paragraphs": [
				"To extend the example to documents on the shared `/ws` endpoint, add application commands for view-document and leave-document to the endpoint’s `parse` and `message` handlers. Validate the document ID; authorize it before adding a view. Use the accepted connection’s ID and authenticated user ID. These command names are your application protocol, not built-in framework methods.",
				"Track viewed documents separately from channel subscriptions. A notification panel may subscribe to a document it is not currently displaying. Send a leave action when the route changes; remove all views when the connection signal aborts. A failed leave send is recovered by socket cleanup.",
				"Framework `presence(path)` lists endpoint connections, not document-channel subscribers. For document avatars, own the resource-specific map and recheck access before disclosing its entries."
			]
		},
		{
			"id": "broadcast",
			"title": "4. Broadcast a replacement presence list",
			"paragraphs": [
				"After an accepted arrival or departure, publish a bounded presence snapshot to the authorized document audience. Replace the avatar list instead of incrementing a count from isolated join/leave events; reconnecting clients need a fresh list. Disclose only current authorized viewers and prune revoked views.",
				"If you show “Alex joined”, deduplicate by connection/view identity and suppress your own arrival. Treat this as a transient toast. Do not create a durable unread notification for every reconnect."
			]
		},
		{
			"id": "recovery",
			"title": "5. Recover and clean up",
			"paragraphs": [
				"Network loss is detected by heartbeat, so presence is approximate. Reconnect must reannounce the visible document and request fresh presence. On logout, clear avatars and subscriptions. Cursors should be throttled and dropped when stale; never replay them as business history.",
				"The starter’s presence is process-local. An API restart clears it and connected tabs rejoin. Multiple socket-owning APIs need explicit aggregation; a database membership row alone does not establish that a person is online."
			]
		},
		{
			"id": "testing",
			"title": "6. Verify presence behavior",
			"paragraphs": [
				"In the starter directory run `npm test -- tests/collaboration.test.ts`. Framework endpoint presence is covered by `npm run test:service --workspace @db3.ai/app -- websocket`.",
				"Open two tabs for the same account and another account. Close only one duplicate tab, change document in the other, abruptly disconnect a client and revoke a viewer’s access. Verify counts, isolation and eventual departure. The shipped room/endpoint tests cover their existing presence; your new document-view commands need these additional app tests. Close all test tabs.",
				"Next, add a saved-action notification that uses the same audience but a durable revision."
			],
			"links": [
				{
					"label": "Notify viewers after a save",
					"articleId": "realtime-actions"
				}
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial document presence"
	]
};
