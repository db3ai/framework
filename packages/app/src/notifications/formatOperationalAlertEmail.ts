import type { OperationalAlertRecord } from './OperationalAlertRecord';

/**
 * Renders the persisted, application-allowlisted incident as readable mail.
 * Webhooks keep their original JSON contract. All HTML values are escaped;
 * this renderer does not make arbitrary diagnostic data safe to disclose.
 */
export function formatOperationalAlertEmail(record: OperationalAlertRecord): { text: string; html: string } {
	const rows = [
		['Detected at (UTC)', record.createdAt.toISOString()],
		...Object.entries(record.alert.context).map(([key, value]) => [label(key), value === null ? 'Unknown' : String(value)]),
		['Incident ID', record.id],
		['Log correlation key', record.key],
		...(record.alert.emailDiagnostics ? [['Failure log, exception and stack trace', record.alert.emailDiagnostics]] : []),
	];
	const footer = 'This is a snapshot at detection time, not a live status report. Full diagnostics are in application logs under the correlation key above.';
	return {
		text: [record.alert.summary, '', ...rows.map(([key, value]) => `${key}: ${value}`), '', footer].join('\n'),
		html: `<html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h2>${escapeHtml(record.alert.summary)}</h2><table style="border-collapse:collapse">${rows.map(([key, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(key)}</th><td style="padding:8px;border-bottom:1px solid #e5e7eb;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('')}</table><p style="color:#596579">${footer}</p></body></html>`,
	};
}

/** Gives camel-case context fields human-readable labels without changing their values. */
function label(key: string): string {
	const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Escapes every HTML-significant character in application-provided text. */
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
