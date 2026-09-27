import { ActiveRecord } from '@db3.ai/app/db';
import type { RoomContents } from '../collaboration/contracts';

/** App-owned persistence for the small collaborative demo boards. */
export class CollaborationRoom extends ActiveRecord.define({
	table: 'collaboration_rooms',
	/** Defines the durable room identity and bounded JSON history. */
	fields(field) {
		return { id: field.ulid(), name: field.string({ required: true, unique: true }), contents: field.json<RoomContents>({ required: true }) };
	},
}) {}
