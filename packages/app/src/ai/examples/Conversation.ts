import { AiConversation } from '@db3.ai/app/ai';
import type { FieldBuilder } from '@db3.ai/app/db';

/** App-owned conversation fields appear in normal ActiveRecord queries and migrations. */
export class Conversation extends AiConversation {
	/** Keeps the framework fields and adds an application label. */
	static override fields(field: FieldBuilder) {
		return { ...super.fields(field), topic: field.string({ default: 'support', index: true }) };
	}

	declare topic: string | null;
}
