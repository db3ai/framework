import { pathToFileURL } from 'node:url';
import { createPublicPageServer } from './createPublicPageServer';

/** Extracts this lab's JSON script contents without evaluating executable code. */
export function pageState(html: string): { name: string } {
	const match = html.match(/<script id="page-state" type="application\/json">([\s\S]*?)<\/script>/);
	if (!match) throw new Error('Missing page-state JSON.');
	return JSON.parse(match[1]!);
}

/** Runs real SSR requests, safe state, isolated concurrent renders and error recovery. */
export async function runPublicPages() {
	const server = await createPublicPageServer();
	try {
		const [ada, grace] = await Promise.all([server.inject('/hello?name=Ada'), server.inject('/hello?name=Grace')]);
		const unsafe = '</script><script>alert(1)</script>$&';
		const escaped = await server.inject(`/hello?name=${encodeURIComponent(unsafe)}`);
		const broken = await server.inject('/broken');
		const recovered = await server.inject('/hello');
		const missingApi = await server.inject('/api/missing');
		return { status: ada.statusCode, isolated: pageState(ada.body).name === 'Ada' && pageState(grace.body).name === 'Grace', safeState: pageState(escaped.body).name === unsafe && !escaped.body.includes('</script><script>alert(1)'), literalMarkup: ada.body.includes('Literal $& stays literal.'), failure: broken.statusCode, privateError: broken.body === 'Internal Server Error', recovered: recovered.statusCode, missingApi: missingApi.statusCode };
	} finally { await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runPublicPages(), null, 2));
