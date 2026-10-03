import type { DocArticle } from '../../docs';

/** Refresh access when a user’s permissions change. Application workflow and recovery boundaries. */
export const permissionsTutorial: DocArticle = {
	"id": "realtime-permissions",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Permission changes",
	"title": "Refresh access when a user’s permissions change",
	"summary": "Update the interface promptly while enforcing every sensitive operation on the server.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"testPath": "packages/app/src/websocket/tests/WebSockets.test.ts",
	"additionalTestPaths": [
		"packages/app/src/websocket/tests/examples/liveBoard.test.ts"
	],
	"sections": [
		{
			"id": "setup",
			"title": "1. Persist membership changes",
			"paragraphs": [
				"Use your application’s organization/resource membership model and an authorized administration endpoint. Lock or version membership updates as needed and save the new role/revocation with an audit identity. The browser must not grant itself access by modifying its local store.",
				"Keep the affected user’s own account channel available for access-change hints even after a resource is revoked. A resource channel alone cannot deliver the revocation message once its policy correctly denies that subscriber."
			],
			"links": [
				{
					"label": "Channel authorization",
					"articleId": "websocket",
					"sectionId": "resource-channels"
				}
			]
		},
		{
			"id": "notify",
			"title": "2. Publish a minimal account hint",
			"paragraphs": [
				"After commit, publish permissions-changed to the affected account audience. Its policy must require the authenticated user ID to match the channel account ID. Send only a scope identifier/revision if appropriate; let an authorized endpoint return the current navigation/capabilities.",
				"The event is a refresh hint, not a signed permission grant. Never implement access as “the last event said admin”. The durable membership record and current server authorization remain authoritative."
			]
		},
		{
			"id": "enforce",
			"title": "3. Recheck access on the server",
			"paragraphs": [
				"Keep channel authorization tied to current membership so subsequent payload delivery is denied after revocation. HTTP reads, mutations and worker actions must independently apply current policy. Session invalidation and resource-role revocation are different operations.",
				"The framework rechecks authenticated endpoint access on actions, sends and heartbeats, and named-channel policy on subscription/delivery. It does not automatically broadcast a channel-denied event to every idle subscriber whenever an arbitrary membership row changes."
			]
		},
		{
			"id": "clear",
			"title": "4. Remove inaccessible client state",
			"paragraphs": [
				"On the account hint, reload capabilities, navigate away from an inaccessible view if necessary, stop its channel binding and clear private Pinia state. Fence outstanding HTTP responses so a late success cannot repopulate the view after logout/revocation.",
				"On channel denial, show an explicit access state instead of infinite reconnect. After a legitimate grant, create a fresh binding or reconnect as the main guide describes. Clear all account-owned subscriptions before reusing the connection with a different identity."
			]
		},
		{
			"id": "recovery",
			"title": "5. Treat offline hints as optional",
			"paragraphs": [
				"A disconnected browser may miss the permission hint. The next HTTP request, subscribe, action or delivery must still enforce current access. Recovery fetches the current capability snapshot; it does not replay past grants.",
				"You cannot retract bytes a browser already received. Clearing the UI is useful feedback, not a guarantee that previously disclosed data has been erased. Do not expose data that the current viewer should not have received in the first place."
			]
		},
		{
			"id": "testing",
			"title": "6. Test revocation during active work",
			"paragraphs": [
				"Run the WebSocket service suite for denied subscriptions and per-delivery revocation, and the Kanban suite for late-response/logout cleanup. Add application tests for role removal while a GET is pending, account-hint delivery after resource removal, grant restoration, another user’s account channel and logout/login as a different user.",
				"Expected result: no new unauthorized payload or mutation after the server checks the changed policy, and client state recovers correctly even if the hint was missed."
			],
			"links": [
				{
					"label": "Store cleanup example",
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
		"websocket channels realtime tutorial permission changes"
	]
};
