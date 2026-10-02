import type { DocArticle } from '../../docs';

/** Keep availability displays current. Application workflow and recovery boundaries. */
export const inventoryTutorial: DocArticle = {
	"id": "realtime-inventory",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Inventory updates",
	"title": "Keep availability displays current",
	"summary": "Push inventory changes while keeping reservations and purchase decisions authoritative on the server.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"sections": [
		{
			"id": "setup",
			"title": "1. Choose a public stock projection",
			"paragraphs": [
				"Create an application inventory/availability endpoint whose projection exposes only what the viewer may see: product/location identity, availability or permitted quantity, and a monotonic revision. Do not broadcast supplier costs, private warehouse data or every model field.",
				"Start with the shared Pinia board pattern. Replace cards with the authorized availability projection; the transport and recovery binding are reusable application code."
			],
			"links": [
				{
					"label": "Pinia snapshot binding",
					"articleId": "realtime-kanban",
					"sectionId": "snapshot-recovery"
				}
			]
		},
		{
			"id": "mutate",
			"title": "2. Commit a reservation or stock change",
			"paragraphs": [
				"Handle stock mutations in server-side model/service methods using row locks or conditional updates. Deduplicate provider/webhook changes by their stable event identity. Prevent negative availability according to the business rules.",
				"Only after commit, publish an invalidation to the appropriate authorized audience. A displayed available badge is a recent observation, never a promise that a later purchase will succeed. The reservation endpoint must validate current stock again."
			]
		},
		{
			"id": "subscribe",
			"title": "3. Subscribe at the right scope",
			"paragraphs": [
				"Use a bounded product or location channel when viewers share the same projection. Avoid one connection per row. Subscribe only to visible/selected resources and respect the framework’s per-connection subscription limit; large catalogs need a coarser channel and paginated HTTP reads.",
				"Named channel policies require an authenticated endpoint. An anonymous storefront needs an explicitly public endpoint with a carefully limited projection; do not silently grant public access to the private-channel mechanism."
			],
			"links": [
				{
					"label": "Authorization and limits",
					"articleId": "websocket",
					"sectionId": "limits"
				}
			]
		},
		{
			"id": "render",
			"title": "4. Apply snapshots without losing local input",
			"paragraphs": [
				"Validate the response identity and revision. Replace only server-owned availability fields; keep local quantity input and unsubmitted cart changes separate. For rapid bursts, coalesce refreshes while a GET is in flight.",
				"An out-of-order event or delayed HTTP response must not restore an older stock count. If using incremental quantity events instead, include stable event IDs and ordering; blindly adding a delta twice corrupts the display."
			]
		},
		{
			"id": "recovery",
			"title": "5. Handle stale or disconnected displays",
			"paragraphs": [
				"Show a disconnected/stale indicator when appropriate, reconcile after subscription/reconnect and allow manual refresh. Do not disable server validation because the socket appears connected. Publication can fail after a valid stock commit.",
				"Remove bindings for resources the user no longer views and clear private inventory on logout. The shared socket remains available to other features."
			]
		},
		{
			"id": "testing",
			"title": "6. Prove display and reservation separately",
			"paragraphs": [
				"Test simultaneous reservations against the real database, duplicate incoming stock events, missed notifications, out-of-order reads, unauthorized locations and catalog subscription limits. Reload must restore the authoritative quantity.",
				"The Kanban suite verifies the shared binding/revision pattern; inventory reservation logic and anonymous storefront behavior require your own app tests. This tutorial does not supply a stock or checkout service."
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial inventory updates"
	]
};
