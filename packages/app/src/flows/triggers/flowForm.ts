import type { FlowGraphDefinition, FlowValueDefinition } from '../contracts';

/** What a form trigger's settings say about the page. */
export interface FlowFormSettings {
	title?: string;
	intro?: string;
	submit?: string;
	thanks?: string;
	/** Inputs to show, in order; defaults to every input. */
	fields?: string[];
	turnstileSiteKey?: string;
}

const STYLE = `
:root { color-scheme: light dark; --fg: #0f172a; --muted: #64748b; --line: #d8dee9; --bg: #ffffff; --field: #f8fafc; --accent: #4338ca; --bad: #b91c1c }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e9f2; --muted: #a7b0c4; --line: #2c3650; --bg: #121a2b; --field: #1a2337; --accent: #8b93ff; --bad: #f58a8a } }
* { box-sizing: border-box }
body { margin: 0; padding: 20px 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
main { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px }
h1 { margin: 0; font-size: 20px }
p { margin: 0; color: var(--muted) }
form { display: flex; flex-direction: column; gap: 12px }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; font-weight: 600 }
label.check { flex-direction: row; align-items: center; gap: 8px; font-weight: 500 }
input, textarea { font: inherit; font-weight: 400; color: var(--fg); background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; width: 100% }
label.check input { width: auto }
input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
button { align-self: flex-start; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 9px 18px; cursor: pointer }
.error { color: var(--bad); font-weight: 600 }
.hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden }
`;

/**
 * Renders a hosted form for a flow: one field per input, labelled from the input's
 * editor hints, posting back to the same address.
 *
 * @param flow - Flow file.
 * @param settings - Form trigger settings.
 * @param action - Address the form posts to.
 * @param state - Message and values when the form is shown again.
 * @returns Complete HTML page.
 */
export function renderFlowForm(flow: FlowGraphDefinition, settings: FlowFormSettings, action: string, state: { message?: string; values?: Record<string, string> } = {}): string {
	const names = (settings.fields ?? Object.keys(flow.inputs)).filter(name => flow.inputs[name]);
	const fields = names.map(name => field(name, flow.inputs[name], state.values?.[name] ?? '')).join('\n');
	const turnstile = settings.turnstileSiteKey
		? `<div class="cf-turnstile" data-sitekey="${escape(settings.turnstileSiteKey)}"></div>`
		: '';
	return page(settings.title ?? flow.title ?? flow.name, `
		<h1>${escape(settings.title ?? flow.title ?? flow.name)}</h1>
		${settings.intro ? `<p>${escape(settings.intro)}</p>` : ''}
		${state.message ? `<p class="error" role="alert">${escape(state.message)}</p>` : ''}
		<form method="post" action="${escape(action)}">
			${fields}
			<div class="hp" aria-hidden="true"><label>Website<input name="_website" tabindex="-1" autocomplete="off"></label></div>
			${turnstile}
			<button type="submit">${escape(settings.submit ?? 'Send')}</button>
		</form>`, Boolean(settings.turnstileSiteKey));
}

/**
 * Renders the page shown after a form is sent.
 *
 * @param settings - Form trigger settings.
 * @returns Complete HTML page.
 */
export function renderFlowFormDone(settings: FlowFormSettings): string {
	return page(settings.title ?? 'Thank you', `<h1>${escape(settings.thanks ?? 'Thank you. We have your message.')}</h1>`, false);
}

function field(name: string, definition: FlowValueDefinition, value: string): string {
	const label = escape(definition.editor?.label ?? humanize(name));
	const required = definition.required ? ' required' : '';
	const placeholder = definition.editor?.placeholder ? ` placeholder="${escape(definition.editor.placeholder)}"` : '';
	const id = `f-${escape(name)}`;
	if (definition.type === 'boolean') return `<label class="check" for="${id}"><input id="${id}" type="checkbox" name="${escape(name)}"${value === 'on' ? ' checked' : ''}> ${label}</label>`;
	const long = (definition.editor?.rows ?? 1) > 1 || /message|comment|description|notes?|body|details/i.test(name);
	if (long) return `<label for="${id}">${label}<textarea id="${id}" name="${escape(name)}" rows="${definition.editor?.rows ?? 5}"${required}${placeholder}>${escape(value)}</textarea></label>`;
	const type = definition.type === 'number' ? 'number' : /e-?mail/i.test(name) ? 'email' : /phone|tel/i.test(name) ? 'tel' : 'text';
	const autocomplete = /e-?mail/i.test(name) ? 'email' : /^name$|full.?name/i.test(name) ? 'name' : /phone|tel/i.test(name) ? 'tel' : 'on';
	return `<label for="${id}">${label}<input id="${id}" type="${type}" name="${escape(name)}" value="${escape(value)}" autocomplete="${autocomplete}"${required}${placeholder}></label>`;
}

function page(title: string, body: string, turnstile: boolean): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style>${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}</head><body><main>${body}</main></body></html>`;
}

function humanize(name: string): string {
	const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
