import { ActiveRecord, FieldType, EmailField, type ActiveRecordClass, type FieldBuilder } from '@db3.ai/app/db';

/** A field with a narrower input contract than the permissive built-in fields. */
class StrictScore extends FieldType<number, number, string, number | `${number}`> {}

/** A same-valued field with a different input boundary cannot override StrictScore. */
class NumericScore extends FieldType<number, number, string, number> {}

/** Inferred fields need no duplicate declarations or application type aliases. */
class User extends ActiveRecord.define({
	table: 'defined_users',
	fields: field => ({
		id: field.ulid({ primary: true }),
		email: field.email({ required: true }),
		password: field.password({}),
		score: new StrictScore(),
		backup: EmailField,
		configured: { type: EmailField, config: { required: true } },
		profile: field.json<{ enabled: boolean }>(),
	}),
}) {
	/** Returns the domain of the current normalized email. */
	domain(): string { return this.email?.split('@')[1] ?? ''; }
	/** Exposes a custom static inherited by further defined classes. */
	static category(): 'user' { return 'user'; }
	/** Exercises protected ActiveRecord APIs from an inferred subclass. */
	protected readEmail(): unknown { return this.$get('email'); }
}

/** Ordinary subclasses must retain both their own methods and inferred fields. */
class Admin extends User {
	/** Identifies the record's application role. */
	role(): 'admin' { return 'admin'; }
}

/** Further definitions compose fields and preserve ordinary subclass methods. */
class Staff extends Admin.define({
	fields: field => ({ email: field.email({ maxLength: 80 }), team: field.string() }),
}) {
	/** Identifies this additional inheritance level. */
	staff(): true { return true; }
}

const user = new User({ score: '12', password: 'secret', email: 123 });
const email: string | null = user.email;
const password: null = user.password;
const score: number = user.score;
const profile: { enabled: boolean } | null = user.profile;
const backup: EmailField = User.fields({} as FieldBuilder).backup.prototype;
const configured: typeof EmailField = User.fields({} as FieldBuilder).configured.type;
const instance: Staff = Staff.create({ team: 'Operations', score: 42 });
const role: 'admin' = instance.role();
const category: 'user' = Staff.category();
const model: ActiveRecordClass<Staff> = Staff;
const inferred: Partial<ActiveRecord.InferInput<typeof Staff>> = { email: {}, score: '12' };
const values: ActiveRecord.InferValue<typeof Staff>['score'] = 42;
const display: ActiveRecord.InferDisplay<typeof Staff>['score'] = '42';
const hydrated: Staff = Staff.fromDb({ email: 'staff@example.com' });
const rows: Promise<Staff[]> = Staff.query().all();
const filtered: Promise<Staff | null> = Staff.where('email', 'staff@example.com').first();
const found: Promise<Staff | null> = Staff.find('id');
const byPk: Promise<Staff | null> = Staff.findByPk('id');
const required: Promise<Staff> = Staff.findOrFail('id');
const trashed: Promise<Staff[]> = Staff.withTrashed().all();
const onlyTrashed: Promise<Staff[]> = Staff.onlyTrashed().all();
const withoutTrashed: Promise<Staff[]> = Staff.withoutTrashed().all();
const bound: typeof Staff = Staff.useDb(Staff.getDb());
const createdAdmin: Admin = Admin.create();
const createdUser: User = User.create();
const assigned: Staff = instance.assign({ score: '12' });
const saved: Promise<Staff> = instance.save();
const concreteEmail: EmailField = null as unknown as ActiveRecord.ResolvedField<ReturnType<typeof Staff.fields>['email']>;
const inheritedId: string | null = null as unknown as ActiveRecord.InferValue<typeof Staff>['id'];
user.email = 'user@example.com';
user.score = 123;
// @ts-expect-error Unknown constructor field.
new User({ unknownField: 1 });
// @ts-expect-error Strict field input is respected by constructors.
new User({ score: false });
// @ts-expect-error Unknown create field cannot widen the inferred receiver.
Staff.create({ unknownField: 1 });
// @ts-expect-error Strict field input is respected by create.
Staff.create({ score: false });
// @ts-expect-error Properties reflect hydrated values, not permissive input types.
user.email = 123;
// @ts-expect-error Strict numeric application value.
user.score = '12';
// @ts-expect-error Inferred properties have no string index signature.
user.unknownField;
// @ts-expect-error Known nested JSON shape is preserved.
user.profile = { enabled: 'yes' };
// @ts-expect-error Inference rejects unknown field keys.
const invalid: Partial<ActiveRecord.InferInput<typeof Staff>> = { missing: true };
// @ts-expect-error Only existing field instances, classes or definitions are accepted.
ActiveRecord.define({ fields: () => ({ invalid: 123 }) });
// @ts-expect-error Changing a field value type would invalidate inherited methods.
Admin.define({ fields: field => ({ email: field.integer() }) });
// @ts-expect-error Override input types must also stay compatible with inherited methods.
User.define({ fields: () => ({ score: new NumericScore() }) });
// @ts-expect-error Fields cannot replace inherited record methods.
ActiveRecord.define({ fields: field => ({ save: field.string() }) });
// @ts-expect-error Fields cannot replace custom instance methods.
User.define({ fields: field => ({ domain: field.string() }) });

/** Existing model declarations remain accepted as define bases and consumers. */
class Legacy extends ActiveRecord {
	/** Supplies existing fields without an inferred base. */
	static override fields(field: FieldBuilder) { return { legacy: field.string(), inferredLegacy: field.integer() }; }
	declare legacy: string | null;
}
class ExtendedLegacy extends Legacy.define({ fields: field => ({ added: field.integer() }) }) {}
const legacy: string | null = new ExtendedLegacy().legacy;
const added: number | null = new ExtendedLegacy().added;
const inheritedWithoutDeclare: number | null = new ExtendedLegacy().inferredLegacy;
void [email, password, score, profile, backup, configured, instance, role, category, model, inferred, values, display, hydrated, rows, filtered, found, byPk, required, trashed, onlyTrashed, withoutTrashed, bound, createdAdmin, createdUser, invalid, legacy, added];

const Direct = ActiveRecord.define({ fields: field => ({ title: field.string() }) });
const directValue: string | null = new Direct().title;
const directCreated: string | null = Direct.create().title;
const directFields = Direct.getFields();
const directQuery = Direct.query();
const directModel: ActiveRecordClass = Direct;
const directPrototype: string | null = Direct.prototype.title;
void [directValue, directCreated, directFields, directQuery, directModel, directPrototype];

const direct = Direct.create({ title: 'Inferred without declarations' });
direct.title = 'Updated title';
// @ts-expect-error Direct model properties retain their application value type.
direct.title = 123;
// @ts-expect-error Direct models expose only defined field names.
direct.unknownField;
// @ts-expect-error Direct constructors reject unknown fields.
new Direct({ unknownField: true });
// @ts-expect-error Direct creation rejects unknown fields.
Direct.create({ unknownField: true });

const Registered = model.define({ fields: field => ({ rank: field.integer() }) });
const registeredRole: 'admin' = new Registered().role();
void registeredRole;
