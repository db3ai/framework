import { pathToFileURL } from 'node:url';
import { App } from '@db3.ai/app/server';
import { UrlGenerator } from '@db3.ai/app/url';

/**
 * Builds a link from an app-owned path, rejecting another origin.
 *
 * This is an example redirect policy, not a method supplied by UrlGenerator.
 * @param url - Trusted application URL generator.
 * @param path - Root-relative path to resolve.
 * @returns Same-origin absolute URL.
 */
export function applicationLink(url: UrlGenerator, path: string): string {
	if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Use a root-relative application path.');
	const resolved = url.to(path);
	if (new URL(resolved).origin !== new URL(url.baseUrl).origin) throw new Error('Link must remain on the application origin.');
	return resolved;
}

/** Exercises canonical links, subpath resolution, invalid configuration and repair. */
export async function runApplicationLinks() {
	const application = new App({ url: { baseUrl: 'https://notes.example.test/workspace/' } });
	try {
		const url = application.url;
		let invalidBaseRejected = false;
		try { new UrlGenerator({ baseUrl: 'file:///private/notes' }); } catch { invalidBaseRejected = true; }
		let externalRejected = false;
		try { applicationLink(url, '//outside.example.test/'); } catch { externalRejected = true; }
		return { base: url.baseUrl, relative: url.to('notes/one'), root: applicationLink(url, '/notes/one'), externalRejected, invalidBaseRejected, repaired: new UrlGenerator({ baseUrl: 'https://notes.example.test' }).to('/sign-in') };
	} finally { await application.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runApplicationLinks(), null, 2));
