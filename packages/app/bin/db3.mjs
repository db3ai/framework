#!/usr/bin/env node
import { register } from 'tsx/esm/api';

// The workspace resolves public exports to TypeScript; installed packages resolve to JavaScript.
const unregister = register();
try {
	const { runDb3 } = await import('@db3.ai/app/cli');
	process.exitCode = await runDb3(process.argv.slice(2));
} finally {
	unregister();
}
