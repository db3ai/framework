import type { DocArticle } from '../../docs';

/** Notify another user after a server action. Application workflow and recovery boundaries. */
export const actionsTutorial: DocArticle = {
	"id": "realtime-actions",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Saved-action alerts",
	"title": "Notify another user after a server action",
	"summary": "Commit the action, publish to authorized viewers, and refresh saved state before showing a useful alert.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/websocket/tests/examples/liveBoard.test.ts",
	"sections": [
		{
			"id": "setup",
			"title": "1. Start with an authorized resource",
			"paragraphs": [
				"Use the shared Kanban example or an existing document model with an ownership policy. The goal is “another member saved this”, not a notification for every browser keystroke. Start with the main guide’s authenticated connection and one channel such as `document:{documentId}`."
			],
			"links": [
				{
					"label": "Shared Kanban sources",
					"articleId": "realtime-kanban"
				},
				{
					"label": "Authorize channels",
					"articleId": "websocket",
					"sectionId": "resource-channels"
				}
			]
		},
		{
			"id": "save",
			"title": "2. Save and identify the actor on the server",
			"paragraphs": [
				"Put validation, membership checks and mutation in the owning model/service method. Derive the actor from the authenticated session. Use a row lock or expected revision to avoid overwriting a concurrent save. `LiveBoard.move()` shows the executable version of this pattern.",
				"Commit the outer transaction before publishing. A rollback must produce no success event. If the caller owns a larger transaction, it also owns post-commit publication; generic channel publishing does not detect transaction completion."
			]
		},
		{
			"id": "event",
			"title": "3. Publish a bounded activity event",
			"paragraphs": [
				"Publish a named event through `application.webSockets.channel(channel).publish(event, payload)`. The resource audience is chosen by trusted server code. An application payload can carry the resource ID, committed revision, server-derived actor ID and a short action name. Exclude arbitrary model fields and raw request bodies.",
				"The board example publishes a changed invalidation and the other viewer reloads a snapshot. If you need an actor-specific toast, add those public fields to an explicit schema and a focused app test. Do not infer the actor from whichever browser happens to receive the event first."
			]
		},
		{
			"id": "browser",
			"title": "4. Update the view before showing the alert",
			"paragraphs": [
				"Register the listener through the app-owned socket. Validate its payload, ignore an already-seen revision, reload the authorized snapshot and then show the toast. Suppress the current user’s own toast if the save response already gave feedback. Remove the listener when the feature is disposed.",
				"Persist an in-app message instead if the recipient must see the action when they return later. The durable item should have its own stable identity; receiving a WebSocket event must not mark it read."
			],
			"links": [
				{
					"label": "Durable inbox messages",
					"articleId": "in-app"
				}
			]
		},
		{
			"id": "failure",
			"title": "5. Keep publication failure separate from save failure",
			"paragraphs": [
				"If the database commit succeeded but HTTP/socket publication failed, record the delivery error and keep the HTTP save response truthful. Reconnecting or manually refreshing restores the saved revision. Use an outbox when eventual notification while continuously connected is required."
			]
		},
		{
			"id": "testing",
			"title": "6. Test the actor, audience and rollback",
			"paragraphs": [
				"Run the Kanban recipe tests for the real save-to-other-Pinia path. Add app tests for self-toast suppression, duplicate events, a rolled-back save, a foreign-resource subscriber, revoked access and a timeout after commit. Verify that the durable revision still appears after reload when the event was missed."
			],
			"links": [
				{
					"label": "Executable save and conflict test",
					"articleId": "realtime-kanban",
					"sectionId": "testing"
				}
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial saved-action alerts"
	]
};
