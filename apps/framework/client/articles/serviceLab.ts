import type { DocCodeSample, DocContentSection, VerifiedExample } from '../docs';
import { frameworkAuthority } from '../generated/framework-authority';

/**
 * Builds copy/run/test instructions for one shipped service lab.
 *
 * Source tests deliberately keep the same relative example path after copying
 * into tests/{service}. No framework checkout is needed to run that test.
 *
 * @param service - Owning framework service directory.
 * @param runner - Shipped example runner filename without an extension.
 * @param testName - Owning example-test filename without its .test.ts suffix.
 * @returns Shared command samples and exact, generated test source.
 */
export function serviceLabSamples(service: string, runner: string, testName = runner): DocCodeSample[] {
	const path = `packages/app/src/${service}/tests/examples/${testName}.test.ts`;
	const sources: Readonly<Record<string, string>> = frameworkAuthority.behaviourTestSources;
	return [
		{ id: 'copy-lab', title: 'Copy the shipped example', language: 'bash', code: `mkdir -p examples\ncp -R node_modules/@db3.ai/app/src/${service}/examples/. examples/` },
		{ id: 'run-lab', title: 'Run the lab', language: 'bash', code: `npx tsx examples/${runner}.ts` },
		{ id: 'test-source', title: `tests/${service}/${testName}.test.ts`, language: 'typescript', code: sources[path] ?? '' },
		{ id: 'test-lab', title: 'Run your copied test and check types', language: 'bash', code: `npx vitest run tests/${service}/${testName}.test.ts\nnpx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts` },
	];
}

/**
 * Describes how to copy a real framework-owned test into the consuming app.
 *
 * @param service - Owning service name used for the local test directory.
 * @param testName - Test file basename.
 * @returns Anchored testing section with explicit consumer prerequisites.
 */
export function serviceLabTesting(service: string, testName: string): DocContentSection {
	return { id: 'testing', title: 'Testing', paragraphs: [
		'Create a `tests/' + service + '` directory and save the test below as `' + testName + '.test.ts`. It imports the example you copied into `examples/`. Keep the same folder layout so the relative import resolves.',
		'Run from the application root with the development dependencies from Installation. These are consumer tests, not commands that assume a framework checkout.' + (['auth', 'db', 'flows', 'media', 'queue', 'scheduler'].includes(service) ? ' This database lab needs the same test-only SQL credentials when run through Vitest.' : ''),
	], codeSampleId: 'test-source' };
}

/**
 * Attaches repository maintenance evidence without presenting it as a consumer command.
 *
 * @param service - Framework service that owns the tested outcome.
 * @param testName - Test basename.
 * @param description - Concrete workflow exercised by the test.
 * @param environment - Real dependencies required by the test.
 * @returns Evidence displayed consistently in the website and Markdown feed.
 */
export function serviceLabEvidence(service: string, testName: string, description: string, environment: string): VerifiedExample {
	return { description, testPath: `packages/app/src/${service}/tests/examples/${testName}.test.ts`, command: `npm run test:service --workspace packages/app -- ${service} --maxWorkers=1`, expectedOutput: 'The guide test passes against the real framework components.', environment };
}
