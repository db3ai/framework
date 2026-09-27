import { app } from '@db3.ai/app/server';

/** Generates a PNG and records the application's storage reference on its AI request. */
export async function createHelpImage(prompt: string, path: string) {
	return app().ai.generateImage({ prompt, outputFormat: 'png' }, {
		/** Saves bytes through the configured framework disk without exposing provider URLs. */
		store: async ({ b64Json }) => {
			const disk = app().storage.disk();
			await disk.put(path, Buffer.from(b64Json, 'base64'), { mimeType: 'image/png' });
			return { disk: disk.name, path };
		},
	});
}
