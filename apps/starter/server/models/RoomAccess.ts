import { ActiveRecord } from '@db3.ai/app/db';

/** Explicit demo-room grants, separate from signing in. */
export class RoomAccess extends ActiveRecord.define({
	table: 'collaboration_access',
	/** A unique room/account key prevents duplicate grants. */
	fields(field) {
		return { id: field.ulid(), key: field.string({ required: true, unique: true }) };
	},
}) {}
