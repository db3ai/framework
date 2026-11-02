import type { FlowValue, FlowValues } from '../contracts';

/** Trigger types this service hosts. */
export const FLOW_TRIGGER = {
	webhook: 'trigger.webhook',
	form: 'trigger.form',
	schedule: 'trigger.schedule',
} as const;

const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks a trigger's settings when a flow file is checked.
 *
 * @param type - Trigger type.
 * @param config - Trigger settings.
 * @returns Problems, as messages.
 */
export function triggerProblems(type: string, config: FlowValues | undefined): string[] {
	const problems: string[] = [];
	const isSecret = (value: FlowValue | undefined) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.secret === 'string');
	if (type === FLOW_TRIGGER.webhook && !isSecret(config?.token)) problems.push('A webhook needs a token setting, as in "token": { "secret": "LEAD_WEBHOOK_TOKEN" }.');
	if (type === FLOW_TRIGGER.form && config?.turnstileSiteKey !== undefined && !isSecret(config?.turnstileSecret)) problems.push('Turnstile needs "turnstileSecret": { "secret": "TURNSTILE_SECRET" } as well as the site key.');
	if (type === FLOW_TRIGGER.schedule) {
		const every = config?.every ?? 'day';
		if (!['minute', 'hour', 'day'].includes(String(every))) problems.push('every is minute, hour or day.');
		if (config?.at !== undefined && (every !== 'day' || typeof config.at !== 'string' || !SCHEDULE_TIME.test(config.at))) problems.push('at is a time of day such as "07:00", for schedules that run every day.');
		if (config?.input !== undefined && (!config.input || typeof config.input !== 'object' || Array.isArray(config.input))) problems.push('input is an object of flow input values.');
	}
	return problems;
}
