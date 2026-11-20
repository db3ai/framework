import { APP_ROUTE_RISKS } from './contracts';

type Json = Record<string, any>;

/** The fields of a JSON schema's object, as `name (type)`, one level deep; optional ones end in `?`. */
function fields(schema: Json | undefined) {
	if (!schema?.properties) return '';
	const required = new Set<string>(schema.required ?? []);
	return Object.entries(schema.properties as Json).map(([name, value]) => `\`${name}\`${required.has(name) ? '' : '?'}${value.type ? ` (${value.type})` : ''}`).join(', ');
}

/** Text safe inside a Markdown table cell. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * A readable Markdown reference made from an `appOpenApi` document: a table of risks, then one table
 * per section with each route's method and path, risk, AI tool and summary, and its body's fields.
 * People and AI agents read the same page; `intro` is Markdown placed under the title.
 */
export function appReference(spec: Json, options: { intro?: string; mount?: string } = {}): string {
	const lines = [`# ${spec.info.title}`, '', ...(options.intro ? [options.intro, ''] : []), '| Risk | Meaning |', '| --- | --- |', ...Object.entries(APP_ROUTE_RISKS).map(([risk, text]) => `| \`${risk}\` | ${text} |`)];
	const sections = new Map<string, string[]>((spec.tags ?? []).map((tag: Json) => [tag.name, []]));
	for (const [path, operations] of Object.entries(spec.paths as Json)) {
		for (const [method, operation] of Object.entries(operations as Json)) {
			const body = fields(operation.requestBody?.content?.['application/json']?.schema);
			const text = [operation.summary, operation.description, body && `Body: ${body}.`].filter(Boolean).join(' ');
			const shown = options.mount && path.startsWith(options.mount) ? path.slice(options.mount.length) || '/' : path;
			const tag = operation.tags?.[0] ?? 'Other';
			if (!sections.has(tag)) sections.set(tag, []);
			sections.get(tag)!.push(`| \`${method.toUpperCase()} ${shown}\` | ${operation['x-db3-risk'] ? `\`${operation['x-db3-risk']}\`` : ''} | ${operation['x-db3-tool'] ? `\`${operation['x-db3-tool']}\`` : ''} | ${cell(text)} |`);
		}
	}
	for (const [name, rows] of sections) if (rows.length) lines.push('', `## ${name}`, '', '| Route | Risk | Tool | What it does |', '| --- | --- | --- | --- |', ...rows);
	return `${lines.join('\n')}\n`;
}
