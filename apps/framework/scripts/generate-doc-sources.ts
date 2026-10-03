import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { docArticles } from '../client/docs';
import { isPublicDocumentationSource } from '../client/articleContent';
import { generateFrameworkAuthority } from './generate-framework-authority';
import { helloGuideSamples } from '../../../packages/app/src/apps/examples/helloGuideSamples';

const repoRoot = new URL('../../../', import.meta.url);
const missingSources: string[] = [];
const frameworkPackagePath = new URL('packages/app/package.json', repoRoot);
const PUBLIC_APP_PACKAGE = '@db3.ai/app';

/**
 * Package identity required by the generated documentation metadata.
 */
interface FrameworkPackageManifest {
	name?: string;
	version?: string;
}

/**
 * Framework-owned example sources rendered by the documentation application.
 */
const serviceExamplePaths = {
	helloApp: 'packages/app/src/apps/examples/hello/App.ts',
	helloManifest: 'packages/app/src/apps/examples/hello/manifest.json',
	helloDefinition: 'packages/app/src/apps/examples/helloDefinition.ts',
	helpAgent: 'packages/app/src/ai/examples/HelpAgent.ts',
	createHelpImage: 'packages/app/src/ai/examples/createHelpImage.ts',
	aiConversation: 'packages/app/src/ai/examples/Conversation.ts',
	selectNoteTags: 'packages/pure/examples/selectNoteTags.ts',
	runNoteTags: 'packages/pure/examples/runNoteTags.ts',
	runQueueWorkflows: 'packages/app/src/queue/examples/runQueueWorkflows.ts',
	recoverableSummaryJob: 'packages/app/src/scheduler/examples/RecoverableSummaryJob.ts',
	runScheduledReplay: 'packages/app/src/scheduler/examples/runScheduledReplay.ts',
	starterApplication: 'apps/starter/server/app.ts',
	starterSummariseNote: 'apps/starter/server/ai/summariseNote.ts',
	starterAiAllowance: 'apps/starter/server/ai/AiAllowance.ts',
	starterSession: 'apps/starter/server/http/session.ts',
	starterServer: 'apps/starter/server/http/createServer.ts',
	starterNote: 'apps/starter/server/models/Note.ts',
	flowExampleApp: 'packages/app/src/flows/examples/FlowExampleApp.ts',
	createTextFlow: 'packages/app/src/flows/examples/createTextFlow.ts',
	normalizeTextBlock: 'packages/app/src/flows/examples/normalizeTextBlock.ts',
	uppercaseTextBlock: 'packages/app/src/flows/examples/uppercaseTextBlock.ts',
	runTextFlow: 'packages/app/src/flows/examples/runTextFlow.ts',
	deferredReportJob: 'packages/app/src/queue/examples/DeferredReportJob.ts',
	runBackpressure: 'packages/app/src/queue/examples/runBackpressure.ts',
	runApplicationLinks: 'packages/app/src/url/examples/runApplicationLinks.ts',
	exportRequest: 'packages/app/src/serialization/examples/ExportRequest.ts',
	runExportSerialization: 'packages/app/src/serialization/examples/runExportSerialization.ts',
	createPublicPageServer: 'packages/app/src/ssr/examples/createPublicPageServer.ts',
	runPublicPages: 'packages/app/src/ssr/examples/runPublicPages.ts',
	writeCsvExport: 'packages/app/src/storage/examples/writeCsvExport.ts',
	runStreamExport: 'packages/app/src/storage/examples/runStreamExport.ts',
	createPrivateFileServer: 'packages/app/src/media/examples/createPrivateFileServer.ts',
	runPrivateFiles: 'packages/app/src/media/examples/runPrivateFiles.ts',
	noteCodeField: 'packages/app/src/db/examples/NoteCodeField.ts',
	fieldNote: 'packages/app/src/db/examples/FieldNote.ts',
	runFieldNotes: 'packages/app/src/db/examples/runFieldNotes.ts',
	runNoteMigrations: 'packages/app/src/db/examples/runNoteMigrations.ts',
	runNoteLogs: 'packages/app/src/logging/examples/runNoteLogs.ts',
	runSecretRoundTrip: 'packages/app/src/security/examples/runSecretRoundTrip.ts',
	runNoteCache: 'packages/app/src/cache/examples/runNoteCache.ts',
	noteSavedEvent: 'packages/app/src/events/examples/NoteSaved.ts',
	runNoteEvents: 'packages/app/src/events/examples/runNoteEvents.ts',
	validateNoteInput: 'packages/app/src/validation/examples/validateNoteInput.ts',
	runNoteValidation: 'packages/app/src/validation/examples/runNoteValidation.ts',
	loadNotesConfig: 'packages/app/src/config/examples/loadNotesConfig.ts',
	runConfig: 'packages/app/src/config/examples/runConfig.ts',
	sendReportReady: 'packages/app/src/in-app/examples/sendReportReady.ts',
	userEndpoint: 'packages/app/src/websocket/examples/userEndpoint.ts',
	resourceChannels: 'packages/app/src/websocket/examples/resourceChannels.ts',
	deploymentSnapshot: 'packages/app/src/websocket/examples/deploymentSnapshot.ts',
	deploymentEndpoint: 'packages/app/src/websocket/examples/deploymentEndpoint.ts',
	boardSnapshot: 'packages/app/src/websocket/examples/board/boardSnapshot.ts',
	liveBoard: 'packages/app/src/websocket/examples/board/LiveBoard.ts',
	registerBoardRoutes: 'packages/app/src/websocket/examples/board/registerBoardRoutes.ts',
	createBoardStore: 'packages/app/src/websocket/examples/board/createBoardStore.ts',
	createChannelSync: 'packages/app/src/websocket/examples/createChannelSync.ts',
	createBoardClient: 'packages/app/src/websocket/examples/board/createBoardClient.ts',
	summarizeBoardJob: 'packages/app/src/websocket/examples/board/SummarizeBoardJob.ts',
	welcomeMessage: 'packages/app/src/mail/examples/welcomeMessage.ts',
	runMailPreview: 'packages/app/src/mail/examples/runMailPreview.ts',
	writeReportJob: 'packages/app/src/queue/examples/WriteReportJob.ts',
	runQueueReports: 'packages/app/src/queue/examples/runQueueReports.ts',
	reportConsole: 'packages/app/src/queue/examples/reportConsole.ts',
	generateReportJob: 'packages/app/src/queue/examples/GenerateReportJob.ts',
	createAndProcessReportJob: 'packages/app/src/queue/examples/createAndProcessReportJob.ts',
	dispatchReportWorkflows: 'packages/app/src/queue/examples/dispatchReportWorkflows.ts',
	manageReportRetries: 'packages/app/src/queue/examples/manageReportRetries.ts',
	definedUser: 'packages/app/src/db/examples/DefinedUser.ts',
	knowledgeNote: 'packages/app/src/db/examples/KnowledgeNote.ts',
	workspaceNotes: 'packages/app/src/db/examples/workspaceNotes.ts',
	createNotesTogether: 'packages/app/src/db/examples/createNotesTogether.ts',
	runWorkspaceNotes: 'packages/app/src/db/examples/runWorkspaceNotes.ts',
	createFirstServer: 'packages/app/src/server/examples/createFirstServer.ts',
	startFirstServer: 'packages/app/src/server/examples/startFirstServer.ts',
	runPasswordAuth: 'packages/app/src/auth/examples/runPasswordAuth.ts',
	runStorage: 'packages/app/src/storage/examples/runStorage.ts',
	runProjectMedia: 'packages/app/src/media/examples/runProjectMedia.ts',
	writeDailySummaryJob: 'packages/app/src/scheduler/examples/WriteDailySummaryJob.ts',
	registerDailySummary: 'packages/app/src/scheduler/examples/registerDailySummary.ts',
	runDailySummary: 'packages/app/src/scheduler/examples/runDailySummary.ts',
} as const;

/**
 * Deterministic outputs asserted by the owning service's example tests.
 */
const serviceExampleOutputPaths = {
	queueReports: 'packages/app/src/queue/examples/outputs/queue-reports.json',
	createAndProcessReportJob: 'packages/app/src/queue/examples/outputs/create-and-process-report-job.json',
	dispatchReportWorkflows: 'packages/app/src/queue/examples/outputs/dispatch-report-workflows.json',
	manageReportRetries: 'packages/app/src/queue/examples/outputs/manage-report-retries.json',
	workspaceNotes: 'packages/app/src/db/examples/outputs/workspace-notes.json',
} as const;
const documentationSourceEntries: Array<readonly [string, string]> = [];

for (const article of docArticles) {
	for (const sourcePath of [
		article.sourcePath,
		...(article.examplePaths ?? []),
		...(article.testPath ? [article.testPath] : []),
		...(article.additionalTestPaths ?? []),
	]) {
		try {
			await stat(new URL(sourcePath, repoRoot));
		} catch {
			missingSources.push(`${article.id}: ${sourcePath}`);
		}
	}
}

if (missingSources.length > 0) {
	throw new Error(`Documentation source paths are missing:\n${missingSources.join('\n')}`);
}

// Provenance is checked for every article above. Only service references, Pure
// and the generated app guide are published in assets and the complete feed;
// repository-level planning and release administration are not reader guides.
const publicSourcePaths = new Set(docArticles.map(article => article.sourcePath).filter(isPublicDocumentationSource));

for (const sourcePath of publicSourcePaths) {
	const sourceUrl = new URL(sourcePath, repoRoot);
	const sourceStats = await stat(sourceUrl);

	if (sourceStats.isFile()) {
		documentationSourceEntries.push([
			sourcePath,
			await readFile(sourceUrl, 'utf8'),
		]);
	}
}

const serviceExamples = { ...Object.fromEntries(await Promise.all(
	Object.entries(serviceExamplePaths).map(async ([id, sourcePath]) => {
		return [
			id,
			await readFile(new URL(sourcePath, repoRoot), 'utf8'),
		] as const;
	}),
)), ...helloGuideSamples };
const serviceExampleOutputs = Object.fromEntries(await Promise.all(
	Object.entries(serviceExampleOutputPaths).map(async ([id, sourcePath]) => {
		return [id, await readFile(new URL(sourcePath, repoRoot), 'utf8')] as const;
	}),
));
const frameworkPackage = JSON.parse(await readFile(frameworkPackagePath, 'utf8')) as FrameworkPackageManifest;

if (typeof frameworkPackage.name !== 'string' || frameworkPackage.name === '' || typeof frameworkPackage.version !== 'string' || frameworkPackage.version === '') {
	throw new Error('packages/app/package.json must define a workspace package name and a non-empty version.');
}

const frameworkAuthority = await generateFrameworkAuthority(repoRoot, docArticles);

const generatedDirectory = new URL('../client/generated/', import.meta.url);
const generatedPath = new URL('service-examples.ts', generatedDirectory);
const generatedMetadataPath = new URL('framework-metadata.ts', generatedDirectory);
const generatedDocumentationSourcesPath = new URL('documentation-sources.ts', generatedDirectory);
const generatedFrameworkAuthorityPath = new URL('framework-authority.ts', generatedDirectory);
const generatedSource = `/**
 * Service-owned example source generated for the documentation application.
 *
 * Regenerate with \`npm run generate --workspace @db3.ai/docs\`.
 */
export const serviceExampleSources = ${JSON.stringify(serviceExamples, null, '\t')} as const;

/**
 * Test-backed output rendered beside each service-owned example.
 */
export const serviceExampleOutputs = ${JSON.stringify(serviceExampleOutputs, null, '\t')} as const;
`;
const generatedMetadataSource = `/**
 * Framework package identity generated from packages/app/package.json.
 *
 * Regenerate with \`npm run generate --workspace @db3.ai/docs\`.
 */
export const frameworkPackageMetadata = ${JSON.stringify({
	name: frameworkAuthority.packageName,
	version: frameworkPackage.version,
}, null, '\t')} as const;
`;
const generatedDocumentationSources = `/**
 * Framework-owned documents referenced by the public documentation registry.
 *
 * Directory source records are intentionally omitted. Regenerate with
 * \`npm run generate --workspace @db3.ai/docs\`.
 */
export const documentationSourceContent = ${JSON.stringify(Object.fromEntries(documentationSourceEntries), null, '\t')} as const;
`;
const generatedFrameworkAuthority = `/**
 * Publish-shaped public API and behavioural-test authority generated from the
 * clean framework package staging workflow and documentation registry.
 *
 * Regenerate with \`npm run generate --workspace @db3.ai/docs\`.
 */
export const frameworkAuthority = ${JSON.stringify(frameworkAuthority, null, '\t')} as const;
`;

await mkdir(generatedDirectory, { recursive: true });
await writeFile(generatedPath, generatedSource, 'utf8');
await writeFile(generatedMetadataPath, generatedMetadataSource, 'utf8');
await writeFile(generatedDocumentationSourcesPath, generatedDocumentationSources, 'utf8');
await writeFile(generatedFrameworkAuthorityPath, generatedFrameworkAuthority, 'utf8');

console.log(`Verified ${docArticles.length} documentation source records for ${PUBLIC_APP_PACKAGE} ${frameworkPackage.version} and generated ${documentationSourceEntries.length} source documents, ${frameworkAuthority.publicExports.length} public declaration entries, ${Object.keys(frameworkAuthority.behaviourTestSources).length} behavioural test sources, ${Object.keys(serviceExamples).length} service examples, and ${Object.keys(serviceExampleOutputs).length} outputs.`);
