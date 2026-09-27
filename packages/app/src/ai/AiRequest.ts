import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db/ActiveRecord';
import type { EntityRef } from '@db3.ai/app/db/fields/LinkField';
import { AiConversation } from './AiConversation.js';
import { AiRateLimitBucket } from './AiRateLimitBucket.js';

export const AI_REQUEST_STATUS = {
	pending: 'pending',
	completed: 'completed',
	failed: 'failed',
} as const;

import type { AiRequestRunCostSummary } from './contracts/AiRequestRunCostSummary';
export type { AiRequestRunCostSummary } from './contracts/AiRequestRunCostSummary';

/** Auditable provider request with recursive usage and cost reporting. */
export class AiRequest extends ActiveRecord {
	static override table = 'ai_requests';
	static override primaryKey = 'id';
	static override comment = 'Audit log of AI provider requests and responses, used for debugging generated analysis and content features.';

	static readonly STATES = AI_REQUEST_STATUS;

	/**
	 * Totals one root request and every recursively linked descendant exactly once.
	 *
	 * The self-referencing relationship supports image generation, embeddings,
	 * and future nested agent runs without relying on conversation or timestamp
	 * heuristics.
	 *
	 * @param rootAiRequestId - Root request id for the run.
	 * @returns Recursive request-tree cost summary, or null when the root is absent.
	 *
	 * @example
	 * const cost = await AiRequest.runCostSummary(articleAiRequestId);
	 * console.log(cost?.totalCostUSD);
	 */
	static async runCostSummary(rootAiRequestId: string | null | undefined): Promise<AiRequestRunCostSummary | null> {
		if (!rootAiRequestId) return null;

		const root = await this.find(rootAiRequestId);

		if (!root?.id) return null;

		return (await this.runCostSummaries([root])).get(String(root.id)) ?? null;
	}

	/**
	 * Totals multiple known root requests and their descendants in one batched walk.
	 *
	 * @param roots - Root request records to aggregate.
	 * @returns Cost summaries keyed by root request id.
	 */
	static async runCostSummaries(roots: AiRequest[]): Promise<Map<string, AiRequestRunCostSummary>> {
		const requestsByRootId = new Map<string, AiRequest[]>();
		const rootIdByRequestId = new Map<string, string>();
		const seenIds = new Set<string>();
		let parentIds: string[] = [];

		for (const root of roots) {
			const rootId = root.id ? String(root.id) : null;

			if (!rootId || seenIds.has(rootId)) continue;

			seenIds.add(rootId);
			parentIds.push(rootId);
			rootIdByRequestId.set(rootId, rootId);
			requestsByRootId.set(rootId, [root]);
		}

		while (parentIds.length > 0) {
			const children = await this.query()
				.whereIn('parentAiRequest', parentIds)
				.all();
			const nextParentIds: string[] = [];

			for (const child of children) {
				const childId = child.id ? String(child.id) : null;
				const parentId = entityRefId(child.parentAiRequest);
				const rootId = parentId ? rootIdByRequestId.get(parentId) : null;

				if (!childId || !rootId || seenIds.has(childId)) continue;

				seenIds.add(childId);
				nextParentIds.push(childId);
				rootIdByRequestId.set(childId, rootId);
				requestsByRootId.get(rootId)?.push(child);
			}

			parentIds = nextParentIds;
		}

		return new Map(
			[...requestsByRootId.entries()].map(([rootId, requests]) => [
				rootId,
				AiRequest.#summarizeRequestTree(rootId, requests),
			]),
		);
	}

	/**
	 * Builds a run-cost summary from a resolved request tree.
	 *
	 * @param rootAiRequestId - Root request id.
	 * @param requests - Root request followed by its unique descendants.
	 * @returns Cost totals rounded to the persisted cost precision.
	 */
	static #summarizeRequestTree(
		rootAiRequestId: string,
		requests: AiRequest[],
	): AiRequestRunCostSummary {
		const root = requests[0];
		const rootCostUSD = requestKnownCost(root);
		const childCostUSD = requests
			.slice(1)
			.reduce((total, request) => total + requestKnownCost(request), 0);

		return {
			rootAiRequestId,
			requestCount: requests.length,
			providerRequestCount: requests.reduce((total, request) => total + requestProviderRequestCount(request), 0),
			inputTokens: requests.reduce((total, request) => total + requestTokenCount(request.inputTokens), 0),
			outputTokens: requests.reduce((total, request) => total + requestTokenCount(request.outputTokens), 0),
			totalTokens: requests.reduce((total, request) => total + requestTokenCount(request.totalTokens), 0),
			reasoningTokens: requests.reduce((total, request) => total + requestTokenCount(request.reasoningTokens), 0),
			cachedTokens: requests.reduce((total, request) => total + requestTokenCount(request.cachedTokens), 0),
			cacheWriteTokens: requests.reduce((total, request) => total + requestTokenCount(request.cacheWriteTokens), 0),
			rootCostUSD: roundCost(rootCostUSD),
			childCostUSD: roundCost(childCostUSD),
			totalCostUSD: roundCost(rootCostUSD + childCostUSD),
			unpricedRequestCount: requests.filter(request => !validRequestCost(request.costUSD)).length,
		};
	}

	/** Defines the durable request, response, rate-limit and measured usage fields. */
	static override fields(field: FieldBuilder): ReturnType<typeof ActiveRecord.fields> {
		return {
			id: field.ulid({
				comment: 'Stable id for this AI request/response log entry.',
			}),
			conversation: field.link(() => AiConversation, {
				column: 'conversation_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'AI conversation that groups this provider request with normalized messages.',
			}),
			parentAiRequest: field.link(() => AiRequest, {
				column: 'parent_ai_request_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Immediate parent AI request that caused this request, used to total nested run costs without double counting.',
			}),
			user: field.string({ column: 'user_id', index: true }),
			scope: field.string({ column: 'scope_id', index: true }),
			provider: field.string({
				required: false,
				default: 'openai',
				index: true,
				comment: 'AI provider used for this request.',
			}),
			model: field.string({
				required: false,
				index: true,
				comment: 'AI model used for this request.',
			}),
			operation: field.string({
				required: false,
				default: 'responses.create',
				index: true,
				comment: 'Provider operation used for this request.',
			}),
			status: field.choice({
				required: true,
				choices: Object.values(AI_REQUEST_STATUS),
				default: AI_REQUEST_STATUS.pending,
				comment: 'Status of this request.',
			}),
			request: field.jsonString({
				required: true,
				comment: 'Serialized request payload sent to the AI provider.',
			}),
			response: field.jsonString({
				required: false,
				comment: 'Serialized response payload returned by the AI provider.',
			}),
			providerRequestId: field.string({
				column: 'provider_request_id',
				required: false,
				index: true,
				comment: 'Provider request id used for API troubleshooting.',
			}),
			providerProcessingMs: field.integer({
				column: 'provider_processing_ms',
				required: false,
				unsigned: true,
				comment: 'Provider-reported processing duration in milliseconds.',
			}),
			rateLimitBucket: field.link(() => AiRateLimitBucket, {
				column: 'rate_limit_bucket_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Current-state rate-limit bucket used for this provider request; per-request headers live in rate_limit_snapshot.',
			}),
			rateLimitSnapshot: field.jsonString<Record<string, unknown>>({
				column: 'rate_limit_snapshot',
				required: false,
				comment: 'Parsed provider rate-limit headers captured for this request as an audit snapshot.',
			}),

			inputTokens: field.integer({
				column: 'input_tokens',
				required: false,
				unsigned: true,
				comment: 'Number of input tokens used for this request.',
			}),

			outputTokens: field.integer({
				column: 'output_tokens',
				required: false,
				unsigned: true,
				comment: 'Number of output tokens used for this request.',
			}),

			totalTokens: field.integer({
				column: 'total_tokens',
				required: false,
				unsigned: true,
				comment: 'Total tokens used for this request, when reported by the provider.',
			}),

			reasoningTokens: field.integer({
				column: 'reasoning_tokens',
				required: false,
				unsigned: true,
				comment: 'Reasoning output tokens reported by the provider, when available.',
			}),

			cachedTokens: field.integer({
				column: 'cached_tokens',
				required: false,
				unsigned: true,
				comment: 'Cached input tokens reported by the provider, when available.',
			}),

			cacheWriteTokens: field.integer({
				column: 'cache_write_tokens',
				required: false,
				unsigned: true,
				comment: 'Input tokens written into a billable provider prompt cache, when reported.',
			}),

			costUSD: field.decimal({
				column: 'cost_usd',
				required: false,
				precision: 14,
				scale: 8,
				comment: 'Complete computed cost of this request in USD; null when any chargeable dimension is unpriced.',
			}),

			knownCostUSD: field.decimal({
				column: 'known_cost_usd',
				required: false,
				precision: 14,
				scale: 8,
				comment: 'Known provider-cost subtotal in USD, including priced portions of an incompletely priced request.',
			}),

			durationMs: field.integer({
				column: 'duration_ms',
				required: false,
				unsigned: true,
				comment: 'Duration of this request in milliseconds.',
			}),

			errorCode: field.string({
				column: 'error_code',
				required: false,
				comment: 'Error code for this request.',
			}),

			errorMessage: field.text({
				column: 'error_message',
				required: false,
				comment: 'Error message for this request.',
			}),

			startedAt: field.timestamp({
				column: 'started_at',
				required: false,
				default: () => new Date(),
				comment: 'Time this request was started.',
			}),

			completedAt: field.timestamp({
				column: 'completed_at',
				required: false,
				comment: 'Time this request was completed.',
			}),

			metadata: field.jsonString<Record<string, unknown>>({
				required: false,
				comment: 'Structured application metadata for this request.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare conversation: EntityRef<AiConversation> | null;
	declare parentAiRequest: EntityRef<AiRequest> | null;
	declare request: unknown | null;
	declare response: unknown | null;
	declare providerRequestId: string | null;
	declare providerProcessingMs: number | null;
	declare rateLimitBucket: EntityRef<AiRateLimitBucket> | null;
	declare rateLimitSnapshot: Record<string, unknown> | null;
	declare user: unknown;
	declare scope: unknown;
	declare status: typeof AI_REQUEST_STATUS[keyof typeof AI_REQUEST_STATUS] | null;
	declare provider: string | null;
	declare model: string | null;
	declare operation: string | null;
	declare inputTokens: number | null;
	declare outputTokens: number | null;
	declare totalTokens: number | null;
	declare reasoningTokens: number | null;
	declare cachedTokens: number | null;
	declare cacheWriteTokens: number | null;
	declare costUSD: number | null;
	declare knownCostUSD: number | null;
	declare durationMs: number | null;
	declare errorCode: string | null;
	declare errorMessage: string | null;
	declare startedAt: Date | null;
	declare completedAt: Date | null;
	declare metadata: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
/**
 * Reads a linked record id from an ActiveRecord entity reference.
 *
 * @param value - Entity reference or raw relation value.
 * @returns Linked id, or null when unavailable.
 */
function entityRefId(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;

	const id = (value as { id?: unknown }).id;

	return id === null || id === undefined ? null : String(id);
}

/**
 * Checks whether a persisted request cost is safe to include in a run total.
 *
 * @param value - Persisted decimal value from an AI request.
 * @returns True when the value is finite and non-negative.
 */
function validRequestCost(value: string | number | null | undefined): boolean {
	const cost = Number(value);

	return value !== null && value !== undefined && Number.isFinite(cost) && cost >= 0;
}

/**
 * Converts a persisted request cost into a safe numeric value.
 *
 * @param value - Persisted decimal value from an AI request.
 * @returns Numeric cost, or zero when the request is unpriced.
 */
function requestCost(value: string | number | null | undefined): number {
	return validRequestCost(value) ? Number(value) : 0;
}

/**
 * Returns every priced portion known for one request.
 *
 * Completed hosted tools without a local pricing rule intentionally leave the
 * persisted request cost null. Agent responses still retain their priced model
 * and hosted-tool subtotal, so run reports can show a meaningful lower bound
 * instead of dropping known spend from the total.
 *
 * @param request - Tracked provider request.
 * @returns Complete persisted cost or the known agent-cost subtotal.
 */
function requestKnownCost(request: AiRequest | undefined): number {
	if (!request) return 0;
	if (validRequestCost(request.knownCostUSD)) return Number(request.knownCostUSD);
	if (validRequestCost(request.costUSD)) return Number(request.costUSD);

	const response = recordValue(request.response);
	const cost = recordValue(response?.cost);
	const modelCostUSD = requestCost(cost?.modelCostUSD as string | number | null | undefined);
	const hostedToolCostUSD = requestCost(cost?.hostedToolCostUSD as string | number | null | undefined);

	return roundCost(modelCostUSD + hostedToolCostUSD);
}

/**
 * Returns the number of provider operations represented by one tracked row.
 *
 * Agent rows aggregate several Responses API calls into one audit record. Other
 * provider rows represent one operation and therefore default to one.
 *
	 * @param request - Tracked provider request.
	 * @returns Non-negative provider-operation count.
 */
function requestProviderRequestCount(request: AiRequest): number {
	if (request.operation === 'agents.run.queue' || request.operation === 'agents.run.stream') {
		return 0;
	}

	const metadata = recordValue(request.metadata);

	if (metadata?.providerStarted === false) return 0;

	const response = recordValue(request.response);
	const usage = recordValue(response?.usage);
	const requests = Number(usage?.requests);

	return Number.isInteger(requests) && requests >= 0 ? requests : 1;
}

/**
 * Converts a persisted token count into a safe aggregate value.
 *
 * @param value - Persisted token count.
 * @returns Non-negative whole token count, or zero when unavailable.
 */
function requestTokenCount(value: number | null | undefined): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Narrows an unknown JSON value to an object.
 *
 * @param value - Persisted JSON value.
 * @returns Object value, or null for primitives and arrays.
 */
function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

/**
 * Rounds an aggregated cost to the precision stored by `ai_requests.cost_usd`.
 *
 * @param value - Cost value to round.
 * @returns Cost rounded to eight decimal places.
 */
function roundCost(value: number): number {
	return Math.round(value * 100_000_000) / 100_000_000;
}
