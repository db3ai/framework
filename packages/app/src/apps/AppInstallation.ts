import { ActiveRecord, type FieldBuilder } from '../db';
import type { AppDescription, AppInstallationState } from './contracts';

/** Framework-owned record retained after code removal; business tables and migration ledgers stay separate. */
export class AppInstallation extends ActiveRecord {
	static override table = 'db3_apps';

	/** Defines durable installation identity, desired state and retained ownership evidence. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			appId: field.string({ column: 'app_id', required: true, length: 48, unique: true }),
			version: field.string({ required: true, length: 64 }),
			state: field.string({ required: true, length: 24 }),
			description: field.json<AppDescription>({ required: true }),
			migrationHashes: field.json<Record<string, string>>({ column: 'migration_hashes', required: true }),
		};
	}
	declare id: string | null;
	declare appId: string;
	declare version: string;
	declare state: AppInstallationState;
	declare description: AppDescription;
	declare migrationHashes: Record<string, string>;
}
