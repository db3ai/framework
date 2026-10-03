import type { DocArticle } from '../../docs';

/** Show processing progress after an upload. Application workflow and recovery boundaries. */
export const uploadsTutorial: DocArticle = {
	"id": "realtime-uploads",
	"area": "cookbook",
	"group": "Realtime tutorials",
	"label": "Upload processing",
	"title": "Show processing progress after an upload",
	"summary": "Separate bytes reaching storage from work that validates and transforms the uploaded file.",
	"packageName": "@db3.ai/app/websocket",
	"sourcePath": "packages/app/src/websocket/README.md",
	"includeSourceDocument": false,
	"sections": [
		{
			"id": "setup",
			"title": "1. Separate upload and processing state",
			"paragraphs": [
				"Start with the private-file tutorial for authenticated upload/storage. Keep browser upload percentage separate from server processing state. Reaching 100% uploaded means bytes reached the upload service; it does not mean scanning, thumbnailing or indexing finished."
			],
			"links": [
				{
					"label": "Private files",
					"articleId": "guide-files"
				},
				{
					"label": "Background job lifecycle",
					"articleId": "realtime-jobs"
				}
			]
		},
		{
			"id": "record",
			"title": "2. Save a file-processing operation",
			"paragraphs": [
				"Create an application operation linked to the durable media/file ID, owning workspace, requested processing version, status, revision and safe output references. Authorize ownership before dispatch; never put a browser-supplied filesystem path in a job.",
				"Queue processing only after storage has confirmed the source object. Object storage and SQL dispatch are separate resources: use a staging/finalization workflow and reconcile uploaded objects whose dispatch failed. Do not describe them as one atomic transaction."
			]
		},
		{
			"id": "work",
			"title": "3. Execute an idempotent processor",
			"paragraphs": [
				"Register the processor in each worker. Recheck file ownership/access, validate file type/size and write derived outputs to deterministic versioned destinations. Record stages such as queued, validating, processing, ready and failed.",
				"Store ready only after outputs are readable and their metadata is committed. Retrying should replace or reuse the same versioned output rather than append duplicates. Expose safe error codes/messages; internal scanner or storage errors stay in server logs."
			]
		},
		{
			"id": "events",
			"title": "4. Push processing changes",
			"paragraphs": [
				"Authorize a file:{id}:processing channel or an owner-scoped operation channel. After each committed state change, publish changed through the API/worker bridge. Reuse createChannelSync with the authorized operation GET and a store that ignores older revisions.",
				"Persist a completion inbox item if the person can leave for a long period. A WebSocket event can refresh the upload list and show a toast; it must not manufacture a signed download URL or grant file access."
			],
			"links": [
				{
					"label": "Shared binding source",
					"articleId": "realtime-kanban",
					"sectionId": "snapshot-recovery"
				},
				{
					"label": "Worker configuration",
					"articleId": "websocket",
					"sectionId": "workers"
				}
			]
		},
		{
			"id": "recovery",
			"title": "5. Recover and clean up",
			"paragraphs": [
				"After reload, find the operation by file ID and restore queued/processing/ready state. Closing the upload page must not cancel the worker. Give cancellation a separate server-side policy, especially if outputs are already committed.",
				"Clean up temporary storage on failed processing according to a retention policy; do not delete a source another active attempt still needs. Remove progress listeners when no longer shown and clear private file state at logout."
			]
		},
		{
			"id": "testing",
			"title": "6. Test storage and queue failure boundaries",
			"paragraphs": [
				"Use the existing private-file and job suites as foundations, then test upload success with dispatch failure, missing source bytes, duplicate processor attempts, revoked file access, processing failure, offline completion and reload before ready.",
				"Expected result: processing starts only from confirmed storage, one authoritative result survives retries, and all progress/download endpoints reject another tenant. This tutorial specifies an application composition; an upload-processing pipeline is not shipped here."
			]
		}
	],
	"relatedIds": [
		"websocket",
		"websocket-api"
	],
	"keywords": [
		"websocket channels realtime tutorial upload processing"
	]
};
