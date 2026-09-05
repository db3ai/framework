import { expect, it } from 'vitest';
import { Config, createEnv } from '@db3.ai/app/config';
import { loadNotesConfig } from '../../examples/loadNotesConfig';
import { runConfig } from '../../examples/runConfig';

it('boots explicit configuration without SQL or network access and returns only selected values', async () => {
	expect(await runConfig({})).toEqual({ name: 'My notes', port: 3000, notesUrl: 'http://localhost:3000/notes', pageSize: 20, debug: false, allowedOrigins: [], missingValue: 'fallback', hasWebhook: true, webhookEnabled: false, configReused: true });
	const result = await runConfig({ APP_NAME: 'Agency notes', APP_PORT: '3100', APP_DEBUG: 'yes', NOTES_PAGE_SIZE: '50', ALLOWED_ORIGINS: 'https://one.example, https://two.example,', WEBHOOK_ENABLED: 'on', WEBHOOK_KEY: 'test-only-secret' });
	expect(result).toMatchObject({ name: 'Agency notes', port: 3100, pageSize: 50, debug: true, allowedOrigins: ['https://one.example', 'https://two.example'], webhookEnabled: true });
	expect(JSON.stringify(result)).not.toContain('test-only-secret');
});

it('fails before boot for invalid types, ranges or enabled integrations without credentials', async () => {
	for (const source of [{ APP_PORT: 'abc' }, { APP_PORT: '1.5' }, { APP_PORT: '0' }, { NOTES_PAGE_SIZE: '101' }, { APP_DEBUG: 'maybe' }, { WEBHOOK_ENABLED: 'true' }, { WEBHOOK_ENABLED: 'true', WEBHOOK_KEY: '   ' }]) {
		expect(() => loadNotesConfig(source)).toThrow();
	}
	expect(loadNotesConfig({ APP_PORT: '', WEBHOOK_ENABLED: 'false' }).port).toBe(3000);
	expect(() => loadNotesConfig({ WEBHOOK_ENABLED: 'true' })).toThrow('WEBHOOK_KEY');
});

it('distinguishes presence from fallback and documents raw strings versus parsed values', () => {
	const config = new Config({ notes: { title: '', value: null, optional: undefined, enabled: false, tags: ['one'] } });
	expect(config.get('notes.title', 'fallback')).toBe('');
	expect(config.get('notes.value', 'fallback')).toBeNull();
	expect(config.get('notes.optional', 'fallback')).toBeUndefined();
	expect(config.has('notes.optional')).toBe(true);
	expect(config.get('notes.enabled', true)).toBe(false);
	expect(config.get('notes.tags.0', 'missing')).toBe('missing');
	expect(() => config.get('notes..title')).toThrow('empty segment');
	const env = createEnv({ EMPTY: '', JSON: '{"enabled":true}', RATIO: '1.5' });
	expect(env('EMPTY', 'fallback')).toBe('');
	expect(env.integer('EMPTY', 20)).toBe(20);
	expect(env.number('RATIO')).toBe(1.5);
	expect(env.json('JSON')).toEqual({ enabled: true });
});
