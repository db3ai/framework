import {
	BasicFieldState,
	FieldContext,
	FieldError,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import {
	TextField,
	type TextFieldConfig,
} from './TextField';

/**
 * Configuration for URL fields.
 */
export interface UrlFieldConfig extends TextFieldConfig {
	/** Allowed URL protocols. Defaults to HTTP and HTTPS. */
	allowedProtocols?: string[];

	/** Whether the hostname must contain a dot. Defaults to true. */
	requirePublicHostname?: boolean;

	/** Protocol to prepend when users omit one. Defaults to `https://`. */
	defaultProtocol?: 'http://' | 'https://';
}

/**
 * URL field with request-friendly normalization.
 *
 * It accepts values with or without a protocol, trims whitespace, normalises via
 * the platform URL parser, and returns `null` for values that cannot be saved as
 * public URLs.
 */
export class UrlField extends TextField {
	declare public readonly config: UrlFieldConfig;

	constructor(config: UrlFieldConfig = {}) {
		super({
			maxLength: 2000,
			...config,
		});
	}

	protected override parse(input: unknown): string | null {
		const value = super.parse(input);

		if (!value) return null;

		return this.normalizeUrl(value);
	}

	protected override defaultFormComponent(): string {
		return 'DomUrlInput';
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'url',
		];
	}

	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (value && !this.normalizeUrl(value)) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be a valid URL`,
				code: 'url',
				value,
			});
		}

		return errors;
	}

	private normalizeUrl(value: string): string | null {
		const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
			? value
			: `${this.config.defaultProtocol ?? 'https://'}${value}`;

		try {
			const url = new URL(candidate);
			const allowedProtocols = this.config.allowedProtocols ?? ['http:', 'https:'];

			if (!allowedProtocols.includes(url.protocol)) return null;
			if ((this.config.requirePublicHostname ?? true) && !url.hostname.includes('.')) return null;

			return url.toString();
		} catch {
			return null;
		}
	}
}
