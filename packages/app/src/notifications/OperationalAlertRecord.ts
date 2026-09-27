import { ActiveRecord, type FieldBuilder } from '../db';
import type { OperationalAlert } from './contracts/OperationalAlert';

/** Durable incident and independent channel acknowledgements; install through app migrations. */
export class OperationalAlertRecord extends ActiveRecord {
	static override table = 'operational_alerts';
	static override requestFillable: string[] = [];

	/** Defines durable delivery state, including a crash-expiring exclusive claim. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			key: field.string({ required: true, length: 255, unique: true }),
			alert: field.json<OperationalAlert>({ required: true }),
			email: field.string({ length: 255 }),
			webhookUrl: field.text({ column: 'webhook_url' }),
			emailSentAt: field.timestamp({ column: 'email_sent_at' }),
			webhookSentAt: field.timestamp({ column: 'webhook_sent_at' }),
			completedAt: field.timestamp({ column: 'completed_at', index: true }),
			nextAttemptAt: field.timestamp({ column: 'next_attempt_at', required: true, index: true }),
			attempts: field.integer({ required: true, default: 0 }),
			claim: field.string({ length: 36 }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string;
	declare key: string;
	declare alert: OperationalAlert;
	declare email: string | null;
	declare webhookUrl: string | null;
	declare emailSentAt: Date | null;
	declare webhookSentAt: Date | null;
	declare completedAt: Date | null;
	declare nextAttemptAt: Date;
	declare attempts: number;
	declare claim: string | null;
	declare createdAt: Date;
}
