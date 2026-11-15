import { describe, expect, it } from 'vitest';
import { describeUserAgent } from '../describeUserAgent';

describe('describeUserAgent', () => {
	it('names the browser, system and device people recognise', () => {
		expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', operatingSystem: 'iOS', device: 'iPhone' });
		expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toEqual({ browser: 'Chrome', operatingSystem: 'macOS', device: 'Computer' });
		expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toEqual({ browser: 'Edge', operatingSystem: 'Windows', device: 'Computer' });
		expect(describeUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome', operatingSystem: 'Android', device: 'Phone' });
	});

	it('leaves what it cannot tell as null', () => {
		expect(describeUserAgent('curl/8.7.1')).toEqual({ browser: null, operatingSystem: null, device: null });
		expect(describeUserAgent(undefined)).toEqual({ browser: null, operatingSystem: null, device: null });
	});
});
