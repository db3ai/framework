import { createSSRApp, type App as VueApplication } from 'vue';
import App from './App.vue';

/**
 * Creates an isolated hydratable documentation application for one URL.
 *
 * The URL is passed as a prop rather than read from browser globals so the same
 * component tree can render deterministically on the server and in the client.
 *
 * @param initialLocation - Root-relative request URL rendered by this app.
 * @returns Vue SSR application ready for rendering or hydration.
 */
export function createDocsApp(initialLocation: string): VueApplication {
	return createSSRApp(App, { initialLocation });
}
