import { ActiveRecord, type FieldBuilder } from '../db';

/**
 * One plugin's activation at one scope. A row exists only once someone has changed it; until then
 * the manifest's default holds. `key` is `app:scopeType:scopeId`, so each activation is one row.
 */
export class PluginActivation extends ActiveRecord {
	static override table = 'db3_plugin_activations';

	/** Defines the state, who last changed it and when. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			key: field.string({ required: true, length: 200, unique: true }),
			appId: field.string({ column: 'app_id', required: true, length: 48 }),
			scopeType: field.string({ column: 'scope_type', required: true, length: 24 }),
			scopeId: field.string({ column: 'scope_id', required: true, length: 120 }),
			active: field.boolean({ required: true }),
			changedBy: field.string({ column: 'changed_by', required: true, length: 120 }),
			changedAt: field.timestamp({ column: 'changed_at', auto: 'both' }),
		};
	}
	declare id: string | null;
	declare key: string;
	declare appId: string;
	declare scopeType: string;
	declare scopeId: string;
	declare active: boolean;
	declare changedBy: string;
	declare changedAt: Date | null;
}
