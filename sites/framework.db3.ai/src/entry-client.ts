import { initTheme } from '@getdom/studio/vue';
import '@vue-flow/core/dist/style.css';
import './dom-studio.css';
import './landing.css';
import './style.css';
import { createDocsApp } from './createDocsApp';
import { browserDocumentationLocation } from './siteRoutes';

/** Hydration state emitted through the framework SSR document pipeline. */
interface DocsHydrationState {
	/** Server-rendered public location used to preserve the initial component tree. */
	location: string;
}

const state = readHydrationState();
const application = createDocsApp(state.location || browserDocumentationLocation(window.location));

application.mount('#app');
initTheme();

/**
 * Reads the request-owned state emitted by the server document renderer.
 *
 * @returns Parsed documentation hydration state with a browser URL fallback.
 */
function readHydrationState(): DocsHydrationState {
	const element = document.getElementById('platform-ssr-state');

	if (!element?.textContent) {
		return { location: browserDocumentationLocation(window.location) };
	}

	try {
		const value = JSON.parse(element.textContent) as Partial<DocsHydrationState>;

		return {
			location: typeof value.location === 'string'
				? value.location
				: browserDocumentationLocation(window.location),
		};
	} catch {
		return { location: browserDocumentationLocation(window.location) };
	}
}
