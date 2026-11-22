import type { FastifyRequest } from 'fastify';

/** Development HTTP payload capture policy, owned by the host application. */
export interface HttpExchangeMonitorOptions {
	/** Defaults to NODE_ENV; development captures whole exchanges, test never captures. */
	environment?: string;
	/**
	 * Outside development, logs each request's masked body as a `request body` record (method, URL
	 * and body only; never headers or responses), so a host such as db3 Cloud can show it beside the
	 * request. Off by default; an app turns it on in its own server setup.
	 */
	requestBodies?: boolean;
	/** Explicitly disables body capture independently of console presentation. */
	enabled?: boolean;
	/** Maximum bytes retained per body; defaults to 16 KiB, capped at 64 KiB. */
	maxBodyBytes?: number;
	/** Excludes sensitive routes from payload capture. Request summaries remain governed by route logging. */
	exclude?: (request: FastifyRequest) => boolean;
}
