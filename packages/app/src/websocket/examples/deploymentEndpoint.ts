import { defineChannel, defineWebSocket } from '@db3.ai/app/websocket';

/**
 * Adds an environment-scoped deployment audience to the application's shared endpoint.
 * @param canReadEnvironment - Host policy checking current organization and environment access.
 * @returns An authenticated endpoint; merge its channels if /ws is already registered.
 */
export function deploymentEndpoint(canReadEnvironment: (userId: string, environmentId: string) => boolean | Promise<boolean>) {
	return defineWebSocket({ channels: [defineChannel('environment:{environmentId}:deployments', {
		/** Rechecks membership on subscription and before every event; read access never grants deploy permission. */
		authorize: ({ userId, params }) => canReadEnvironment(userId, params.environmentId!),
	})] });
}
