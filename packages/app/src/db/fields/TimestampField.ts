import { utcDate } from '@db3.ai/pure/dates';
import {
	BasicFieldState,
	DbSchemaPart,
	DbWriteData,
	DbWriteOptions,
	FieldConfig,
	FieldContext,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';

/**
 * Configuration for timestamp/date-time fields.
 */
export interface TimestampFieldConfig extends FieldConfig {
	/** Timestamp precision, e.g. 0 for `timestamp(0)`. */
	precision?: number;

	/** Automatically set the timestamp on create/update. */
	auto?: 'create' | 'update' | 'both';
}

/**
 * Timestamp field using `Date | null` in app memory.
 *
 * The database driver may return dates as Date objects or strings depending on
 * dialect/configuration; this field normalises both to `Date`.
 */
export class TimestampField extends FieldType<
	Date | null,
	Date | string | null,
	string | null,
	unknown,
	BasicFieldState<Date | null>
> {
	declare public readonly config: TimestampFieldConfig;

	constructor(config: TimestampFieldConfig = {}) {
		super({
			precision: 0,
			...config,
		});
	}

	/**
	 * Parses app input into a Date object.
	 */
	protected override parse(input: unknown): Date | null {
		return input instanceof Date || typeof input === 'string' ? utcDate(input) : null;
	}

	/**
	 * Converts database value into app-memory Date.
	 */
	protected override fromDbValue(input: unknown): Date | null {
		return this.parse(input);
	}

	/**
	 * Converts app-memory Date to database value.
	 */
	protected override toDbValue(input: Date | null): Date | string | null {
		if (input === null || input === undefined) {
			return null;
		}

		// PostgreSQL timestamp-without-timezone ignores offsets on Date parameters.
		// Send UTC calendar components explicitly rather than the driver's local rendering.
		return this.schemaDialect().name === 'postgres'
			? input.toISOString().replace('T', ' ').replace('Z', '')
			: input;
	}

	protected override defaultFormComponent(): string {
		return 'DomDatePicker';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return 'DomDateRange';
	}

	/**
	 * Returns an ISO string for JSON output.
	 */
	override getDisplayValue(
		state: BasicFieldState<Date | null>,
		ctx?: FieldContext,
	): string | null | undefined {
		return this.withContext(ctx, () => {
			if (this.config.hidden) {
				return undefined;
			}

			return state.value ? state.value.toISOString() : null;
		});
	}

	/**
	 * Automatically sets create/update timestamps when configured.
	 */
	override getDataForDb(
		state: BasicFieldState<Date | null>,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override getDataForDb(
		state: BasicFieldState<Date | null>,
		ctx: FieldContext,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override async getDataForDb(
		state: BasicFieldState<Date | null>,
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): Promise<DbWriteData> {
		const args = this.resolveDbWriteArgs(ctxOrOptions, options);

		return this.withContext(args.ctx, async () => {
			if (
				this.config.auto === 'both' ||
				(this.config.auto === 'create' && args.options.isInsert) ||
				(this.config.auto === 'update' && !args.options.isInsert)
			) {
				state.value = new Date();
				state.dirty = true;
			}

			return super.getDataForDb(state, args.options);
		});
	}

	/**
	 * Describes the timestamp database column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const precision = this.config.precision ?? 0;
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.timestamp(precision),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
						default: this.getDbDefaultValue(),
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}
}
