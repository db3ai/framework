import { defineBlock, type FlowValue, type FlowValues } from '@db3.ai/app/flows';

import { requireObject, requireString, type ArticleRequestPort, type ArticleStatePort } from './articleState.js';

type RequestInputConfig = FlowValues & {
	form: FlowValue;
};

const MINIMUM_BODY_IMAGES = 2;
const INCLUDED_BODY_IMAGES = 4;
const DEFAULT_BODY_IMAGES = 3;

/** Converts a form or webhook-style JSON request into article pipeline state. */
export default defineBlock<ArticleRequestPort, ArticleStatePort, RequestInputConfig>({
	type: 'input.article-request',
	name: 'Article Request',
	description: 'Accepts one JSON request that can be supplied by a generated form, webhook, API, or manual development run.',
	inputs: {
		request: {
			type: 'json',
			required: true,
		},
	},
	outputs: {
		state: {
			type: 'json',
			required: true,
		},
	},
	config: {
		form: {
			type: 'json',
			required: true,
			description: 'Host-agnostic form definition. Scout can map these component names to DOM form fields.',
			default: {
				component: 'DomForm',
				props: {
					name: 'article-generation-request',
				},
				children: [
					{
						component: 'DomTextInput',
						props: {
							name: 'userId',
							label: 'User ID',
							required: true,
						},
					},
					{
						component: 'DomTextInput',
						props: {
							name: 'contentPlanId',
							label: 'Content plan ID',
							required: true,
						},
					},
					{
						component: 'DomNumberInput',
						props: {
							name: 'imagePolicy.bodyImageCount',
							label: 'Body images',
							min: MINIMUM_BODY_IMAGES,
							value: DEFAULT_BODY_IMAGES,
						},
					},
					{
						component: 'DomNumberInput',
						props: {
							name: 'imagePolicy.paidExtraImageAllowance',
							label: 'Paid extra image allowance',
							min: 0,
							value: 0,
						},
					},
					{
						component: 'DomToggle',
						props: {
							name: 'imagePolicy.requireDiagram',
							label: 'Require a diagram or infographic',
							value: true,
						},
					},
				],
			},
		},
	},
	/**
	 * Validates request identity and initializes observable pipeline state.
	 *
	 * @param input - Form, webhook, or manually supplied request.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Initial article pipeline state.
	 */
	async run(input, context) {
		const request = requireObject(input.request, 'request');

		requireString(request, 'userId');
		requireString(request, 'contentPlanId');

		const imagePolicy = normalizeImagePolicy(request.imagePolicy);
		const normalizedRequest = {
			...request,
			imagePolicy,
		};

		await context.log('info', 'Article request accepted.', normalizedRequest);

		return {
			state: {
				request: normalizedRequest,
			},
		};
	},
});

/**
 * Normalizes and validates the image entitlement supplied with an article request.
 *
 * The title image is always generated separately. Body images include a required
 * diagram or infographic when that option is enabled.
 *
 * @param value - Optional request image-policy object.
 * @returns Validated image counts and diagram requirement.
 */
function normalizeImagePolicy(value: FlowValue | undefined): FlowValues {
	const policy = value === undefined
		? {}
		: requireObject(value, 'request.imagePolicy');
	const bodyImageCount = integerValue(policy.bodyImageCount, DEFAULT_BODY_IMAGES, 'imagePolicy.bodyImageCount');
	const paidExtraImageAllowance = integerValue(policy.paidExtraImageAllowance, 0, 'imagePolicy.paidExtraImageAllowance');
	const requireDiagram = booleanValue(policy.requireDiagram, true, 'imagePolicy.requireDiagram');
	const maximumBodyImages = INCLUDED_BODY_IMAGES + paidExtraImageAllowance;

	if (bodyImageCount < MINIMUM_BODY_IMAGES) {
		throw new Error(`imagePolicy.bodyImageCount must be at least ${MINIMUM_BODY_IMAGES}.`);
	}

	if (paidExtraImageAllowance < 0) {
		throw new Error('imagePolicy.paidExtraImageAllowance cannot be negative.');
	}

	if (bodyImageCount > maximumBodyImages) {
		throw new Error(`imagePolicy.bodyImageCount exceeds the included and paid allowance of ${maximumBodyImages}.`);
	}

	return {
		bodyImageCount,
		paidExtraImageAllowance,
		requireDiagram,
	};
}

/**
 * Reads an integer policy value with a default.
 *
 * @param value - Unknown JSON value.
 * @param fallback - Value used when the field is absent.
 * @param label - Field label included in validation failures.
 * @returns Parsed integer value.
 */
function integerValue(value: FlowValue | undefined, fallback: number, label: string): number {
	if (value === undefined) return fallback;

	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new Error(`${label} must be an integer.`);
	}

	return value;
}

/**
 * Reads a boolean policy value with a default.
 *
 * @param value - Unknown JSON value.
 * @param fallback - Value used when the field is absent.
 * @param label - Field label included in validation failures.
 * @returns Parsed boolean value.
 */
function booleanValue(value: FlowValue | undefined, fallback: boolean, label: string): boolean {
	if (value === undefined) return fallback;

	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean.`);
	}

	return value;
}
