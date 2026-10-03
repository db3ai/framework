import type { DocArticle } from '../../docs';
import { serviceExampleSources } from '../../generated/service-examples';

/** Show deployment progress without polling. Application workflow and recovery boundaries. */
export const deploymentsTutorial: DocArticle = {
	"id": "realtime-deployments",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Deployment progress",
	"title": "Show deployment progress without polling",
	"summary": "Follow a saved deployment from queued to verified live, and recover the same progress after reconnecting.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"examplePaths": [
		"packages/app/src/websocket/examples/deploymentSnapshot.ts",
		"packages/app/src/websocket/examples/deploymentEndpoint.ts"
	],
	"testPath": "packages/app/src/websocket/tests/examples/deploymentSnapshot.test.ts",
	"additionalTestPaths": [
		"packages/app/src/websocket/tests/WebSockets.test.ts"
	],
	"sections": [
		{
			"id": "setup",
			"title": "1. Define the deployment outcome",
			"paragraphs": [
				"Build an environment deployment timeline with stages, safe status messages and a link to the final release. This pattern is intended for control panels such as db3.ai Cloud. Cloud deployment orchestration is still proposed; this tutorial implements and tests the channel/projection building blocks, not a Cloud API or a deploy command.",
				"Start with the main WebSocket setup and an application-owned deployment controller. That controller must already know which environment and immutable release it is deploying. The browser observes it; opening or refreshing the progress page never starts deployment."
			],
			"links": [
				{
					"label": "Shared WebSocket setup",
					"articleId": "websocket",
					"sectionId": "setup"
				},
				{
					"label": "Durable job state",
					"articleId": "realtime-jobs"
				}
			]
		},
		{
			"id": "model",
			"title": "2. Persist the run before starting work",
			"paragraphs": [
				"Create a Deployment model in your app with an ID, environment ownership, intended release ID, initiating account, request/idempotency key, attempt ID, monotonic revision, phase, timestamps and safe result/error fields. Keep the environment’s observed active release separate from the candidate. Use the normal migration workflow.",
				"Authorize deploy permission separately from read-progress permission. Save queued and enqueue execution atomically when using the same database queue. Acquire an environment deployment lock in the controller so two candidates cannot migrate or switch traffic concurrently. Dispatch only immutable release identities, never browser-supplied shell commands.",
				"Use phases queued, building, migrating, starting, checking, switching and live. Record failed, cancelled or rolled-back when those outcomes are established. Show completed stage names or measured units; equal-width stages are not an accurate time percentage."
			]
		},
		{
			"id": "projection",
			"title": "3. Validate the public projection",
			"paragraphs": [
				"Create `shared/deploymentSnapshot.ts` from this source. The browser only accepts the selected deployment/environment and a newer revision. A live snapshot must name the intended active release and have passed health. The validator checks these assertions for consistency; it does not perform a health probe.",
				"A controller must establish the facts with candidate readiness and an end-to-end check after traffic switches. Only then commit live. If the candidate fails before switching, keep the previous active release ID and record the candidate failure. A rollback is a separate observed outcome, not a successful deployment of the candidate."
			],
			"codeSampleId": "deployment-snapshot"
		},
		{
			"id": "channel",
			"title": "4. Authorize the environment audience",
			"paragraphs": [
				"Create `server/sockets/deploymentEndpoint.ts` with this source and supply your existing current-membership policy. Add its channel definitions to the app’s shared authenticated endpoint. The policy runs when a viewer subscribes and before each event. Seeing progress does not grant deploy, cancel or rollback authority."
			],
			"codeSampleId": "deployment-endpoint"
		},
		{
			"id": "publish",
			"title": "5. Publish each committed transition",
			"paragraphs": [
				"After the controller commits a transition, publish changed on `environment:${environmentId}:deployments` with the deployment ID and revision. A separate worker uses the authenticated HTTP publisher from the main guide. Keep the control-plane socket/API outside the release being replaced, so switching application traffic does not intentionally terminate the progress service.",
				"Do not send raw shell output or environment variables as status messages. Keep large logs in a separate authorized, retained stream with explicit sequence cursors, redaction and size limits. The status projection contains a short allowlisted message. Never put service publish credentials in a tenant browser or in an untrusted build container."
			],
			"links": [
				{
					"label": "Worker HTTP publication",
					"articleId": "websocket",
					"sectionId": "workers"
				}
			]
		},
		{
			"id": "browser",
			"title": "6. Bind progress to the shared connection",
			"paragraphs": [
				"Use `sync.watch()` on the app-owned object returned by `createChannelSync()` with the environment channel and an authenticated loader for your Deployment endpoint. Its apply callback calls `readDeploymentSnapshot(response, { id, environmentId }, current)` and stores the result in Pinia. This reuses the tested binding; the deployment GET and store are app-owned.",
				"Render the current phase and safe message. Disable another deploy only when your server policy says one is active. Navigation can dispose a detail view while an app-level operation list remains subscribed. On a full reload, recover the run by its URL/ID and fetch it after subscription acknowledgement. A stale HTTP response must not move the timeline backwards."
			],
			"links": [
				{
					"label": "Channel-to-store binding source",
					"articleId": "realtime-kanban",
					"sectionId": "snapshot-recovery"
				}
			]
		},
		{
			"id": "failure",
			"title": "7. Recover without changing the outcome",
			"paragraphs": [
				"Connection loss means live updates are unavailable; it does not mean deployment failed. Keep the last known state visibly stale, reconnect and fetch the durable snapshot. Fence each controller update with the current attempt and deployment lock so an old worker cannot overwrite a newer run.",
				"Cancellation and rollback require explicit authorized commands. Rollback must restore and verify the prior release; database/schema compatibility and data restoration require separate policies. If the controller dies mid-switch, reconcile observed routing and release identity before deciding the final phase. Add an outbox for guaranteed eventual delivery across publication outages."
			]
		},
		{
			"id": "testing",
			"title": "8. Test both progress and the real deployment boundary",
			"paragraphs": [
				"Run `npm test --workspace @db3.ai/app -- src/websocket/tests`. The deployment tests validate projection ordering, resource identity, live-state consistency, rollback display, environment isolation and revoked subscriptions. The shared-board tests prove SQL job recovery and the worker HTTP bridge.",
				"For your deployment controller, add tests for duplicate dispatch, competing candidates, failed migrations/readiness, disconnect before switching, controller restart, stale-attempt updates and a failed rollback probe. Verify the actual public release ID before expecting live. The channel tests do not deploy a machine, switch real traffic or prove Cloud is available. Close test sessions and dispose subscriptions."
			]
		}
	],
	"codeSamples": [
		{
			"id": "deployment-snapshot",
			"title": "shared/deploymentSnapshot.ts",
			"language": "typescript",
			"code": serviceExampleSources.deploymentSnapshot
		},
		{
			"id": "deployment-endpoint",
			"title": "server/sockets/deploymentEndpoint.ts",
			"language": "typescript",
			"code": serviceExampleSources.deploymentEndpoint
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial deployment progress"
	]
};
