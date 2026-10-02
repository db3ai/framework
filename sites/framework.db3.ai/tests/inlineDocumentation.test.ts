import assert from 'node:assert/strict';
import test from 'node:test';
import { inlineDocumentation } from '../src/inlineDocumentation';

test('inline code keeps prose, function calls and punctuation separate', () => {
	assert.deepEqual(inlineDocumentation('Call `save()`, then `record.toJSON()`. No query yet.'), [
		{ code: false, text: 'Call ' }, { code: true, text: 'save()' },
		{ code: false, text: ', then ' }, { code: true, text: 'record.toJSON()' },
		{ code: false, text: '. No query yet.' },
	]);
});

test('plain text and incomplete markup remain literal without interpreting HTML', () => {
	assert.deepEqual(inlineDocumentation('No markup'), [{ code: false, text: 'No markup' }]);
	assert.deepEqual(inlineDocumentation('Unclosed `save()'), [{ code: false, text: 'Unclosed `save()' }]);
	assert.deepEqual(inlineDocumentation('`<script>alert(1)</script>`'), [{ code: true, text: '<script>alert(1)</script>' }]);
	assert.deepEqual(inlineDocumentation(''), []);
});
