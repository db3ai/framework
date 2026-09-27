import type { FastifyRequest } from 'fastify';

/** Development HTTP payload capture policy, owned by the host application. */
export interface HttpExchangeMonitorOptions {
	/** Defaults to NODE_ENV; production and test never capture payloads. */
	environment?: string;
	/** Explicitly disables body capture independently of console presentation. */
	enabled?: boolean;
	/** Maximum bytes retained per body; defaults to 16 KiB, capped at 64 KiB. */
	maxBodyBytes?: number;
	/** Excludes sensitive routes from payload capture. Request summaries remain governed by route logging. */
	exclude?: (request: FastifyRequest) => boolean;
}
