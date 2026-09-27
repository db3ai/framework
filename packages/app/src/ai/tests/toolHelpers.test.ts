import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { agentToolContext, emitAgentToolProgress, agentToolOutputWithModelAttachments, agentToolResultFromStructuredOutput, agentToolErrorResult, type AgentToolProgressInput } from '@db3.ai/app/ai';

describe('shared agent tool helpers', () => {
	it('preserves application context and emits progress through its own sink', async () => {
		const updates: AgentToolProgressInput[] = [];
		const context = {
			projectId: 'project-1',
			/** Collects progress emitted by the real framework helper. */
			emitToolProgress(update: AgentToolProgressInput) { updates.push(update); },
		};
		const runContext = new RunContext(context);
		expect(agentToolContext(runContext)).toBe(context);
		expect(agentToolContext(runContext)?.projectId).toBe('project-1');
		expect(agentToolContext(undefined)).toBeNull();
		await emitAgentToolProgress({ runContext, details: { toolCall: { callId: 'call-1' } }, toolName: 'index_project', message: 'Indexed', current: 1, total: 2 });
		expect(updates).toEqual([{ toolCallId: 'call-1', toolName: 'index_project', message: 'Indexed', current: 1, total: 2, data: undefined }]);
		await expect(emitAgentToolProgress({ runContext: undefined, details: undefined, toolName: 'index_project', message: 'Skipped' })).resolves.toBeUndefined();
	});

	it('separates persisted JSON results from model-visible attachments', () => {
		const result = { status: 'success' as const, fileId: 'file-1' };
		const output = agentToolOutputWithModelAttachments(result, [{ type: 'image', image: { data: 'aW1hZ2U=', mediaType: 'image/png' } }]);
		expect(output).toHaveLength(2);
		expect(agentToolResultFromStructuredOutput(output)).toEqual(result);
		expect(agentToolResultFromStructuredOutput([{ type: 'text', text: 'not json' }])).toBeNull();
		expect(agentToolResultFromStructuredOutput(null)).toBeNull();
	});

	it('normalizes tool failures without inventing an error message', () => {
		expect(agentToolErrorResult(new Error('Missing project'), 'Failed')).toEqual({ status: 'error', message: 'Missing project' });
		expect(agentToolErrorResult(null, 'Failed')).toEqual({ status: 'error', message: 'Failed' });
	});
});
