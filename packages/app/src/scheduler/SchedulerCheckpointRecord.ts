import { ActiveRecord } from '../db';
import type { SchedulerCheckpoint } from './contracts';

/** Durable scheduler restart progress; register this model in the application's migration registry. */
export class SchedulerCheckpointRecord extends ActiveRecord.define({
	table: 'scheduler_checkpoints',
	fields: field => ({
		id: field.ulid(),
		name: field.string({ required: true, length: 120, unique: true }),
		value: field.json<{ evaluatedFor: string }>({ required: true }),
		updatedAt: field.timestamp({ column: 'updated_at', auto: 'update' }),
	}),
}) {
	/** Returns restart persistence for one stable scheduler name; concurrent saves never regress progress. */
	static checkpoint(name = 'default'): SchedulerCheckpoint {
		return {
			/** Establishes coverage before the first dispatch without resetting an existing scheduler. */
			async load(firstMinute: Date): Promise<Date> {
				let record = await SchedulerCheckpointRecord.where('name', name).first();
				if (!record) {
					try {
						record = await SchedulerCheckpointRecord.create({ name, value: { evaluatedFor: new Date(firstMinute.getTime() - 60_000).toISOString() } }).save();
					} catch (error) {
						record = await SchedulerCheckpointRecord.where('name', name).first();
						if (!record) throw error;
					}
				}
				return checkpointMinute(record.value!.evaluatedFor);
			},
			/** Advances only a valid, initialized UTC-minute cursor under a database row lock. */
			async save(evaluatedFor: Date): Promise<void> {
				const minute = checkpointMinute(evaluatedFor.toISOString());
				await SchedulerCheckpointRecord.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
					const row = await SchedulerCheckpointRecord.where('name', name).toKnex().forUpdate().first();
					if (!row) throw new Error('Scheduler checkpoint must be initialized before advancing it.');
					const record = SchedulerCheckpointRecord.fromDb(row);
					if (checkpointMinute(record.value!.evaluatedFor).getTime() >= minute.getTime()) return;
					record.value = { evaluatedFor: minute.toISOString() };
					await record.save();
				}));
			},
		};
	}
}

/** Rejects corrupt progress rather than silently skipping an unknown scheduling window. */
function checkpointMinute(value: unknown): Date {
	const minute = new Date(typeof value === 'string' ? value : NaN);
	if (!Number.isFinite(minute.getTime()) || minute.getTime() % 60_000 !== 0) throw new Error('Scheduler checkpoint requires a valid UTC minute.');
	return minute;
}
