import { z } from 'zod';

/** Browser-safe, bounded public projection; membership and queue internals never leave the server. */
export const boardSnapshotSchema = z.object({
	id: z.string().min(1),
	revision: z.number().int().nonnegative(),
	cards: z.array(z.object({ id: z.string().min(1), title: z.string().max(120), column: z.enum(['todo', 'doing', 'done']) })).max(100),
	activity: z.object({
		id: z.string().uuid(),
		status: z.enum(['queued', 'running', 'completed', 'failed']),
		result: z.string().nullable(),
	}).nullable(),
});

/** Complete authorized board state fetched after a channel invalidation or reconnect. */
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
