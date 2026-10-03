import type { DocArticle } from '../docs';
import { serviceExampleSources } from '../generated/service-examples';
import { createApiReference } from './apiReference';

/** Main WebSocket guide: setup, authorization, publishing, recovery and focused tutorials. */
export const websocketArticle: DocArticle = {
	"id": "websocket",
	"area": "services",
	"group": "Delivery",
	"label": "WebSockets",
	"title": "WebSockets",
	"summary": "Push server activity through authorized channels on one shared browser connection.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"examplePaths": [
		"packages/app/src/websocket/examples/resourceChannels.ts"
	],
	"testPath": "packages/app/src/websocket/tests/WebSockets.test.ts",
	"sections": [
		{
			"id": "overview",
			"title": "Push server activity to the browser",
			"paragraphs": [
				"Use WebSockets to tell connected browsers when server activity changes something they can see: a saved document, a completed job or deployment progress. Keep the saved business state in your database and use events to update or refresh the view.",
				"An application owns one `WebSocketClient` per browser tab. Features share it through named `channels`. The server authenticates the connection and checks the viewer’s access to each channel. A channel identifies an audience; it does not automatically subscribe to an ORM model or create a persistent message queue."
			]
		},
		{
			"id": "setup",
			"title": "Use the existing application and session",
			"paragraphs": [
				"Start in a configured application with Auth and its existing HTTP server. Install the Fastify adapter during server bootstrap, before listen. Use exact allowed HTTP(S) origins and HTTPS/WSS in production. Upgrades do not execute ordinary HTTP route hooks.",
				"Bearer applications provide the client token callback. Cookie applications use `auth: cookie` on the client and a server `resolveToken` callback that reads the existing HttpOnly session; the resolver replaces a frame token and fails closed. Use the same account and membership policies as your HTTP API.",
				"The server library is `@db3.ai/app/websocket`; the browser-safe import is `@db3.ai/app/websocket/client`. Do not import the server runtime into the browser or create another `App` to publish an event."
			],
			"links": [
				{
					"label": "Create and configure an application",
					"articleId": "starter-app"
				},
				{
					"label": "Authentication",
					"articleId": "auth"
				}
			]
		},
		{
			"id": "resource-channels",
			"title": "Define and authorize resource channels",
			"paragraphs": [
				"Define channel patterns with `defineChannel` and place them in the authenticated endpoint’s `channels` array. The example registers a website job channel and a private user-notification channel. Supply a real current-membership policy to `resourceChannels`; never trust a requested website ID as proof of access.",
				"Authorization runs on every subscription and delivery. Unknown, ambiguous and unauthorized `channels` are denied. A login alone does not grant tenant access, and channel read permission does not grant permission to mutate the resource. Named resource subscriptions require an authenticated endpoint."
			],
			"codeSampleId": "endpoint"
		},
		{
			"id": "mount",
			"title": "Mount the shared endpoint",
			"paragraphs": [
				"Register the endpoint once on the existing server. If you add more features, merge their channel definitions into that endpoint. Keep HTTP snapshot and mutation endpoints independently authorized.",
				"The example uses bearer authentication. For cookie authentication, add `resolveToken` from your existing session integration. Fastify’s `preClose` hook drains upgraded connections before waiting for HTTP shutdown."
			],
			"codeSampleId": "mount"
		},
		{
			"id": "browser",
			"title": "Subscribe through one browser connection",
			"paragraphs": [
				"Create the client after login at application startup, then pass it to features through your existing store or injection layer. Do not construct a new socket for each component. Separate tabs each have their own connection.",
				"`client.channel(name).on(event, listener)` subscribes on the first listener and returns cleanup. Removing the last listener unsubscribes from that channel without closing the shared socket. The payload remains unknown until your application validates it.",
				"Connect again explicitly after repairing denied authentication/access. For identity replacement, dispose account-owned listeners, close the old client and clear private stores before reconnecting. Sending while disconnected returns false; outgoing messages are not queued for replay."
			],
			"codeSampleId": "browser"
		},
		{
			"id": "publish",
			"title": "Publish after the change commits",
			"paragraphs": [
				"From trusted server code, call `application.webSockets.channel(name).publish(event, payload)` after the outer transaction commits. Pick the audience on the server and send an explicit public projection or a small invalidation. Generic channel publication is not transaction-aware.",
				"A mounted API delivers to its local authorized subscribers. A publish result counts accepted local sends; it is not a delivery receipt. A browser acknowledgement, durable unread item and database commit are different outcomes.",
				"If publication fails after a successful save, the save remains successful. Log the delivery failure and reconcile saved state on reconnect or explicit refresh. Use a transactional outbox if connected clients must eventually receive every committed notification."
			],
			"codeSampleId": "publish"
		},
		{
			"id": "workers",
			"title": "Publish from jobs and other server processes",
			"paragraphs": [
				"Register a private HTTP publishing route on the API and configure workers with its trusted URL and the same dedicated service secret. No Redis service is required for one active API. Keep this secret out of browser code, URLs and untrusted build processes.",
				"The receiver checks service credentials before accepting a bounded JSON event, then checks each browser subscriber’s current access. Keep the route on a private listener/network; use HTTPS across untrusted networks. Requests with browser `Origin` headers are rejected.",
				"Worker requests default to a five-second timeout, never follow redirects and do not automatically retry. HTTP acceptance returns zero, not a remote browser count. Mounted APIs and the receiver deliver locally, avoiding forwarding loops.",
				"One URL reaches one API process. During replacement, route worker publication to the active API and close old sockets so they reconnect. Multiple simultaneously active socket owners require explicit fan-out; a load balancer alone does not broadcast."
			],
			"codeSampleId": "workers"
		},
		{
			"id": "recovery",
			"title": "Recover the view after reconnect",
			"paragraphs": [
				"Use `onSubscribed` to reload an authorized snapshot after membership is installed, including on reconnect. Loading first and subscribing later can miss a change between those operations. The copyable `createChannelSync` helper performs an initial read and reconciles again after the subscription acknowledgement.",
				"If an event arrives during an HTTP read, schedule another read afterwards. Validate the resource ID and ignore older model revisions so a slow response cannot overwrite newer state. Fence pending responses when the user logs out or leaves the resource.",
				"Events have no durable replay. Use a saved snapshot when the latest state is sufficient, or build an ordered retained event log when every intermediate event matters. A socket reconnect by itself cannot reconstruct missing chat messages, AI tokens or deployment logs."
			],
			"links": [
				{
					"label": "Tested Pinia binding and recovery",
					"articleId": "realtime-kanban",
					"sectionId": "snapshot-recovery"
				},
				{
					"label": "Reconnectable AI design",
					"articleId": "realtime-ai"
				}
			]
		},
		{
			"id": "limits",
			"title": "Understand presence, limits and failure states",
			"paragraphs": [
				"Endpoint `presence(path)` lists authenticated connections in this process; it does not enumerate viewers of a document channel. Resource-specific presence needs application-owned view/leave actions and cleanup. The starter’s Live rooms demonstrate chat and room presence, including public and gated access.",
				"Defaults bound connections, buffers, payloads and queued actions: 1,000 sockets, 64 KiB frames, a 256 KiB outgoing buffer and 128 named subscriptions per connection. Heartbeats detect dead peers and recheck endpoint access. Slow clients and invalid/flooding messages can be disconnected.",
				"Invalid sessions close with 4401; endpoint authorization denial closes with 4403. `onChannelDenied` reports refused named subscriptions without closing unrelated `channels`. Show an access or connection state rather than retrying a denied action forever.",
				"The protocol uses JSON. Existing Yjs providers need an adapter, while durable AI stream replay needs persisted progress and recovery contracts. The tutorials distinguish tested working examples from integration designs."
			],
			"links": [
				{
					"label": "WebSocket API reference",
					"articleId": "websocket-api"
				}
			]
		},
		{
			"id": "tutorials",
			"title": "Build a feature with a tutorial",
			"paragraphs": [
				"Each tutorial covers its application state, authorized audience, server event, client recovery and tests. Start with the Kanban or background-job tutorial for executable application sources. Deployment progress adds tested projection and channel building blocks; its Cloud orchestrator remains application work.",
				"Presence and chat start from the runnable starter rooms. Yjs and durable AI replay describe the missing integration work explicitly. The approval, upload, inventory and permission tutorials apply the same saved-state pattern to their own domain rules."
			],
			"links": [
				{
					"label": "Kanban and Pinia",
					"articleId": "realtime-kanban"
				},
				{
					"label": "Document presence",
					"articleId": "realtime-presence"
				},
				{
					"label": "Saved-action alerts",
					"articleId": "realtime-actions"
				},
				{
					"label": "Background jobs",
					"articleId": "realtime-jobs"
				},
				{
					"label": "Chat rooms",
					"articleId": "realtime-chat"
				},
				{
					"label": "Deployment progress",
					"articleId": "realtime-deployments"
				},
				{
					"label": "Yjs editing",
					"articleId": "realtime-yjs"
				},
				{
					"label": "Reconnectable AI",
					"articleId": "realtime-ai"
				},
				{
					"label": "Approval requests",
					"articleId": "realtime-approvals"
				},
				{
					"label": "Upload processing",
					"articleId": "realtime-uploads"
				},
				{
					"label": "Inventory updates",
					"articleId": "realtime-inventory"
				},
				{
					"label": "Permission changes",
					"articleId": "realtime-permissions"
				}
			]
		},
		{
			"id": "testing",
			"title": "Verify and clean up",
			"paragraphs": [
				"In the framework repository, run `npm test --workspace @db3.ai/app -- src/websocket/tests` with disposable MariaDB test credentials. The suite exercises real sessions, sockets, channel authorization, HTTP publication, Pinia snapshots and an independent job worker.",
				"In a starter app, run `npm test -- tests/collaboration.test.ts` for its existing room/presence/chat behavior. In your own app, test foreign access, revocation, missed events, stale responses and reconnect against the actual saved resource. Each tutorial lists its additional domain tests.",
				"After verification, close test tabs and task-owned servers. At runtime, remove feature listeners on disposal and close the shared connection only on logout, identity replacement or application teardown. Keep production health, release identity and live delivery checks separate from passing local tests."
			]
		}
	],
	"codeSamples": [
		{
			"id": "endpoint",
			"title": "server/sockets/resourceChannels.ts",
			"language": "typescript",
			"code": serviceExampleSources.resourceChannels
		},
		{
			"id": "mount",
			"title": "Inside the existing HTTP bootstrap",
			"language": "typescript",
			"code": "import { registerWebSockets } from '@db3.ai/app/websocket/fastify';\nimport { resourceChannels } from './sockets/resourceChannels';\n\n// application, server, config and canAccessWebsite belong to your existing host.\nregisterWebSockets(server, {\n\tapp: application,\n\torigins: [config.origin],\n\tendpoints: { '/ws': resourceChannels(canAccessWebsite) },\n});"
		},
		{
			"id": "browser",
			"title": "Application startup and feature subscription",
			"language": "typescript",
			"code": "import { WebSocketClient } from '@db3.ai/app/websocket/client';\n\nconst url = new URL('/ws', location.href);\nurl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';\n// auth, reloadChannel and showChannelDenied are application-owned integrations.\nconst realtime = new WebSocketClient({\n\turl: url.href, token: () => auth.token,\n\tonSubscribed: channel => reloadChannel(channel),\n\tonChannelDenied: channel => showChannelDenied(channel),\n});\nconst stop = realtime.channel(`user:${auth.user.id}:notifications`)\n\t.on('changed', () => reloadChannel(`user:${auth.user.id}:notifications`));\nrealtime.connect();\n// Feature disposal: stop();\n// Logout/app teardown: dispose all bindings, clear private stores, realtime.close();"
		},
		{
			"id": "publish",
			"title": "After a committed change",
			"language": "typescript",
			"code": "// userId comes from trusted recipient selection on the server.\nawait application.webSockets.channel(`user:${userId}:notifications`)\n\t.publish('changed', { notificationId });"
		},
		{
			"id": "workers",
			"title": "API receiver and separate worker configuration",
			"language": "typescript",
			"code": "// API: pass apiPublish as the publish option in registerWebSockets(...).\n// Generate a random service secret with 32–256 URL-safe characters.\nconst apiPublish = {\n\tpath: '/_internal/realtime/publish',\n\ttoken: config.realtimeSecret,\n};\n\n// Worker: pass workerWebSockets as webSockets in its existing App options.\nconst workerWebSockets = {\n\tpublish: {\n\t\turl: config.realtimePublishUrl,\n\t\ttoken: config.realtimeSecret,\n\t\ttimeoutMs: 5000,\n\t},\n};\n\n// After committing the result, use the same channel publisher as the API.\nawait application.webSockets.channel(`user:${userId}:notifications`)\n\t.publish('changed', { notificationId });"
		}
	],
	"relatedIds": [
		"websocket-api",
		"realtime-kanban",
		"realtime-jobs",
		"realtime-deployments",
		"auth"
	]
};

/** Public declarations generated from the packed framework surface. */
export const websocketApiArticle = createApiReference({
	id: 'websocket-api', label: 'WebSockets', packageName: '@db3.ai/app/websocket', sourcePath: 'packages/app/src/websocket/README.md', guideId: 'websocket',
	references: [
		['define', 'Endpoint definition overloads', 'dist/websocket/defineWebSocket.d.ts'],
		['fastify', 'Fastify registration', 'dist/websocket/fastify.d.ts'],
		['service', 'Service and presence', 'dist/websocket/WebSockets.d.ts'],
		['channel-definition', 'Resource channel definition', 'dist/websocket/defineChannel.d.ts'],
		['channel-contracts', 'Resource channel contracts', 'dist/websocket/contracts/WebSocketChannel.d.ts'],
		['channels', 'Local channels', 'dist/websocket/WebSocketChannels.d.ts'],
		['endpoint', 'Controller contracts', 'dist/websocket/contracts/WebSocketEndpoint.d.ts'],
		['options', 'Mount options', 'dist/websocket/contracts/WebSocketOptions.d.ts'],
		['client', 'Browser client', 'dist/websocket/client/WebSocketClient.d.ts'],
		['client-options', 'Browser options', 'dist/websocket/contracts/WebSocketClient.d.ts'],
	],
});
