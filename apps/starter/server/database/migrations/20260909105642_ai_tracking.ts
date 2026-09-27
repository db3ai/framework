import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "3ba1af915c1aedaa7339c5f5a6bf0ad35c1241c57027cec319d594a7ee9f087b",
	to: "f14ed111bb552072838c18f3fe8be06051d82ab3404a0e335694cacafe8cb025",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("ai_conversations", table => {
		{
			const column = table.specificType("agent", "varchar(255)");
			column.nullable();
			column.comment("Local agent or feature name that created this conversation.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable id for this AI conversation.");
		}
		{
			const column = table.specificType("metadata", "json");
			column.nullable();
			column.comment("Structured application metadata for this AI conversation.");
		}
		{
			const column = table.specificType("scope_id", "varchar(255)");
			column.nullable();
			column.comment("Application-owned scope identifier, such as a team or project.");
		}
		{
			const column = table.specificType("title", "varchar(255)");
			column.nullable();
			column.comment("Short human-readable title for debugging or future UI display.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.nullable();
			column.comment("Application user identifier, when available.");
		}
		table.index("agent", "ai_conversations_agent_index");
		table.index("scope_id", "ai_conversations_scope_id_index");
		table.index("user_id", "ai_conversations_user_id_index");
		table.comment("Groups AI messages and provider requests into one app-level conversation or generated workflow run.");
	});

	await knex.schema.createTable("ai_messages", table => {
		{
			const column = table.specificType("ai_request_id", "char(26)");
			column.nullable();
			column.comment("Provider request that produced or used this message, when available.");
		}
		{
			const column = table.specificType("content", "longtext");
			column.nullable();
			column.comment("Text content for this AI message.");
		}
		{
			const column = table.specificType("content_json", "json");
			column.nullable();
			column.comment("Structured content for this AI message, when the response is not plain text.");
		}
		{
			const column = table.specificType("conversation_id", "char(26)");
			column.notNullable();
			column.comment("Conversation this message belongs to.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable id for this AI message.");
		}
		{
			const column = table.specificType("metadata", "json");
			column.nullable();
			column.comment("Structured application metadata for this message.");
		}
		{
			const column = table.specificType("model", "varchar(255)");
			column.nullable();
			column.comment("AI model associated with this message.");
		}
		{
			const column = table.specificType("provider", "varchar(255)");
			column.nullable();
			column.comment("AI provider associated with this message.");
		}
		{
			const column = table.specificType("role", "varchar(255)");
			column.notNullable();
			column.comment("Message role in the AI conversation.");
		}
		{
			const column = table.specificType("scope_id", "varchar(255)");
			column.nullable();
			column.comment("Application-owned scope identifier, such as a team or project.");
		}
		{
			const column = table.specificType("sequence", "int unsigned");
			column.notNullable();
			column.comment("Monotonic message order within the conversation.");
		}
		{
			const column = table.specificType("tool_call_id", "varchar(255)");
			column.nullable();
			column.comment("Provider or SDK call id for a tool invocation represented by this message.");
		}
		{
			const column = table.specificType("tool_name", "varchar(255)");
			column.nullable();
			column.comment("Tool name for tool-call messages.");
		}
		{
			const column = table.specificType("tool_state", "varchar(255)");
			column.nullable();
			column.comment("Execution state for a tool-call message.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.nullable();
			column.comment("Application user identifier, when available.");
		}
		table.index("ai_request_id", "ai_messages_ai_request_id_index");
		table.index("conversation_id", "ai_messages_conversation_id_index");
		table.index("model", "ai_messages_model_index");
		table.index("provider", "ai_messages_provider_index");
		table.index("scope_id", "ai_messages_scope_id_index");
		table.index("tool_call_id", "ai_messages_tool_call_id_index");
		table.index("tool_name", "ai_messages_tool_name_index");
		table.index("tool_state", "ai_messages_tool_state_index");
		table.index("user_id", "ai_messages_user_id_index");
		table.comment("Normalized AI conversation messages for prompts, assistant output, and tool messages.");
	});

	await knex.schema.createTable("ai_rate_limit_buckets", table => {
		{
			const column = table.specificType("bucket_key", "varchar(255)");
			column.notNullable();
			column.unique();
			column.comment("Stable provider:endpoint:limit-key identifier, for example openai:responses:gpt-5.4-nano.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("endpoint", "varchar(255)");
			column.notNullable();
			column.comment("Provider endpoint family this bucket tracks; responses and embeddings are separate limit pools.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable id for this rate-limit bucket.");
		}
		{
			const column = table.specificType("last_observed_at", "timestamp");
			column.nullable();
			column.comment("Time this bucket was last updated from provider headers.");
		}
		{
			const column = table.specificType("last_provider_request_id", "varchar(255)");
			column.nullable();
			column.comment("Most recent provider request id observed for this bucket.");
		}
		{
			const column = table.specificType("limit_key", "varchar(255)");
			column.notNullable();
			column.comment("Model or shared provider limit key used for throttling, not the app operation name.");
		}
		{
			const column = table.specificType("limit_project_tokens", "int unsigned");
			column.nullable();
			column.comment("Maximum project-scoped tokens allowed for the current provider window.");
		}
		{
			const column = table.specificType("limit_requests", "int unsigned");
			column.nullable();
			column.comment("Maximum requests allowed for the current provider window.");
		}
		{
			const column = table.specificType("limit_tokens", "int unsigned");
			column.nullable();
			column.comment("Maximum tokens allowed for the current provider window.");
		}
		{
			const column = table.specificType("metadata", "json");
			column.nullable();
			column.comment("Structured provider metadata for this bucket.");
		}
		{
			const column = table.specificType("project_tokens_reset_at", "timestamp");
			column.nullable();
			column.comment("Time when the project token limit window should reset.");
		}
		{
			const column = table.specificType("provider", "varchar(255)");
			column.notNullable();
			column.defaultTo("openai");
			column.comment("AI provider this bucket belongs to.");
		}
		{
			const column = table.specificType("remaining_project_tokens", "int unsigned");
			column.nullable();
			column.comment("Remaining project-scoped tokens from the latest provider headers before subtracting active reservations.");
		}
		{
			const column = table.specificType("remaining_requests", "int unsigned");
			column.nullable();
			column.comment("Remaining requests from the latest provider headers before subtracting active reservations.");
		}
		{
			const column = table.specificType("remaining_tokens", "int unsigned");
			column.nullable();
			column.comment("Remaining tokens from the latest provider headers before subtracting active reservations.");
		}
		{
			const column = table.specificType("requests_reset_at", "timestamp");
			column.nullable();
			column.comment("Time when the request limit window should reset.");
		}
		{
			const column = table.specificType("tokens_reset_at", "timestamp");
			column.nullable();
			column.comment("Time when the token limit window should reset.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		table.index("bucket_key", "ai_rate_limit_buckets_bucket_key_index");
		table.index("endpoint", "ai_rate_limit_buckets_endpoint_index");
		table.index("last_observed_at", "ai_rate_limit_buckets_last_observed_at_index");
		table.index("last_provider_request_id", "ai_rate_limit_buckets_last_provider_request_id_index");
		table.index("limit_key", "ai_rate_limit_buckets_limit_key_index");
		table.index("project_tokens_reset_at", "ai_rate_limit_buckets_project_tokens_reset_at_index");
		table.index("provider", "ai_rate_limit_buckets_provider_index");
		table.index("requests_reset_at", "ai_rate_limit_buckets_requests_reset_at_index");
		table.index("tokens_reset_at", "ai_rate_limit_buckets_tokens_reset_at_index");
		table.comment("Current AI provider rate-limit state by provider endpoint and model/shared limit key; not a historical usage table.");
	});

	await knex.schema.createTable("ai_rate_limit_reservations", table => {
		{
			const column = table.specificType("ai_request_id", "char(26)");
			column.nullable();
			column.comment("Tracked AI request associated with this reservation, when available.");
		}
		{
			const column = table.specificType("bucket_id", "char(26)");
			column.notNullable();
			column.comment("Rate-limit bucket this reservation consumes capacity from.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("expires_at", "timestamp");
			column.notNullable();
			column.comment("Time this reservation stops counting if it is not explicitly released.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable id for this rate-limit reservation.");
		}
		{
			const column = table.specificType("operation", "varchar(255)");
			column.nullable();
			column.comment("Application operation this reservation protects; bucket identity still comes from provider endpoint and limit key.");
		}
		{
			const column = table.specificType("released_at", "timestamp");
			column.nullable();
			column.comment("Time this reservation was released after provider completion or failure.");
		}
		{
			const column = table.specificType("reserved_requests", "int unsigned");
			column.notNullable();
			column.defaultTo(1);
			column.comment("Number of requests reserved against the bucket.");
		}
		{
			const column = table.specificType("reserved_tokens", "int unsigned");
			column.nullable();
			column.comment("Estimated tokens reserved against the bucket.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		table.index("ai_request_id", "ai_rate_limit_reservations_ai_request_id_index");
		table.index("bucket_id", "ai_rate_limit_reservations_bucket_id_index");
		table.index("expires_at", "ai_rate_limit_reservations_expires_at_index");
		table.index("operation", "ai_rate_limit_reservations_operation_index");
		table.index("released_at", "ai_rate_limit_reservations_released_at_index");
		table.comment("Short-lived in-flight reservations subtracted from current AI rate-limit buckets.");
	});

	await knex.schema.createTable("ai_requests", table => {
		{
			const column = table.specificType("cache_write_tokens", "int unsigned");
			column.nullable();
			column.comment("Input tokens written into a billable provider prompt cache, when reported.");
		}
		{
			const column = table.specificType("cached_tokens", "int unsigned");
			column.nullable();
			column.comment("Cached input tokens reported by the provider, when available.");
		}
		{
			const column = table.specificType("completed_at", "timestamp");
			column.nullable();
			column.comment("Time this request was completed.");
		}
		{
			const column = table.specificType("conversation_id", "char(26)");
			column.nullable();
			column.comment("AI conversation that groups this provider request with normalized messages.");
		}
		{
			const column = table.specificType("cost_usd", "decimal(14,8)");
			column.nullable();
			column.comment("Complete computed cost of this request in USD; null when any chargeable dimension is unpriced.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("duration_ms", "int unsigned");
			column.nullable();
			column.comment("Duration of this request in milliseconds.");
		}
		{
			const column = table.specificType("error_code", "varchar(255)");
			column.nullable();
			column.comment("Error code for this request.");
		}
		{
			const column = table.specificType("error_message", "longtext");
			column.nullable();
			column.comment("Error message for this request.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable id for this AI request/response log entry.");
		}
		{
			const column = table.specificType("input_tokens", "int unsigned");
			column.nullable();
			column.comment("Number of input tokens used for this request.");
		}
		{
			const column = table.specificType("known_cost_usd", "decimal(14,8)");
			column.nullable();
			column.comment("Known provider-cost subtotal in USD, including priced portions of an incompletely priced request.");
		}
		{
			const column = table.specificType("metadata", "json");
			column.nullable();
			column.comment("Structured application metadata for this request.");
		}
		{
			const column = table.specificType("model", "varchar(255)");
			column.nullable();
			column.comment("AI model used for this request.");
		}
		{
			const column = table.specificType("operation", "varchar(255)");
			column.nullable();
			column.defaultTo("responses.create");
			column.comment("Provider operation used for this request.");
		}
		{
			const column = table.specificType("output_tokens", "int unsigned");
			column.nullable();
			column.comment("Number of output tokens used for this request.");
		}
		{
			const column = table.specificType("parent_ai_request_id", "char(26)");
			column.nullable();
			column.comment("Immediate parent AI request that caused this request, used to total nested run costs without double counting.");
		}
		{
			const column = table.specificType("provider", "varchar(255)");
			column.nullable();
			column.defaultTo("openai");
			column.comment("AI provider used for this request.");
		}
		{
			const column = table.specificType("provider_processing_ms", "int unsigned");
			column.nullable();
			column.comment("Provider-reported processing duration in milliseconds.");
		}
		{
			const column = table.specificType("provider_request_id", "varchar(255)");
			column.nullable();
			column.comment("Provider request id used for API troubleshooting.");
		}
		{
			const column = table.specificType("rate_limit_bucket_id", "char(26)");
			column.nullable();
			column.comment("Current-state rate-limit bucket used for this provider request; per-request headers live in rate_limit_snapshot.");
		}
		{
			const column = table.specificType("rate_limit_snapshot", "json");
			column.nullable();
			column.comment("Parsed provider rate-limit headers captured for this request as an audit snapshot.");
		}
		{
			const column = table.specificType("reasoning_tokens", "int unsigned");
			column.nullable();
			column.comment("Reasoning output tokens reported by the provider, when available.");
		}
		{
			const column = table.specificType("request", "json");
			column.notNullable();
			column.comment("Serialized request payload sent to the AI provider.");
		}
		{
			const column = table.specificType("response", "json");
			column.nullable();
			column.comment("Serialized response payload returned by the AI provider.");
		}
		{
			const column = table.specificType("scope_id", "varchar(255)");
			column.nullable();
		}
		{
			const column = table.specificType("started_at", "timestamp");
			column.nullable();
			column.comment("Time this request was started.");
		}
		{
			const column = table.specificType("status", "varchar(255)");
			column.notNullable();
			column.defaultTo("pending");
			column.comment("Status of this request.");
		}
		{
			const column = table.specificType("total_tokens", "int unsigned");
			column.nullable();
			column.comment("Total tokens used for this request, when reported by the provider.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.nullable();
		}
		table.index("conversation_id", "ai_requests_conversation_id_index");
		table.index("model", "ai_requests_model_index");
		table.index("operation", "ai_requests_operation_index");
		table.index("parent_ai_request_id", "ai_requests_parent_ai_request_id_index");
		table.index("provider", "ai_requests_provider_index");
		table.index("provider_request_id", "ai_requests_provider_request_id_index");
		table.index("rate_limit_bucket_id", "ai_requests_rate_limit_bucket_id_index");
		table.index("scope_id", "ai_requests_scope_id_index");
		table.index("user_id", "ai_requests_user_id_index");
		table.comment("Audit log of AI provider requests and responses, used for debugging generated analysis and content features.");
	});

	await knex.schema.alterTable("ai_messages", table => {
		let foreign = table
			.foreign("ai_request_id", "ai_messages_ai_request_id_foreign")
			.references("id")
			.inTable("ai_requests");

		foreign = foreign.onDelete("SET NULL");
	});

	await knex.schema.alterTable("ai_messages", table => {
		let foreign = table
			.foreign("conversation_id", "ai_messages_conversation_id_foreign")
			.references("id")
			.inTable("ai_conversations");

		foreign = foreign.onDelete("CASCADE");
	});

	await knex.schema.alterTable("ai_rate_limit_reservations", table => {
		let foreign = table
			.foreign("ai_request_id", "ai_rate_limit_reservations_ai_request_id_foreign")
			.references("id")
			.inTable("ai_requests");

		foreign = foreign.onDelete("SET NULL");
	});

	await knex.schema.alterTable("ai_rate_limit_reservations", table => {
		let foreign = table
			.foreign("bucket_id", "ai_rate_limit_reservations_bucket_id_foreign")
			.references("id")
			.inTable("ai_rate_limit_buckets");

		foreign = foreign.onDelete("CASCADE");
	});

	await knex.schema.alterTable("ai_requests", table => {
		let foreign = table
			.foreign("conversation_id", "ai_requests_conversation_id_foreign")
			.references("id")
			.inTable("ai_conversations");

		foreign = foreign.onDelete("SET NULL");
	});

	await knex.schema.alterTable("ai_requests", table => {
		let foreign = table
			.foreign("parent_ai_request_id", "ai_requests_parent_ai_request_id_foreign")
			.references("id")
			.inTable("ai_requests");

		foreign = foreign.onDelete("SET NULL");
	});

	await knex.schema.alterTable("ai_requests", table => {
		let foreign = table
			.foreign("rate_limit_bucket_id", "ai_requests_rate_limit_bucket_id_foreign")
			.references("id")
			.inTable("ai_rate_limit_buckets");

		foreign = foreign.onDelete("SET NULL");
	});
}

/**
 * Refuses automatic rollback because generated MariaDB DDL is forward-only.
 *
 * @param _knex - Unused Knex connection supplied by the migration runner.
 * @returns Promise that always rejects before performing database DDL.
 */
export async function down(_knex: Knex): Promise<void> {
	throw new Error('Generated database migrations are forward-only.');
}
