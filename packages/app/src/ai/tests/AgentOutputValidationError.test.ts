import { describe, expect, it } from 'vitest';
import { AgentOutputValidationError } from '../AgentOutputValidationError';

describe('AgentOutputValidationError', () => {
	it.each(['a', 'article_not_saved', 'document_123', 'a'.repeat(64)])('retains the fixed code %s without changing ordinary error behavior', code => {
		const error = new AgentOutputValidationError(code, 'Required output was not saved.');
		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ code, name: 'AgentOutputValidationError', message: 'Required output was not saved.' });
	});

	it.each(['', '1_code', '_code', 'UPPER', 'code-name', 'code\n', 'é', 'a'.repeat(65), 'a'.repeat(100_000)])('rejects invalid identifier case %# without retaining its payload', code => {
		expect(() => new AgentOutputValidationError(code, 'Unused.')).toThrow('Agent output validation requires a fixed symbolic code.');
	});
});
