/** Completed provider text and measured usage, not a price or billing record. */
export interface TextResult {
	text: string;
	model: string;
	/** Provider response identifier, useful for support without recording the prompt. */
	id: string;
	/** Null when the provider did not return usage; never assume missing means free. */
	usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
}
