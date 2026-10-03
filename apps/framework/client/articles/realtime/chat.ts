import type { DocArticle } from '../../docs';

/** Build a chat room with saved history. Application workflow and recovery boundaries. */
export const chatTutorial: DocArticle = {
	"id": "realtime-chat",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Chat rooms",
	"title": "Build a chat room with saved history",
	"summary": "Use the starter room to learn message persistence, live delivery, authorization and reconnect recovery.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/websocket/tests/WebSockets.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Run the starter chat",
			"paragraphs": [
				"In a configured starter app, apply migrations and run the development server. Open Live rooms in two dedicated tabs and send a message. The public lobby accepts guests; members and studio rooms demonstrate authenticated and explicitly granted access."
			],
			"links": [
				{
					"label": "Starter setup",
					"articleId": "starter-app"
				},
				{
					"label": "WebSocket session modes",
					"articleId": "websocket",
					"sectionId": "setup"
				}
			]
		},
		{
			"id": "commands",
			"title": "2. Read the message command",
			"paragraphs": [
				"Inspect `server/collaboration/RoomController.ts` and `client/CollaborationDemo.vue`. Keep incoming commands narrow: room identity, text and an application-generated message ID if retries are supported. Validate text length and trim empty messages. Resolve author identity on the server and render text as text, not unsanitized HTML.",
				"The starter limits application messages per connection. For production, also bound write rate by account and room; connection limits alone do not prevent reconnect-based abuse."
			]
		},
		{
			"id": "save",
			"title": "3. Save before broadcasting",
			"paragraphs": [
				"The starter stores recent chat with room state. Its serialized room writes avoid racing joins and updates in that demonstration. A production chat history can use Message rows with room, author, stable ID and a server-assigned sequence. Enforce membership on writes and reads as well as subscription.",
				"An optimistic bubble remains pending until the server acknowledges the durable message ID. Never mark it delivered merely because WebSocketClient.send() returned true: that reports a local transport send, not recipient receipt. Offline sends return false and are not queued."
			]
		},
		{
			"id": "history",
			"title": "4. Restore history before live updates",
			"paragraphs": [
				"The starter serializes joins and room writes, sends recent history before live membership and retains 50 recent messages. Reload a tab to see that bounded history. This is a single-writer demo, not an unlimited multi-instance chat archive.",
				"For a larger history, subscribe then replay an authorized sequence range, merging by message ID. Page older history over HTTP. Detect expired cursors and reload a snapshot. Keep typing indicators ephemeral and throttle them independently of saved messages."
			]
		},
		{
			"id": "cleanup",
			"title": "5. Leave and recover",
			"paragraphs": [
				"Remove room listeners when changing rooms. On reconnect, restore current membership and history; do not replay an old typing indicator or blindly resend a pending message. Retry durable sends with the same message ID only after checking their saved outcome.",
				"The starter uses room endpoints to demonstrate public/private policies. To put chat beside other features on one app socket, implement the room commands and named-channel policy on the existing endpoint; that adaptation needs its own integration tests."
			]
		},
		{
			"id": "testing",
			"title": "6. Exercise the actual room",
			"paragraphs": [
				"Run `npm test -- tests/collaboration.test.ts` in the starter directory. It covers room isolation, command validation, access gates, departures and saved-state recovery.",
				"Then test duplicate message IDs, failed persistence, a disconnect between commit and acknowledgement, a foreign-room reader and an HTML-looking message rendered as plain text in your application. Close your test tabs. Keep durable notifications separate from transient chat presence."
			],
			"links": [
				{
					"label": "Presence tutorial",
					"articleId": "realtime-presence"
				}
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial chat rooms"
	]
};
