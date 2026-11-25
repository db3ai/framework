/** Models a prompt can run on: the app's default shows as Auto, each model lists its speeds. */
export interface AiPromptModels<Speed extends string = string> {
	default: string;
	options: string[];
	speeds?: Record<string, { value: Speed; label: string }[]>;
}
