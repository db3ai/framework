import type { FlowBlockDefinition, FlowValue } from '../contracts';
import { exit } from '../defineBlock';

/** Exit a switch takes when no case matches. */
export const SWITCH_OTHER_EXIT = 'other';

/**
 * Sends the run down one exit per case, by value.
 *
 * ```json
 * "route": { "type": "control.switch", "config": { "value": "{{classify.kind}}", "cases": ["spam", "lead"] } }
 * ```
 * gives exits `spam`, `lead` and `other`.
 */
export const ControlSwitch: FlowBlockDefinition = {
	type: 'control.switch',
	name: 'Switch',
	description: 'One exit per value; anything else takes "other".',
	inputs: {
		value: { type: 'json', description: 'Value to match, usually a reference.' },
	},
	config: {
		cases: { type: 'array', required: true, description: 'Values that each get their own exit.' },
	},
	outputs: {
		value: { type: 'json' },
	},
	exitsFor(config) {
		const cases = config.cases;
		if (!Array.isArray(cases) || !cases.length) throw new Error('A switch needs at least one case.');
		const names = cases.map(item => String(item));
		if (names.includes(SWITCH_OTHER_EXIT)) throw new Error(`"${SWITCH_OTHER_EXIT}" is the switch's exit for no match; rename that case.`);
		return [...names, SWITCH_OTHER_EXIT];
	},
	run(input, context) {
		const cases = (context.config.cases as FlowValue[]).map(item => String(item));
		const value = input.value ?? null;
		const match = value === null ? undefined : cases.find(item => item === String(value));
		return exit(match ?? SWITCH_OTHER_EXIT, { value });
	},
};

const IF_TESTS = ['equals', 'not-equals', 'contains', 'greater-than', 'less-than', 'is-empty', 'is-true'] as const;

/**
 * Sends the run down `yes` or `no`.
 *
 * ```json
 * "hot": { "type": "control.if", "config": { "value": "{{qualify.score}}", "test": "greater-than", "compare": 7 } }
 * ```
 */
export const ControlIf: FlowBlockDefinition = {
	type: 'control.if',
	name: 'If',
	description: 'Yes and no exits.',
	exits: ['yes', 'no'],
	inputs: {
		value: { type: 'json' },
		compare: { type: 'json' },
	},
	config: {
		test: { type: 'string', default: 'is-true', description: IF_TESTS.join(', ') },
	},
	outputs: {
		value: { type: 'json' },
	},
	run(input, context) {
		const value = input.value ?? null;
		const compare = input.compare ?? null;
		const test = String(context.config.test ?? 'is-true');
		let result: boolean;

		switch (test) {
			case 'equals': result = JSON.stringify(value) === JSON.stringify(compare); break;
			case 'not-equals': result = JSON.stringify(value) !== JSON.stringify(compare); break;
			case 'contains': result = Array.isArray(value) ? value.some(item => JSON.stringify(item) === JSON.stringify(compare)) : String(value ?? '').includes(String(compare ?? '')); break;
			case 'greater-than': result = Number(value) > Number(compare); break;
			case 'less-than': result = Number(value) < Number(compare); break;
			case 'is-empty': result = value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length); break;
			case 'is-true': result = value === true || value === 'true' || value === 1; break;
			default: throw new Error(`Unknown test "${test}". Use one of: ${IF_TESTS.join(', ')}.`);
		}

		return exit(result ? 'yes' : 'no', { value });
	},
};
