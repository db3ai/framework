import { describe, expect, it } from 'vitest';

import { App } from '../../server';
import { Config, createEnv, defineConfig } from '../index';

describe('Config', () => {
	it('reads config values by dot path', () => {
		const filesystems = defineConfig({
			default: 'agent',
			disks: {
				agent: {
					driver: 'local',
					root: 'storage/agent',
				},
			},
		});
		const config = new Config({
			filesystems,
		});

		expect(config.get('filesystems.default')).toBe('agent');
		expect(config.get('filesystems.disks.agent.root')).toBe('storage/agent');
		expect(config.get('filesystems.disks.public.root', 'storage/public')).toBe('storage/public');
		expect(config.has('filesystems.disks.agent.driver')).toBe(true);
		expect(config.has('filesystems.disks.public.driver')).toBe(false);
		expect(config.all()).toEqual({
			filesystems,
		});
	});

	it('rejects invalid dot paths', () => {
		const config = new Config({});

		expect(() => config.get('')).toThrow('Config path cannot be empty.');
		expect(() => config.get('filesystems..default')).toThrow('contains an empty segment');
	});

	it('is available through the app service hub', () => {
		const app = new App({
			config: {
				filesystems: {
					default: 'agent',
				},
			},
		});

		expect(app.config.get('filesystems.default')).toBe('agent');
		expect(app.config).toBe(app.config);
	});
});

describe('env', () => {
	it('reads strings and required values', () => {
		const env = createEnv({
			APP_NAME: 'Notes',
			EMPTY_VALUE: '',
		});

		expect(env('APP_NAME')).toBe('Notes');
		expect(env('MISSING_NAME', 'Platform')).toBe('Platform');
		expect(env.string('APP_NAME')).toBe('Notes');
		expect(env.string('MISSING_NAME', 'Platform')).toBe('Platform');
		expect(env.required('APP_NAME')).toBe('Notes');
		expect(() => env.required('MISSING_NAME')).toThrow('Environment variable "MISSING_NAME" is required.');
		expect(() => env.required('EMPTY_VALUE')).toThrow('Environment variable "EMPTY_VALUE" is required.');
	});

	it('parses booleans, numbers, integers, arrays, and json', () => {
		const env = createEnv({
			APP_DEBUG: 'yes',
			PORT: '8787',
			RATIO: '1.5',
			CORS_ORIGIN: 'https://one.test, https://two.test,',
			FEATURE_FLAGS: '{"agent":true}',
		});

		expect(env.boolean('APP_DEBUG', false)).toBe(true);
		expect(env.boolean('MISSING_BOOL', false)).toBe(false);
		expect(env.integer('PORT')).toBe(8787);
		expect(env.number('RATIO')).toBe(1.5);
		expect(env.array('CORS_ORIGIN')).toEqual([
			'https://one.test',
			'https://two.test',
		]);
		expect(env.json<{ agent: boolean }>('FEATURE_FLAGS')).toEqual({
			agent: true,
		});
	});

	it('reports invalid typed env values', () => {
		const env = createEnv({
			BOOLEAN_VALUE: 'maybe',
			NUMBER_VALUE: 'abc',
			INTEGER_VALUE: '1.5',
			JSON_VALUE: '{nope',
		});

		expect(() => env.boolean('BOOLEAN_VALUE')).toThrow('must be a boolean');
		expect(() => env.number('NUMBER_VALUE')).toThrow('must be a number');
		expect(() => env.integer('INTEGER_VALUE')).toThrow('must be an integer');
		expect(() => env.json('JSON_VALUE')).toThrow('must contain valid JSON');
	});
});
