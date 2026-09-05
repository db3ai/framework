import { describe, expect, it } from 'vitest';
import { imageVariantOptionsFromSearchParams, ImageVariantRequestError } from '..';

describe('imageVariantOptionsFromSearchParams', () => {
	it('translates an allowlisted width into image variant options', () => {
		const searchParams = new URLSearchParams({
			sharp: 'arbitrary-command',
			w: '640',
		});

		expect(imageVariantOptionsFromSearchParams(searchParams)).toEqual({
			width: 640,
		});
	});

	it('returns null when the original image is requested', () => {
		expect(imageVariantOptionsFromSearchParams(new URLSearchParams())).toBeNull();
	});

	it('leaves output format selection to the HTTP route', () => {
		expect(imageVariantOptionsFromSearchParams(new URLSearchParams({
			format: 'webp',
		}))).toBeNull();
		expect(imageVariantOptionsFromSearchParams(new URLSearchParams({
			f: 'webp',
		}))).toBeNull();
	});

	it.each([
		'',
		'0',
		'-1',
		'300.5',
		'4097',
		'not-a-number',
	])('rejects the invalid width %s', width => {
		expect(() => imageVariantOptionsFromSearchParams(new URLSearchParams({
			w: width,
		}))).toThrow(ImageVariantRequestError);
	});
});
