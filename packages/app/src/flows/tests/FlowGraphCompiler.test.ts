import { describe, expect, it } from 'vitest';

import { FLOW_SYSTEM_BLOCKS, FlowBlockRegistry, FlowDefinitionError, FlowGraphCompiler, type FlowGraphDefinition } from '../index';
import { graphTestBlocks, leadIntakeFlow } from './flowGraphFixtures';

const compiler = new FlowGraphCompiler(new FlowBlockRegistry([...FLOW_SYSTEM_BLOCKS, ...graphTestBlocks]));

/**
 * Compiles a flow and returns the problems found.
 *
 * @param definition - Flow file contents.
 * @returns Issue messages by path.
 */
function issues(definition: FlowGraphDefinition): Record<string, string> {
	try {
		compiler.compile(definition);
		return {};
	} catch (error) {
		if (!(error instanceof FlowDefinitionError)) throw error;
		return Object.fromEntries(error.issues.map(issue => [issue.path, issue.message]));
	}
}

describe('FlowGraphCompiler', () => {
	it('puts branching steps in run order with their exits and ancestors', () => {
		const graph = compiler.compile(leadIntakeFlow());

		expect(graph.steps.map(step => step.name)).toEqual(['classify', 'block', 'crm', 'reply', 'page', 'alert']);
		expect(graph.byName.get('classify')!.exits).toEqual(['spam', 'lead']);
		expect([...graph.byName.get('alert')!.ancestors].sort()).toEqual(['classify', 'crm', 'page', 'reply']);
	});

	it('requires an exit on edges leaving a step that has exits', () => {
		const flow = leadIntakeFlow();
		flow.edges[1] = ['classify', 'block'];
		expect(issues(flow)['edges[1]']).toMatch(/pick one/);

		flow.edges[1] = ['classify.maybe', 'block'];
		expect(issues(flow)['edges[1]']).toMatch(/no exit "maybe"/);
	});

	it('rejects references to steps that do not run first, missing outputs and unknown inputs', () => {
		const flow = leadIntakeFlow();
		flow.steps.block.config = { label: '{{crm.saved}}' };
		flow.steps.crm.config = { label: '{{classify.nope}} {{input.phone}}' };

		const found = issues(flow);
		expect(found['steps.block.config.label']).toMatch(/crm does not run before this step/);
		expect(found['steps.crm.config.label']).toMatch(/no output "nope"|no input "phone"/);
	});

	it('finds loops, unconnected steps, unknown block types and bad settings', () => {
		const flow = leadIntakeFlow();
		flow.edges.push(['alert', 'classify']);
		expect(issues(flow).edges).toMatch(/loop/);

		const loose = leadIntakeFlow();
		loose.edges = loose.edges.filter(([, to]) => to !== 'alert');
		expect(issues(loose)['steps.alert']).toMatch(/Nothing leads to this step/);

		const unknown = leadIntakeFlow();
		unknown.steps.crm = { type: 'crm.hubspot' };
		expect(issues(unknown)['steps.crm.type']).toMatch(/not registered/);

		const settings = leadIntakeFlow();
		settings.steps.crm.config = { label: 42, colour: 'blue' };
		expect(issues(settings)).toMatchObject({
			'steps.crm.config.label': 'Expected string.',
			'steps.crm.config.colour': expect.stringMatching(/no setting "colour"/),
		});
	});

	it('gives control.switch one exit per case plus other', () => {
		const flow = leadIntakeFlow();
		flow.steps.route = { type: 'control.switch', config: { value: '{{classify.kind}}', cases: ['spam', 'lead'] } };
		flow.edges.push(['classify.lead', 'route'], ['route.other', 'block']);

		expect(compiler.compile(flow).byName.get('route')!.exits).toEqual(['spam', 'lead', 'other']);
	});

	it('rejects unknown trigger types', () => {
		const flow = leadIntakeFlow();
		flow.triggers = { nightly: { type: 'test.record' } };
		expect(issues(flow)['triggers.nightly.type']).toMatch(/not a trigger type/);
	});
});
