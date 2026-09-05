import {
	ActiveRecord,
	type FieldBuilder,
} from '../../index';
import type { EntityRef } from '../../fields/LinkField';

export interface TestProfile {
	theme: string;
	tags: string[];
}

export interface TestPostMetadata {
	published: boolean;
	labels: string[];
}

export class TestAccount extends ActiveRecord {
	static override table = 'test_accounts';
	static override primaryKey = 'id';
	static override returning = false;

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			name: field.string({
				required: true,
				maxLength: 80,
				length: 80,
			}),

			email: field.email({
				required: true,
				maxLength: 255,
				length: 255,
			}),

			password: field.password({
				required: true,
				minLength: 12,
			}),

			isActive: field.boolean({
				column: 'is_active',
				default: true,
				required: true,
			}),

			profile: field.jsonText<TestProfile>({
				column: 'profile_json',
			}),

			notes: field.text(),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare name: string | null;
	declare email: string | null;
	declare password: null;
	declare isActive: boolean | null;
	declare profile: TestProfile | null;
	declare notes: string | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;

	get emailDomain(): string | null {
		return this.email ? this.email.split('@')[1] : null;
	}
}

export class TestPost extends ActiveRecord {
	static override table = 'test_posts';
	static override primaryKey = 'id';
	static override returning = false;

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			author: field.link(() => TestAccount, {
				column: 'author_id',
				required: true,
				onDelete: 'CASCADE',
			}),

			title: field.string({
				required: true,
				maxLength: 120,
				length: 120,
			}),

			metadata: field.jsonText<TestPostMetadata>({
				column: 'metadata_json',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare author: EntityRef<TestAccount> | null;
	declare title: string | null;
	declare metadata: TestPostMetadata | null;
	declare createdAt: Date | null;
}

export class TestUser extends ActiveRecord {
	static override table = 'users';
	static override primaryKey = 'id';
	static override returning = false;

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			name: field.string({
				required: true,
				maxLength: 255,
				length: 255,
			}),

			email: field.email({
				required: true,
				maxLength: 255,
				length: 255,
				unique: true,
			}),

			password: field.password({
				required: true,
				minLength: 12,
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare name: string | null;
	declare email: string | null;
	declare password: null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
