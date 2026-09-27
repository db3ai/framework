import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db/ActiveRecord';

export const AI_RATE_LIMIT_ENDPOINT = {
	responses: 'responses',
	embeddings: 'embeddings',
	images: 'images',
} as const;

export type AiRateLimitEndpoint = typeof AI_RATE_LIMIT_ENDPOINT[keyof typeof AI_RATE_LIMIT_ENDPOINT];

/**
 * Current OpenAI rate-limit state for one provider endpoint/model bucket.
 *
 * Buckets are intentionally current-state rows, not historical usage rows. The
 * latest OpenAI response headers replace the request/token counters on this
 * model, while individual `ai_requests` keep the per-request audit snapshots.
 *
 * Keep bucket identity aligned to provider limits: provider + endpoint family +
 * model/shared limit key. Responses, Embeddings, and Images have different
 * OpenAI limits, so they must have different bucket keys even when the app
 * operation looks related. Do not split buckets by app operation unless the
 * provider exposes a separate limit for that operation.
 *
 * Active reservations are subtracted from these remaining counts before a worker
 * starts another provider call. This lets multiple queue workers share one
 * current bucket without racing past the observed provider capacity.
 */
export class AiRateLimitBucket extends ActiveRecord {
	static override table = 'ai_rate_limit_buckets';
	static override primaryKey = 'id';
	static override comment = 'Current AI provider rate-limit state by provider endpoint and model/shared limit key; not a historical usage table.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable id for this rate-limit bucket.',
			}),
			bucketKey: field.string({
				column: 'bucket_key',
				required: true,
				unique: true,
				index: true,
				comment: 'Stable provider:endpoint:limit-key identifier, for example openai:responses:gpt-5.4-nano.',
			}),
			provider: field.string({
				required: true,
				default: 'openai',
				index: true,
				comment: 'AI provider this bucket belongs to.',
			}),
			endpoint: field.choice({
				required: true,
				choices: Object.values(AI_RATE_LIMIT_ENDPOINT),
				index: true,
				comment: 'Provider endpoint family this bucket tracks; responses and embeddings are separate limit pools.',
			}),
			limitKey: field.string({
				column: 'limit_key',
				required: true,
				index: true,
				comment: 'Model or shared provider limit key used for throttling, not the app operation name.',
			}),
			limitRequests: field.integer({
				column: 'limit_requests',
				required: false,
				unsigned: true,
				comment: 'Maximum requests allowed for the current provider window.',
			}),
			remainingRequests: field.integer({
				column: 'remaining_requests',
				required: false,
				unsigned: true,
				comment: 'Remaining requests from the latest provider headers before subtracting active reservations.',
			}),
			requestsResetAt: field.timestamp({
				column: 'requests_reset_at',
				required: false,
				index: true,
				comment: 'Time when the request limit window should reset.',
			}),
			limitTokens: field.integer({
				column: 'limit_tokens',
				required: false,
				unsigned: true,
				comment: 'Maximum tokens allowed for the current provider window.',
			}),
			remainingTokens: field.integer({
				column: 'remaining_tokens',
				required: false,
				unsigned: true,
				comment: 'Remaining tokens from the latest provider headers before subtracting active reservations.',
			}),
			tokensResetAt: field.timestamp({
				column: 'tokens_reset_at',
				required: false,
				index: true,
				comment: 'Time when the token limit window should reset.',
			}),
			limitProjectTokens: field.integer({
				column: 'limit_project_tokens',
				required: false,
				unsigned: true,
				comment: 'Maximum project-scoped tokens allowed for the current provider window.',
			}),
			remainingProjectTokens: field.integer({
				column: 'remaining_project_tokens',
				required: false,
				unsigned: true,
				comment: 'Remaining project-scoped tokens from the latest provider headers before subtracting active reservations.',
			}),
			projectTokensResetAt: field.timestamp({
				column: 'project_tokens_reset_at',
				required: false,
				index: true,
				comment: 'Time when the project token limit window should reset.',
			}),
			lastProviderRequestId: field.string({
				column: 'last_provider_request_id',
				required: false,
				index: true,
				comment: 'Most recent provider request id observed for this bucket.',
			}),
			lastObservedAt: field.timestamp({
				column: 'last_observed_at',
				required: false,
				index: true,
				comment: 'Time this bucket was last updated from provider headers.',
			}),
			metadata: field.jsonString<Record<string, unknown>>({
				required: false,
				comment: 'Structured provider metadata for this bucket.',
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
	declare bucketKey: string | null;
	declare provider: string | null;
	declare endpoint: AiRateLimitEndpoint | null;
	declare limitKey: string | null;
	declare limitRequests: number | null;
	declare remainingRequests: number | null;
	declare requestsResetAt: Date | null;
	declare limitTokens: number | null;
	declare remainingTokens: number | null;
	declare tokensResetAt: Date | null;
	declare limitProjectTokens: number | null;
	declare remainingProjectTokens: number | null;
	declare projectTokensResetAt: Date | null;
	declare lastProviderRequestId: string | null;
	declare lastObservedAt: Date | null;
	declare metadata: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
