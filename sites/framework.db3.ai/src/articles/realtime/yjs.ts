import type { DocArticle } from '../../docs';

/** Plan a Yjs adapter for the shared connection. Application workflow and recovery boundaries. */
export const yjsTutorial: DocArticle = {
	"id": "realtime-yjs",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Yjs editing",
	"title": "Plan a Yjs adapter for the shared connection",
	"summary": "Understand the provider boundary before carrying document updates over authorized JSON channels.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"sections": [
		{
			"id": "setup",
			"title": "1. Choose the integration boundary",
			"paragraphs": [
				"This is an integration-design tutorial. The framework does not ship a Yjs provider, so there is no drop-in runnable adapter in this page. First keep your editor working with its current Yjs provider. The existing y-websocket protocol cannot connect to the framework JSON endpoint unchanged.",
				"Choose between keeping a dedicated Yjs endpoint, which adds another connection, and writing a provider adapter over the shared app socket. The latter preserves one connection but makes synchronization, persistence and awareness part of your integration."
			],
			"links": [
				{
					"label": "Yjs WebSocket provider",
					"href": "https://docs.yjs.dev/ecosystem/connection-provider/y-websocket"
				},
				{
					"label": "Framework transport limits",
					"articleId": "websocket",
					"sectionId": "limits"
				}
			]
		},
		{
			"id": "protocol",
			"title": "2. Define bounded document messages",
			"paragraphs": [
				"Yjs document updates are binary. Define an application envelope with document ID, message kind and an encoded update; validate its encoding and decoded length. Base64 increases size, so leave room beneath the 64 KiB JSON frame limit. Large initial documents need a separate authorized snapshot path.",
				"Use validated endpoint actions for browser writes and an authorized document channel for server fan-out. Check write permission on every update; a read-only subscriber may receive changes without being allowed to send them. Do not publish a raw browser frame to every viewer."
			]
		},
		{
			"id": "durability",
			"title": "3. Persist accepted updates",
			"paragraphs": [
				"Store the accepted Yjs update or a compacted document state before broadcasting. Load it when the document room starts. Yjs updates can be applied repeatedly and in different orders, but every peer still needs all relevant state; best-effort delivery alone is insufficient.",
				"Tag remote-application origins so a locally observed remote update is not sent back endlessly. Bound document memory and storage, compact deliberately, and keep access control outside editable document content."
			],
			"links": [
				{
					"label": "Yjs updates and state vectors",
					"href": "https://docs.yjs.dev/api/document-updates"
				}
			]
		},
		{
			"id": "reconnect",
			"title": "4. Exchange missing state on reconnect",
			"paragraphs": [
				"After authorized subscription, exchange state vectors and send missing updates rather than assuming the socket retained history. Merge the durable server state with any allowed local edits before marking the provider synced. Define what happens to offline edits when write permission was revoked.",
				"A connected socket is not the same as a synced document. Expose separate connection and sync states to the editor. Test a snapshot exceeding the frame limit using your alternate transfer path."
			]
		},
		{
			"id": "awareness",
			"title": "5. Separate awareness from document data",
			"paragraphs": [
				"Map cursor/user awareness to the provider interface expected by the editor. Derive account identity on the server, throttle cursor updates and expire disconnected clients. Awareness is ephemeral and must not be replayed as document content.",
				"Destroy document and awareness observers, remove channel listeners and clear resource state when leaving the editor. Keep the shared socket alive for other app features."
			],
			"links": [
				{
					"label": "Presence lifecycle",
					"articleId": "realtime-presence"
				}
			]
		},
		{
			"id": "testing",
			"title": "6. Prove convergence before enabling collaboration",
			"paragraphs": [
				"Add an adapter test with two real Y.Doc instances: concurrent edits, reordered/duplicate updates, offline edits, reconnect state-vector recovery and persisted recovery after server replacement. Add read-only access, revocation, invalid encodings, large snapshots and observer cleanup cases.",
				"No Yjs adapter or convergence test is supplied by this framework tutorial. The linked official provider docs establish the external protocol; the main guide establishes the current JSON transport. Keep the integration marked incomplete until these tests pass."
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial yjs editing"
	]
};
