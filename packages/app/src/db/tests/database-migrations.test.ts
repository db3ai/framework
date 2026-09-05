import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ActiveRecord,
	type FieldBuilder,
	mariaDbDialect,
} from '../index';
import {
	collectModelSchema,
	DatabaseMigrationBaselineError,
	DatabaseMigrationLockError,
	DatabaseMigrationManager,
	DatabaseMigrationSourceGenerationError,
	diffSchemaSnapshots,
	emptySchemaSnapshot,
	hashSchemaSnapshot,
	normalizeSchemaValue,
	promoteDestructiveSchemaChanges,
	renderKnexMigration,
	serializeSchemaSnapshot,
	type SchemaColumn,
	type SchemaSnapshot,
	type SchemaTable,
} from '../migrations';
import { createGeneratedTestDatabase } from '../test/db';

const temporaryDirectories: string[] = [];
const clients: Knex[] = [];
const execFileAsync = promisify(execFile);
const MIGRATION_TEST_TIMEOUT_MS = 120000;

/**
 * Organization fixture used to exercise deterministic linked model metadata.
 */
class MigrationOrganization extends ActiveRecord {
	static override table = 'migration_organizations';
	static override primaryKey = 'id';
	static override comment = '  Organizations that own usage.  ';

	/**
	 * Declares the model fields used by schema migration tests.
	 *
	 * @param field - Framework field builder.
	 * @returns Static model field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			name: field.string({
				default: 'Unnamed',
				required: true,
				unique: true,
				comment: 'Organization name.',
			}),
		};
	}
}

/**
 * AI request fixture with an unnamed linked-field index and foreign key.
 */
class MigrationRequest extends ActiveRecord {
	static override table = 'migration_ai_requests';
	static override primaryKey = 'id';

	/**
	 * Declares the model fields used by schema migration tests.
	 *
	 * @param field - Framework field builder.
	 * @returns Static model field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			payload: field.json<{ message: string }>(),
			organization: field.link(() => MigrationOrganization, {
				column: 'organization_id',
				onDelete: 'RESTRICT',
			}),
		};
	}
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map(async client => {
		await client.destroy();
	}));
	await Promise.all(temporaryDirectories.splice(0).map(async directory => {
		await rm(directory, { recursive: true, force: true });
	}));
});

describe('model schema snapshots', () => {
	it('normalizes model order, comments, indexes, and foreign-key names', () => {
		const first = collectModelSchema([
			MigrationRequest,
			MigrationOrganization,
		], mariaDbDialect);
		const second = collectModelSchema([
			MigrationOrganization,
			MigrationRequest,
		], mariaDbDialect);

		expect(first).toEqual(second);
		expect(first.tables.map(table => table.name)).toEqual([
			'migration_ai_requests',
			'migration_organizations',
		]);
		expect(first.tables[1]?.comment).toBe('Organizations that own usage.');
		expect(first.tables[1]?.columns.find(column => column.name === 'name')?.comment)
			.toBe('Organization name.');
		expect(first.tables[0]?.indexes).toEqual([
			expect.objectContaining({
				name: 'migration_ai_requests_organization_id_index',
			}),
		]);
		expect(first.tables[0]?.foreignKeys).toEqual([
			expect.objectContaining({
				name: 'migration_ai_requests_organization_id_foreign',
				onDelete: 'RESTRICT',
			}),
		]);
		expect(hashSchemaSnapshot(first)).toBe(hashSchemaSnapshot(second));
		expect(serializeSchemaSnapshot(first)).toContain('\n\t"formatVersion": 1');
	});

	it('rejects executable or runtime object defaults', () => {
		expect(() => normalizeSchemaValue(new Date('2026-08-01T00:00:00Z'), 'created_at'))
			.toThrow('must be a static JSON-serializable value');
		expect(() => normalizeSchemaValue(() => 'value', 'token'))
			.toThrow('must be a static JSON-serializable value');
	});
});

describe('schema migration planning', () => {
	it('plans nullable linked columns and their index and foreign key safely', () => {
		const from = snapshot([
			table('ai_requests', [column('id', { nullable: false, primary: true })]),
			table('organizations', [column('id', { nullable: false, primary: true })]),
		]);
		const to = snapshot([
			{
				...from.tables[0]!,
				columns: [
					...from.tables[0]!.columns,
					column('organization_id'),
				],
				indexes: [{
					name: 'ai_requests_organization_id_index',
					columns: [{ name: 'organization_id' }],
					unique: false,
					type: 'normal',
				}],
				foreignKeys: [{
					name: 'ai_requests_organization_id_foreign',
					column: 'organization_id',
					referencesTable: 'organizations',
					referencesColumn: 'id',
					onDelete: 'RESTRICT',
				}],
			},
			from.tables[1]!,
		]);
		const plan = diffSchemaSnapshots(from, to);

		expect(plan.blockedChanges).toEqual([]);
		expect(plan.safeChanges.map(change => change.kind)).toEqual([
			'add_column',
			'add_index',
			'add_foreign_key',
		]);
	});

	it('allows deterministic alterations while blocking required columns without defaults', () => {
		const from = snapshot([
			table('articles', [
				column('id', { nullable: false, primary: true }),
				column('body', { type: 'varchar(255)', nullable: false }),
				column('legacy'),
			]),
		]);
		const to = snapshot([{
			...from.tables[0]!,
			comment: 'Published articles.',
			columns: [
				from.tables[0]!.columns[0]!,
				column('body', {
					type: 'text',
					nullable: true,
					comment: 'Article body.',
				}),
				column('required_value', { nullable: false }),
				column('defaulted_value', {
					nullable: false,
					default: 'ready',
				}),
			],
		}]);
		const plan = diffSchemaSnapshots(from, to);

		expect(plan.safeChanges).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: 'alter_table_comment' }),
			expect.objectContaining({
				kind: 'add_column',
				column: expect.objectContaining({ name: 'defaulted_value' }),
			}),
			expect.objectContaining({
				kind: 'alter_column',
				alterType: true,
				alterNullable: true,
				alterComment: true,
				alterDefault: false,
			}),
		]));
		expect(plan.blockedChanges.map(change => change.operation)).toEqual([
			'remove_column',
			'add_required_column',
		]);
	});

	it('promotes column removals when destructive generation is allowed', () => {
		const from = snapshot([
			table('articles', [
				column('id', { nullable: false, primary: true }),
				column('legacy'),
			]),
		]);
		const to = snapshot([
			table('articles', [
				column('id', { nullable: false, primary: true }),
			]),
		]);
		const plan = diffSchemaSnapshots(from, to);
		const promoted = promoteDestructiveSchemaChanges(plan);

		expect(promoted.blockedChanges).toEqual([]);
		expect(promoted.safeChanges).toEqual([
			expect.objectContaining({
				kind: 'drop_column',
				tableName: 'articles',
				columnName: 'legacy',
			}),
		]);
		expect(renderKnexMigration(promoted)).toContain(
			'table.dropColumn("legacy")',
		);
	});

	it('generates ordinary indexes on existing columns while reviewing unique indexes', () => {
		const from = snapshot([
			table('articles', [column('slug')]),
		]);
		const to = snapshot([{
			...from.tables[0]!,
			indexes: [
				{
					name: 'articles_slug_index',
					columns: [{ name: 'slug' }],
					unique: false,
					type: 'normal',
				},
				{
					name: 'articles_slug_unique',
					columns: [{ name: 'slug' }],
					unique: true,
					type: 'normal',
				},
			],
		}]);
		const plan = diffSchemaSnapshots(from, to);

		expect(plan.safeChanges).toEqual([
			expect.objectContaining({
				kind: 'add_index',
				index: expect.objectContaining({ name: 'articles_slug_index' }),
			}),
		]);
		expect(plan.blockedChanges).toEqual([
			expect.objectContaining({ operation: 'add_index_to_existing_columns' }),
		]);
	});

	it('generates static default changes as column alterations', () => {
		const from = snapshot([
			table('articles', [column('status', { default: 'draft' })]),
		]);
		const to = structuredClone(from);

		delete to.tables[0]!.columns[0]!.default;

		expect(diffSchemaSnapshots(from, to)).toMatchObject({
			blockedChanges: [],
			safeChanges: [{
				kind: 'alter_column',
				alterType: false,
				alterNullable: false,
				alterComment: false,
				alterDefault: true,
			}],
		});
	});
});

describe('Knex migration rendering', () => {
	it('freezes literal operations without model imports and refuses down migrations', () => {
		const desired = collectModelSchema([
			MigrationRequest,
			MigrationOrganization,
		], mariaDbDialect);
		const plan = diffSchemaSnapshots(emptySchemaSnapshot('mariadb'), desired);
		const source = renderKnexMigration(plan);

		expect(source).toContain("import type { Knex } from 'knex';");
		expect(source).not.toContain('MigrationRequest');
		expect(source).not.toContain('ActiveRecord');
		expect(source).toContain('table.specificType("organization_id", "char(26)")');
		expect(source).toContain('table.specificType("payload", "json")');
		expect(source).toContain('.foreign("organization_id", "migration_ai_requests_organization_id_foreign")');
		expect(source.indexOf('createTable("migration_organizations"'))
			.toBeLessThan(source.indexOf('.foreign("organization_id"'));
		expect(source).toContain('export async function down(_knex: Knex): Promise<void>');
		expect(source).toContain("throw new Error('Generated database migrations are forward-only.')");
	});

	it('renders complete column attributes for MariaDB modify statements', () => {
		const from = snapshot([
			table('settings', [column('status', {
				nullable: false,
				unique: true,
				default: 'active',
			})]),
		]);
		const to = structuredClone(from);

		to.tables[0]!.columns[0]!.comment = 'Current status.';

		const source = renderKnexMigration(diffSchemaSnapshots(from, to));

		expect(source).toContain('column.notNullable();');
		expect(source).toContain('column.defaultTo("active");');
		expect(source).toContain('column.comment("Current status.");');
		expect(source).not.toContain('column.unique();');
	});
});

describe('DatabaseMigrationManager generation', () => {
	it('generates one deterministic migration and then reports a no-op', async () => {
		const directory = await makeTemporaryDirectory();
		const client = makeClient();
		const manager = new DatabaseMigrationManager({
			db: client,
			models: [MigrationRequest, MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory: join(directory, 'migrations'),
			snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName: 'test_schema_migrations',
			environment: 'development',
			now: () => new Date('2026-08-01T12:34:56Z'),
		});

		const generated = await manager.makeMigration({ name: 'Initial model schema' });

		expect(generated).toMatchObject({
			generated: true,
			blocked: false,
		});
		expect(generated.file).toBe(join(
			directory,
			'migrations',
			'20260801123456_initial_model_schema.ts',
		));
		expect(await readFile(generated.file!, 'utf8')).toContain('export async function up');
		expect(await readFile(join(directory, 'schema.snapshot.json'), 'utf8'))
			.toContain('migration_ai_requests');
		expect(await manager.makeMigration()).toMatchObject({
			generated: false,
			blocked: false,
			file: null,
		});
	});

	it('refuses source generation in production', async () => {
		const directory = await makeTemporaryDirectory();
		const manager = new DatabaseMigrationManager({
			db: makeClient(),
			models: [MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory: join(directory, 'migrations'),
			snapshotFile: join(directory, 'schema.snapshot.json'),
			environment: 'production',
		});

		await expect(manager.makeMigration())
			.rejects.toBeInstanceOf(DatabaseMigrationSourceGenerationError);
		await expect(manager.sync())
			.rejects.toBeInstanceOf(DatabaseMigrationSourceGenerationError);
	});

	it('refuses concurrent source generation while the app lock exists', async () => {
		const directory = await makeTemporaryDirectory();
		const snapshotFile = join(directory, 'schema.snapshot.json');
		const lockFile = `${snapshotFile}.lock`;
		const manager = new DatabaseMigrationManager({
			db: makeClient(),
			models: [MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory: join(directory, 'migrations'),
			snapshotFile,
			environment: 'development',
		});

		await mkdir(directory, { recursive: true });
		await writeFile(lockFile, '{"pid":123}');

		await expect(manager.makeMigration())
			.rejects.toBeInstanceOf(DatabaseMigrationLockError);
	});

	it('enables matching initial-database baselining during development sync', async () => {
		const directory = await makeTemporaryDirectory();
		const manager = new DatabaseMigrationManager({
			db: makeClient(),
			models: [],
			dialect: mariaDbDialect,
			migrationsDirectory: join(directory, 'migrations'),
			snapshotFile: join(directory, 'schema.snapshot.json'),
			environment: 'development',
		});
		const migrate = vi.spyOn(manager, 'migrate').mockResolvedValue({
			applied: [],
			batch: null,
			baselined: null,
		});
		const plan = diffSchemaSnapshots(
			emptySchemaSnapshot('mariadb'),
			emptySchemaSnapshot('mariadb'),
		);
		vi.spyOn(manager, 'check').mockResolvedValue({
			schemaMatches: true,
			modelsMatchSnapshot: true,
			matches: true,
			plan,
			snapshotPlan: plan,
			migrations: {
				completed: [],
				pending: [],
				missingFiles: [],
			},
		});

		await manager.sync();

		expect(migrate).toHaveBeenCalledWith({ baselineIfMatching: true });
	});

	it('replays a generated TypeScript initial migration through Knex under tsx', async () => {
		const directory = await makeTemporaryDirectory();
		const generatedDatabase = await createGeneratedTestDatabase('migration_replay');
		const migrationTableName = 'test_generated_migrations';
		const migrationsDirectory = join(directory, 'migrations');
		const manager = new DatabaseMigrationManager({
			db: generatedDatabase.db,
			models: [MigrationRequest, MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory,
			snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName,
			environment: 'test',
			now: () => new Date('2026-08-01T12:34:56Z'),
		});

		try {
			await manager.makeMigration({ name: 'initial_model_schema' });
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);

			expect(await generatedDatabase.db.schema.hasTable('migration_organizations'))
				.toBe(true);
			expect(await generatedDatabase.db.schema.hasTable('migration_ai_requests'))
				.toBe(true);
			const jsonConstraints = await generatedDatabase.db('information_schema.CHECK_CONSTRAINTS')
				.select<{ CHECK_CLAUSE: string }[]>('CHECK_CLAUSE')
				.whereRaw('CONSTRAINT_SCHEMA = DATABASE()')
				.where('TABLE_NAME', 'migration_ai_requests')
				.whereRaw('LOWER(CHECK_CLAUSE) LIKE ?', ['%json_valid%']);

			expect(jsonConstraints).toEqual([
				expect.objectContaining({
					CHECK_CLAUSE: expect.stringContaining('json_valid'),
				}),
			]);
			expect((await manager.status()).migrations).toMatchObject({
				completed: ['20260801123456_initial_model_schema.ts'],
				pending: [],
				missingFiles: [],
			});
			const check = await manager.check();
			expect(check).toMatchObject({
				matches: true,
				schemaMatches: true,
				modelsMatchSnapshot: true,
			});

			await generatedDatabase.db.schema.dropTable(`${migrationTableName}_lock`);
			await generatedDatabase.db.schema.dropTable(migrationTableName);

			expect(await manager.migrate({ baselineIfMatching: true })).toMatchObject({
				applied: [],
				baselined: ['20260801123456_initial_model_schema.ts'],
			});

			await generatedDatabase.db.schema.dropTable(`${migrationTableName}_lock`);
			await generatedDatabase.db.schema.dropTable(migrationTableName);
			await generatedDatabase.db.schema.dropTable('migration_ai_requests');

			await expect(manager.migrate({ baselineIfMatching: true }))
				.rejects.toBeInstanceOf(DatabaseMigrationBaselineError);
		} finally {
			await generatedDatabase.destroy();
		}
	});

	it('accepts comment drift while rejecting renamed indexes', async () => {
		const directory = await makeTemporaryDirectory();
		const generatedDatabase = await createGeneratedTestDatabase('migration_compatibility');
		const migrationTableName = 'test_compatibility_migrations';
		const migrationsDirectory = join(directory, 'migrations');
		const manager = new DatabaseMigrationManager({
			db: generatedDatabase.db,
			models: [MigrationRequest, MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory,
			snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName,
			environment: 'test',
			now: () => new Date('2026-08-01T12:34:56Z'),
		});
		const commentTableName = MigrationOrganization.table;
		const indexTableName = MigrationRequest.table;
		const canonicalIndexName = 'migration_ai_requests_organization_id_index';
		const renamedIndexName = 'legacy_ai_requests_organization_index';

		try {
			await manager.makeMigration({ name: 'initial_model_schema' });
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);

			await generatedDatabase.db.schema.alterTable(commentTableName, table => {
				table.comment('Legacy table comment.');
			});
			await generatedDatabase.db.schema.alterTable(commentTableName, table => {
				const column = table.specificType('name', 'varchar(255)');

				column.notNullable();
				column.defaultTo('Unnamed');
				column.comment('Legacy column comment.');
				column.alter({ alterNullable: false, alterType: false });
			});
			await expect(manager.check()).resolves.toMatchObject({
				matches: true,
				schemaMatches: true,
				modelsMatchSnapshot: true,
			});
			await generatedDatabase.db.raw(
				'ALTER TABLE ?? RENAME INDEX ?? TO ??',
				[indexTableName, canonicalIndexName, renamedIndexName],
			);

			const renamedIndex = await manager.check();

			expect(renamedIndex).toMatchObject({
				matches: false,
				schemaMatches: false,
				modelsMatchSnapshot: true,
			});
			expect(renamedIndex.plan.safeChanges).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'add_index',
					index: expect.objectContaining({ name: canonicalIndexName }),
				}),
			]));

			await generatedDatabase.db.schema.dropTable(`${migrationTableName}_lock`);
			await generatedDatabase.db.schema.dropTable(migrationTableName);
			await expect(manager.migrate({ baselineIfMatching: true }))
				.rejects.toBeInstanceOf(DatabaseMigrationBaselineError);
			await generatedDatabase.db.raw(
				'ALTER TABLE ?? RENAME INDEX ?? TO ??',
				[indexTableName, renamedIndexName, canonicalIndexName],
			);

			await expect(manager.migrate({ baselineIfMatching: true })).resolves.toMatchObject({
				applied: [],
				baselined: ['20260801123456_initial_model_schema.ts'],
			});
		} finally {
			await generatedDatabase.destroy();
		}
	});

	it('preserves defaults and key constraints during generated comment alters', async () => {
		const directory = await makeTemporaryDirectory();
		const generatedDatabase = await createGeneratedTestDatabase('migration_alter');
		const migrationTableName = 'test_alter_migrations';
		const migrationsDirectory = join(directory, 'migrations');
		const manager = new DatabaseMigrationManager({
			db: generatedDatabase.db,
			models: [MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory,
			snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName,
			environment: 'test',
			now: () => new Date('2026-08-01T12:34:56Z'),
		});

		try {
			await manager.makeMigration({ name: 'initial_model_schema' });
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);

			const installed = collectModelSchema(
				[MigrationOrganization],
				mariaDbDialect,
			);
			const desired = structuredClone(installed);
			const table = desired.tables.find(candidate => {
				return candidate.name === 'migration_organizations';
			});

			if (!table) throw new Error('Migration organization table is missing.');

			table.columns.find(column => column.name === 'id')!.comment = 'Organization identifier.';
			table.columns.find(column => column.name === 'name')!.comment = 'Updated organization name.';

			const source = renderKnexMigration(diffSchemaSnapshots(installed, desired));
			await writeFile(
				join(migrationsDirectory, '20260801123500_update_comments.ts'),
				source,
			);
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);

			const columns = await generatedDatabase.db('information_schema.COLUMNS')
				.select<{
					name: string;
					nullable: string;
					defaultValue: unknown;
					comment: string;
				}[]>({
					name: 'COLUMN_NAME',
					nullable: 'IS_NULLABLE',
					defaultValue: 'COLUMN_DEFAULT',
					comment: 'COLUMN_COMMENT',
				})
				.whereRaw('TABLE_SCHEMA = DATABASE()')
				.where('TABLE_NAME', 'migration_organizations');
			const id = columns.find(column => column.name === 'id');
			const name = columns.find(column => column.name === 'name');
			const indexes = await mariaDbDialect.getTableIndexes(
				generatedDatabase.db,
				'migration_organizations',
			);

			expect(id).toMatchObject({
				nullable: 'NO',
				comment: 'Organization identifier.',
			});
			expect(name).toMatchObject({
				nullable: 'NO',
				comment: 'Updated organization name.',
			});
			expect(String(name?.defaultValue).replace(/^'|'$/g, '')).toBe('Unnamed');
			expect(indexes).toEqual(expect.arrayContaining([
				expect.objectContaining({
					primary: true,
					columns: [expect.objectContaining({ name: 'id' })],
				}),
				expect.objectContaining({
					unique: true,
					columns: [expect.objectContaining({ name: 'name' })],
				}),
			]));
		} finally {
			await generatedDatabase.destroy();
		}
	});

	it('applies required defaults, default removals, and ordinary indexes to existing data', async () => {
		const directory = await makeTemporaryDirectory();
		const generatedDatabase = await createGeneratedTestDatabase('migration_defaults');
		const migrationTableName = 'test_default_migrations';
		const migrationsDirectory = join(directory, 'migrations');
		const manager = new DatabaseMigrationManager({
			db: generatedDatabase.db,
			models: [MigrationOrganization],
			dialect: mariaDbDialect,
			migrationsDirectory,
			snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName,
			environment: 'test',
			now: () => new Date('2026-08-01T12:34:56Z'),
		});
		const organizationId = '01K23456789ABCDEFGHJKMNDEF';

		try {
			await manager.makeMigration({ name: 'initial_model_schema' });
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);
			await generatedDatabase.db('migration_organizations').insert({
				id: organizationId,
			});

			const installed = collectModelSchema(
				[MigrationOrganization],
				mariaDbDialect,
			);
			const desired = structuredClone(installed);
			const organizationTable = desired.tables.find(candidate => {
				return candidate.name === 'migration_organizations';
			});

			if (!organizationTable) {
				throw new Error('Migration organization table is missing.');
			}

			const nameColumn = organizationTable.columns.find(candidate => {
				return candidate.name === 'name';
			});

			if (!nameColumn) throw new Error('Migration organization name is missing.');

			delete nameColumn.default;
			organizationTable.columns.push(column('status', {
				nullable: false,
				default: 'active',
			}));
			organizationTable.indexes.push({
				name: 'migration_organizations_status_index',
				columns: [{ name: 'status' }],
				unique: false,
				type: 'normal',
			});

			const plan = diffSchemaSnapshots(installed, desired);

			expect(plan.blockedChanges).toEqual([]);
			expect(plan.safeChanges).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'alter_column',
					alterDefault: true,
				}),
				expect.objectContaining({
					kind: 'add_column',
					column: expect.objectContaining({ name: 'status' }),
				}),
				expect.objectContaining({
					kind: 'add_index',
					index: expect.objectContaining({
						name: 'migration_organizations_status_index',
					}),
				}),
			]));

			await writeFile(
				join(migrationsDirectory, '20260801123500_update_defaults.ts'),
				renderKnexMigration(plan),
			);
			await runGeneratedMigrations(
				generatedDatabase.databaseName,
				migrationsDirectory,
				migrationTableName,
			);

			const saved = await generatedDatabase.db('migration_organizations')
				.where('id', organizationId)
				.first<{ status: string }>();
			const columns = await generatedDatabase.db('information_schema.COLUMNS')
				.select<{ name: string; defaultValue: unknown }[]>({
					name: 'COLUMN_NAME',
					defaultValue: 'COLUMN_DEFAULT',
				})
				.whereRaw('TABLE_SCHEMA = DATABASE()')
				.where('TABLE_NAME', 'migration_organizations');
			const indexes = await mariaDbDialect.getTableIndexes(
				generatedDatabase.db,
				'migration_organizations',
			);

			expect(saved?.status).toBe('active');
			expect(columns.find(candidate => candidate.name === 'name')?.defaultValue)
				.toBeNull();
			expect(indexes).toEqual(expect.arrayContaining([
				expect.objectContaining({
					name: 'migration_organizations_status_index',
					unique: false,
				}),
			]));
		} finally {
			await generatedDatabase.destroy();
		}
	}, MIGRATION_TEST_TIMEOUT_MS);
});

/**
 * Creates one normalized MariaDB snapshot from test table definitions.
 *
 * @param tables - Normalized tables included in the snapshot.
 * @returns Version-one MariaDB schema snapshot.
 */
function snapshot(tables: SchemaTable[]): SchemaSnapshot {
	return {
		formatVersion: 1,
		dialect: 'mariadb',
		tables,
	};
}

/**
 * Creates one normalized test table with no indexes or foreign keys.
 *
 * @param name - Physical database table name.
 * @param columns - Normalized table columns.
 * @returns Normalized test table.
 */
function table(name: string, columns: SchemaColumn[]): SchemaTable {
	return {
		name,
		comment: null,
		columns,
		indexes: [],
		foreignKeys: [],
	};
}

/**
 * Creates one normalized varchar test column with selective overrides.
 *
 * @param name - Physical database column name.
 * @param overrides - Column properties to replace.
 * @returns Normalized test column.
 */
function column(
	name: string,
	overrides: Partial<SchemaColumn> = {},
): SchemaColumn {
	return {
		name,
		type: 'varchar(255)',
		nullable: true,
		primary: false,
		unique: false,
		comment: null,
		...overrides,
	};
}

/**
 * Creates and tracks one isolated test source directory.
 *
 * @returns Absolute temporary directory path.
 */
async function makeTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'platform-db-migrations-'));

	temporaryDirectories.push(directory);

	return directory;
}

/**
 * Creates a Knex MariaDB client without opening a database connection.
 *
 * @returns Tracked Knex client used by source-only manager tests.
 */
function makeClient(): Knex {
	const client = knex({ client: 'mysql2' });

	clients.push(client);

	return client;
}

/**
 * Applies generated TypeScript migrations through Knex under the same tsx
 * loader used by Scout's database command.
 *
 * @param databaseName - Disposable MariaDB database name.
 * @param migrationsDirectory - Absolute generated migration directory.
 * @param migrationTableName - Knex ledger table used by the test.
 * @returns Promise that resolves after the subprocess exits successfully.
 */
async function runGeneratedMigrations(
	databaseName: string,
	migrationsDirectory: string,
	migrationTableName: string,
): Promise<void> {
	await execFileAsync(process.execPath, [
		'--import',
		'tsx',
		new URL('./fixtures/run-generated-migrations.ts', import.meta.url).pathname,
		databaseName,
		migrationsDirectory,
		migrationTableName,
	], {
		cwd: join(import.meta.dirname, '../../../..'),
		env: process.env,
	});
}
