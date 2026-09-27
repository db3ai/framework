import { z } from 'zod';

/** Public deployment status supplied by the application's deployment controller after persistence. */
export const deploymentSnapshotSchema = z.object({
	id: z.string().min(1).max(128),
	environmentId: z.string().min(1).max(128),
	revision: z.number().int().nonnegative(),
	releaseId: z.string().min(1).max(128),
	activeReleaseId: z.string().min(1).max(128).nullable(),
	phase: z.enum(['queued', 'building', 'migrating', 'starting', 'checking', 'switching', 'live', 'failed', 'rolled-back', 'cancelled']),
	health: z.enum(['unknown', 'checking', 'passed', 'failed']),
	/** A safe application message, never raw build output, environment values or provider errors. */
	message: z.string().max(500),
}).strict().superRefine((snapshot, context) => {
	if (snapshot.phase === 'live' && (snapshot.health !== 'passed' || snapshot.activeReleaseId !== snapshot.releaseId)) {
		context.addIssue({ code: 'custom', message: 'Live requires passed health and the intended active release.' });
	}
});

/** Validated browser projection; it neither executes a deployment nor measures infrastructure health. */
export type DeploymentSnapshot = z.infer<typeof deploymentSnapshotSchema>;

/**
 * Validates a snapshot for the selected environment/run and rejects older HTTP responses.
 * The server increments revision across the entire run, including retries and rollback.
 * @param input - Authorized HTTP response, treated as unknown until validation.
 * @param expected - Route-selected resource identities, independently authorized by the server.
 * @param current - Last accepted snapshot, or null after a fresh page load.
 * @returns The newest validated snapshot for this exact deployment.
 */
export function readDeploymentSnapshot(input: unknown, expected: { id: string; environmentId: string }, current: DeploymentSnapshot | null): DeploymentSnapshot {
	const next = deploymentSnapshotSchema.parse(input);
	if (next.id !== expected.id || next.environmentId !== expected.environmentId) throw new Error('Wrong deployment snapshot.');
	if (current && (current.id !== expected.id || current.environmentId !== expected.environmentId)) throw new Error('Clear the previous deployment before changing resources.');
	return current && next.revision <= current.revision ? current : next;
}
