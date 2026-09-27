import { ActiveRecord } from '@db3.ai/app/db';

/** A user whose properties and construction inputs are inferred from its fields. */
export class DefinedUser extends ActiveRecord.define({
	table: 'defined_users',
	requestFillable: ['email'],
	fields: field => ({
		id: field.ulid({ primary: true }),
		email: field.email({ required: true }),
	}),
}) {
	/**
	 * Returns the domain of the normalized email, or null before it is provided.
	 *
	 * @returns Current email domain.
	 */
	emailDomain(): string | null {
		return this.email?.split('@')[1] ?? null;
	}
}
