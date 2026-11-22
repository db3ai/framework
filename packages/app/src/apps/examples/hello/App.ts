import { SubApp, AppRouteError, type AppRoute, type SubAppStartContext } from '@db3.ai/app/apps';

/** A small authenticated feature whose readiness belongs to the host lifecycle. */
export default class App extends SubApp {
	static override routes: readonly AppRoute<App>[] = [{
		method: 'GET',
		path: '/',
		/** Uses the identity established by the host's route adapter. */
		handle: ({ service, actor }) => service.greet(actor.id),
	}];

	#ready = false;

	/** Marks this process ready and registers cleanup, including startup rollback. */
	override async start({ defer }: SubAppStartContext<this>): Promise<void> {
		this.#ready = true;
		defer(() => { this.#ready = false; });
	}

	/** Returns a greeting only while enabled, using an already authenticated identity. */
	greet(actorId: string): { message: string } {
		if (!this.#ready) throw new AppRouteError(503, 'Hello is not running.');
		if (!actorId) throw new AppRouteError(401, 'Please sign in.');
		return { message: `Hello, ${actorId}!` };
	}
}
