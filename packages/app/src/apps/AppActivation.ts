import { ActiveRecord, type FieldBuilder } from '../db';

/**
 * One plugin's switch at one scope. A row exists only once someone has switched it; until then
 * the manifest's default holds. `key` is `app:scopeType:scopeId`, so each switch is one row.
 */
export class AppActivation extends ActiveRecord {
	static override table = 'db3_app_activations';

	/** Defines the switch, who last changed it and when. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			key: field.string({ required: true, length: 200, unique: true }),
			appId: field.string({ column: 'app_id', required: true, length: 48 }),
			scopeType: field.string({ column: 'scope_type', required: true, length: 24 }),
			scopeId: field.string({ column: 'scope_id', required: true, length: 120 }),
			on: field.boolean({ required: true }),
			changedBy: field.string({ column: 'changed_by', required: true, length: 120 }),
			changedAt: field.timestamp({ column: 'changed_at', auto: 'both' }),
		};
	}
	declare id: string | null;
	declare key: string;
	declare appId: string;
	declare scopeType: string;
	declare scopeId: string;
	declare on: boolean;
	declare changedBy: string;
	declare changedAt: Date | null;
}
