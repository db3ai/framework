import type { ActiveRecord, ActiveRecordClass } from '../ActiveRecord';
import { EncryptedJsonField, type EncryptedJsonFieldConfig } from './EncryptedJsonField';
import {
	BooleanField,
	type BooleanFieldConfig,
	BigIncrementsField,
	CharUuidField,
	type CharUuidFieldConfig,
	ChoiceStringField,
	type ChoiceStringFieldConfig,
	DecimalField,
	type DecimalFieldConfig,
	EmailField,
	type EmailFieldConfig,
	JsonField,
	type JsonFieldConfig,
	JsonStringField,
	type JsonStringFieldConfig,
	IntegerField,
	type IntegerFieldConfig,
	LinkField,
	type LinkFieldConfig,
	PasswordField,
	type PasswordFieldConfig,
	StringListField,
	type StringListFieldConfig,
	StringField,
	type StringFieldConfig,
	TextField,
	type TextFieldConfig,
	TimestampField,
	type TimestampFieldConfig,
	UlidField,
	type UlidFieldConfig,
	UrlField,
	type UrlFieldConfig,
	VectorField,
	type VectorFieldConfig,
} from './index';

export { createField } from './createField';

export interface FieldBuilder {
	bigIncrements(config?: IntegerFieldConfig): BigIncrementsField;
	boolean(config?: BooleanFieldConfig): BooleanField;
	charUuid(config?: CharUuidFieldConfig): CharUuidField;
	choice(config: ChoiceStringFieldConfig): ChoiceStringField;
	decimal(config?: DecimalFieldConfig): DecimalField;
	email(config?: EmailFieldConfig): EmailField;
	/** Creates authenticated encrypted JSON stored in a non-queryable long text column. */
	encryptedJson<TValue>(config?: EncryptedJsonFieldConfig): EncryptedJsonField<TValue>;
	/** Creates a permissive JSON field for arbitrary JSON-compatible values. */
	json<TValue>(config?: JsonFieldConfig): JsonField<TValue | null>;
	/** Creates a backwards-compatible JSON field that serializes values for storage. */
	jsonString<TValue>(config?: JsonStringFieldConfig): JsonStringField<TValue>;
	/** Creates a JSON field serializes into a `text` column. */
	jsonText<TValue>(config?: JsonStringFieldConfig): JsonStringField<TValue>;
	/** Creates a JSON field serializes into a `longtext` column. */
	jsonLongText<TValue>(config?: JsonStringFieldConfig): JsonStringField<TValue>;
	integer(config?: IntegerFieldConfig): IntegerField;
	link<TRecord extends ActiveRecord>(
		target: () => ActiveRecordClass<TRecord>,
		config?: Omit<LinkFieldConfig<TRecord>, 'target'>,
	): LinkField<TRecord>;
	/** Creates a JSON-backed list of normalized strings. */
	stringList(config?: StringListFieldConfig): StringListField;
	password(config: PasswordFieldConfig): PasswordField;
	string(config?: StringFieldConfig): StringField;
	text(config?: TextFieldConfig): TextField;
	longText(config?: TextFieldConfig): TextField;
	timestamp(config?: TimestampFieldConfig): TimestampField;
	ulid(config?: UlidFieldConfig): UlidField;
	url(config?: UrlFieldConfig): UrlField;
	/** Creates a native numeric vector field for embeddings. */
	vector(config?: VectorFieldConfig): VectorField;
}

export const field: FieldBuilder = {
	bigIncrements(config: IntegerFieldConfig = {}): BigIncrementsField {
		return new BigIncrementsField(config);
	},

	boolean(config: BooleanFieldConfig = {}): BooleanField {
		return new BooleanField(config);
	},

	charUuid(config: CharUuidFieldConfig = {}): CharUuidField {
		return new CharUuidField(config);
	},

	choice(config: ChoiceStringFieldConfig): ChoiceStringField {
		return new ChoiceStringField(config);
	},

	decimal(config: DecimalFieldConfig = {}): DecimalField {
		return new DecimalField(config);
	},

	email(config: EmailFieldConfig = {}): EmailField {
		return new EmailField(config);
	},

	/**
	 * Creates authenticated encrypted JSON stored in a non-queryable long text column.
	 */
	encryptedJson<TValue>(
		config: EncryptedJsonFieldConfig = {},
	): EncryptedJsonField<TValue> {
		return new EncryptedJsonField<TValue>(config);
	},

	/**
	 * Creates a permissive JSON field for arbitrary JSON-compatible values.
	 */
	json<TValue>(
		config: JsonFieldConfig = {},
	): JsonField<TValue | null> {
		return new JsonField<TValue | null>(config);
	},

	/**
	 * Creates a backwards-compatible JSON field that serializes values for storage.
	 */
	jsonString<TValue>(
		config: JsonStringFieldConfig = {},
	): JsonStringField<TValue> {
		return new JsonStringField<TValue>(config);
	},

	/**
	 * Creates a JSON field serialized into a `text` column.
	 */
	jsonText<TValue>(
		config: JsonStringFieldConfig = {},
	): JsonStringField<TValue> {
		return new JsonStringField<TValue>({
			...config,
			dbType: 'text',
		});
	},

	/**
	 * Creates a JSON field serialized into a `longtext` column.
	 */
	jsonLongText<TValue>(
		config: JsonStringFieldConfig = {},
	): JsonStringField<TValue> {
		return new JsonStringField<TValue>({
			...config,
			dbType: 'longtext',
		});
	},

	integer(config: IntegerFieldConfig = {}): IntegerField {
		return new IntegerField(config);
	},

	link<TRecord extends ActiveRecord>(
		target: () => ActiveRecordClass<TRecord>,
		config: Omit<LinkFieldConfig<TRecord>, 'target'> = {},
	): LinkField<TRecord> {
		return new LinkField<TRecord>({
			...config,
			target,
		});
	},

	/**
	 * Creates a JSON-backed list of normalized strings.
	 */
	stringList(config: StringListFieldConfig = {}): StringListField {
		return new StringListField(config);
	},

	password(config: PasswordFieldConfig): PasswordField {
		return new PasswordField(config);
	},

	string(config: StringFieldConfig = {}): StringField {
		return new StringField(config);
	},

	text(config: TextFieldConfig = {}): TextField {
		return new TextField(config);
	},

	longText(config: TextFieldConfig = {}): TextField {
		return field.text(config)
	},

	timestamp(config: TimestampFieldConfig = {}): TimestampField {
		return new TimestampField(config);
	},

	ulid(config: UlidFieldConfig = {}): UlidField {
		return new UlidField(config);
	},

	url(config: UrlFieldConfig = {}): UrlField {
		return new UrlField(config);
	},

	/**
	 * Creates a native numeric vector field for embeddings.
	 */
	vector(config: VectorFieldConfig = {}): VectorField {
		return new VectorField(config);
	},
};
