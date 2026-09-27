import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJob, jobTemplate } from '@db3.ai/app/queue';

describe('application job scaffolding', () => {
	it('creates the same previewed job for CLI and editor consumers and refuses overwrites', async () => {
		const root = await mkdtemp(join(tmpdir(), 'db3-job-'));
		try {
			const result = await createJob({ appDirectory: root, name: 'GenerateReportJob' });
			expect(result.path).toBe(join(root, 'server/jobs/GenerateReportJob.ts'));
			expect(await readFile(result.path, 'utf8')).toBe(jobTemplate('GenerateReportJob'));
			await expect(createJob({ appDirectory: root, name: 'GenerateReportJob' })).rejects.toMatchObject({ code: 'EEXIST' });
			expect(await readFile(result.path, 'utf8')).toBe(result.source);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it.each(['../EscapeJob', 'bad name', 'class', 'Report', 'ReportJob;'])('rejects invalid or path-like class names: %s', name => {
		expect(() => jobTemplate(name)).toThrow('PascalCase');
	});
});
