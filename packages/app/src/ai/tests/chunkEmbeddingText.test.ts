import { describe, expect, it } from 'vitest';
import { chunkEmbeddingText } from '@db3.ai/app/ai';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';

const tokenizer = new Tiktoken(cl100kBase);

describe('contextual embedding text chunks', () => {
	it('keeps a fitting page intact with its shared context', () => {
		const text = '# Fence panels\n\nUntreated softwood needs regular care.';
		const chunks = chunkEmbeddingText(text, { context: 'title: Fence panels' });
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ text, start: 0, end: text.length, index: 0 });
		expect(chunks[0].input).toBe(`title: Fence panels\ncontent:\n${text}`);
	});

	it('retains headings, preceding overlap and every source character when splitting', () => {
		const text = '# Fence panels\n\n## Untreated softwood\n\n' + 'These panels need treating annually.\n\n'.repeat(100) + '## Delivery\n\n' + 'Delivery is available nationwide.\n\n'.repeat(100);
		const chunks = chunkEmbeddingText(text, { context: 'title: Fence panels', maxTokens: 256, overlapTokens: 20 });
		expect(chunks.length).toBeGreaterThan(2);
		let covered = 0;
		for (const [index, chunk] of chunks.entries()) {
			expect(chunk.index).toBe(index);
			expect(chunk.start).toBeLessThanOrEqual(covered);
			expect(chunk.end).toBeGreaterThan(covered);
			expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
			expect(chunk.input).toContain('title: Fence panels');
			expect(tokenizer.encode(chunk.input, [], []).length).toBeLessThanOrEqual(256);
			covered = chunk.end;
		}
		expect(covered).toBe(text.length);
		expect(chunks[1].start).toBeLessThan(chunks[0].end);
		expect(chunks.some(chunk => chunk.heading === 'Fence panels > Untreated softwood')).toBe(true);
		expect(chunks.some(chunk => chunk.heading === 'Fence panels > Delivery')).toBe(true);
	});

	it.each([['Unicode', '🪵日本語の木材。'.repeat(500)], ['dense ASCII', 'aZ09/+=_'.repeat(1000)], ['literal special tokens', '<|endoftext|>'.repeat(1000)]])('bounds oversized %s without corrupting or dropping text', (_label, text) => {
		const chunks = chunkEmbeddingText(text, { maxTokens: 128, overlapTokens: 0 });
		expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
		for (const chunk of chunks) {
			expect(chunk.text).not.toMatch(/[\uD800-\uDBFF]$/);
			expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]/);
			expect(tokenizer.encode(chunk.input, [], []).length).toBeLessThanOrEqual(128);
		}
	});

	it('uses the new section heading when overlap comes from the previous section', () => {
		const text = '# Guide\n\n## Maintenance\n\n' + 'Wood needs regular annual care.\n\n'.repeat(12) + '## Delivery\n\n' + 'Delivery is available nationwide.\n\n'.repeat(20);
		const chunks = chunkEmbeddingText(text, { maxTokens: 128, overlapTokens: 20 });
		const deliveryStart = text.indexOf('## Delivery');
		expect(chunks[0].end).toBe(deliveryStart);
		expect(chunks[1].start).toBeLessThan(deliveryStart);
		expect(chunks[1].heading).toBe('Guide > Delivery');
	});

	it('bounds exceptionally long metadata and ignores apparent headings inside code fences', () => {
		const text = '# Actual heading\n\n```text\n# Not a section\n' + 'code content '.repeat(400) + '\n```\n\nAfter code.';
		const chunks = chunkEmbeddingText(text, { context: 'A long title '.repeat(1000), maxTokens: 128 });
		expect(chunks.every(chunk => chunk.tokens <= 128)).toBe(true);
		expect(chunks.some(chunk => chunk.heading?.includes('Not a section'))).toBe(false);
	});

	it('rejects invalid budgets and omits blank text', () => {
		expect(chunkEmbeddingText('  \n')).toEqual([]);
		expect(() => chunkEmbeddingText('text', { maxTokens: 8192 })).toThrow('maxTokens');
		expect(() => chunkEmbeddingText('text', { overlapTokens: 4000 })).toThrow('overlap');
	});
});
