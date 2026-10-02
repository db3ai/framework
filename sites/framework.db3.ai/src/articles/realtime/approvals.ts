import type { DocArticle } from '../../docs';

/** Push approval decisions to waiting users. Application workflow and recovery boundaries. */
export const approvalsTutorial: DocArticle = {
	"id": "realtime-approvals",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Approval requests",
	"title": "Push approval decisions to waiting users",
	"summary": "Notify requesters and reviewers while keeping authorization and the final decision in saved application state.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"sections": [
		{
			"id": "setup",
			"title": "1. Model the approval request",
			"paragraphs": [
				"Start with the jobs tutorial’s durable operation pattern. Create an ApprovalRequest model with owner/workspace, subject ID, requester, pending/approved/rejected/cancelled status, revision and decision metadata. Assign reviewers through server policy rather than trusting IDs submitted by the requester.",
				"This is an application adaptation of the tested saved-state pattern. No general approval service is supplied."
			],
			"links": [
				{
					"label": "Durable state and loading",
					"articleId": "realtime-jobs"
				},
				{
					"label": "Shared-store example",
					"articleId": "realtime-kanban"
				}
			]
		},
		{
			"id": "submit",
			"title": "2. Save the pending request",
			"paragraphs": [
				"Authorize the requesting action, validate the subject and save pending under a transaction with an idempotency key. Return the saved request ID immediately. The requesting browser can navigate away and recover the pending badge from an authorized GET.",
				"Notify reviewers with a durable in-app item when they must find the request later. Use the approval ID for deduplication; a WebSocket arrival is not the durable inbox itself."
			],
			"links": [
				{
					"label": "In-app messages",
					"articleId": "in-app"
				}
			]
		},
		{
			"id": "decide",
			"title": "3. Authorize and commit one decision",
			"paragraphs": [
				"A decision endpoint checks current reviewer authority and locks the pending row. Reject a stale revision or a second terminal decision. Persist the reviewer identity, decision time and safe comment. Viewing the request does not grant permission to approve it.",
				"If approval triggers background work, atomically dispatch with the saved transition when using the same SQL queue, or use an outbox. Do not perform the action solely because a browser received an approved event."
			]
		},
		{
			"id": "channels",
			"title": "4. Publish to each permitted audience",
			"paragraphs": [
				"Define an approval:{id} channel with a current policy for requester/reviewer access. Publish changed after commit and refresh each browser’s authorized projection through the shared binding. Different roles may require different projections; an event should not contain a private reviewer note.",
				"Use a separate account inbox event for navigation badges. Multiple listeners can share the same socket. The current requester applies the decision’s HTTP response immediately; others learn through the channel."
			]
		},
		{
			"id": "recover",
			"title": "5. Restore the decision after reconnect",
			"paragraphs": [
				"Reload after subscription acknowledgement and on full page reload. Disable decision buttons when the saved status is terminal. If publication fails, the approval stays committed; explicit/focus/reconnect refresh recovers it. Cancel and expire requests through server state, not a browser timer.",
				"Remove the feature listener on route departure, keep account notifications at app scope, and clear approval projections on logout."
			]
		},
		{
			"id": "testing",
			"title": "6. Verify concurrent decisions and privacy",
			"paragraphs": [
				"Run the Kanban and job foundation tests, then add approval tests: two reviewers deciding at once, requester attempting self-approval without permission, reviewer removal, duplicate submission, a missed event, private-comment projection and approval-to-job dispatch failure.",
				"Expected result: one authoritative final decision, no duplicate action, and the same outcome after reload. No approval-specific implementation or end-to-end test is shipped by this tutorial."
			],
			"links": [
				{
					"label": "Test the shared foundation",
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
		"websocket channels realtime tutorial approval requests"
	]
};
