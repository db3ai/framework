import type { AiInputFeatureOption } from '@getdom/studio/vue';

/** Models a prompt can run on: the app's default shows as Auto, each model lists its speeds. */
export interface AiPromptModels {
	default: string;
	options: string[];
	speeds?: Record<string, AiInputFeatureOption[]>;
}
