import { describe, expect, it } from 'vitest';
import { readDeploymentSnapshot, type DeploymentSnapshot } from '../../examples/deploymentSnapshot';

const queued: DeploymentSnapshot = { id: 'deploy-1', environmentId: 'production', revision: 1, releaseId: 'release-new', activeReleaseId: 'release-old', phase: 'queued', health: 'unknown', message: 'Waiting for the environment lock' };
const expected = { id: queued.id, environmentId: queued.environmentId };

describe('deployment progress projection', () => {
	it('restores saved progress after reload and rejects old or duplicate updates', () => {
		const checking = { ...queued, revision: 6, phase: 'checking', health: 'checking' };
		const restored = readDeploymentSnapshot(checking, expected, null);
		expect(restored.phase).toBe('checking');
		expect(readDeploymentSnapshot(queued, expected, restored)).toBe(restored);
		expect(readDeploymentSnapshot(checking, expected, restored)).toBe(restored);
	});
	it('requires both passed health and observed release identity before displaying live', () => {
		for (const incomplete of [{ health: 'unknown', activeReleaseId: queued.releaseId }, { health: 'passed', activeReleaseId: 'release-old' }]) {
			expect(() => readDeploymentSnapshot({ ...queued, ...incomplete, phase: 'live' }, expected, null)).toThrow('Live requires');
		}
		expect(readDeploymentSnapshot({ ...queued, revision: 8, phase: 'live', health: 'passed', activeReleaseId: queued.releaseId }, expected, queued).phase).toBe('live');
	});
	it('keeps a failed candidate separate from the active release and accepts a verified rollback snapshot', () => {
		const failed = readDeploymentSnapshot({ ...queued, revision: 6, phase: 'failed', health: 'failed', message: 'Candidate readiness failed' }, expected, queued);
		expect(failed.activeReleaseId).toBe('release-old');
		const rolledBack = readDeploymentSnapshot({ ...failed, revision: 7, phase: 'rolled-back', health: 'passed', message: 'Previous release restored and checked' }, expected, failed);
		expect(rolledBack.phase).toBe('rolled-back');
		expect(rolledBack.activeReleaseId).not.toBe(rolledBack.releaseId);
	});
	it('rejects cross-resource responses, unexpected private fields and excessive status messages', () => {
		for (const invalid of [{ ...queued, id: 'other' }, { ...queued, environmentId: 'other' }, { ...queued, secret: 'private' }, { ...queued, message: 'x'.repeat(501) }]) {
			expect(() => readDeploymentSnapshot(invalid, expected, null)).toThrow();
		}
		expect(() => readDeploymentSnapshot(queued, expected, { ...queued, id: 'previous' })).toThrow('Clear the previous');
	});
});
