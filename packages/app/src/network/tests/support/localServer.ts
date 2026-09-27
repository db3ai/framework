import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Running loopback test server and the requests it received. */
export interface LocalServer {
	/** Loopback port the server listens on. */
	port: number;

	/** Paths requested so far, in order. */
	requests: string[];

	/** Stops the server and removes temporary TLS material. */
	close: () => Promise<void>;
}

/** Request handler used by a local test server. */
export type LocalServerHandler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * Starts an HTTP server on 127.0.0.1 that records requested paths.
 *
 * @param handler - Response handler.
 * @returns Running server.
 */
export async function startHttpServer(handler: LocalServerHandler): Promise<LocalServer> {
	const requests: string[] = [];

	return listen(createHttpServer((request, response) => {
		requests.push(request.url ?? '');
		handler(request, response);
	}), requests, () => undefined);
}

/**
 * Starts an HTTPS server on 127.0.0.1 with a temporary self-signed certificate.
 *
 * @param handler - Response handler.
 * @returns Running server.
 */
export async function startSelfSignedHttpsServer(handler: LocalServerHandler): Promise<LocalServer> {
	const directory = mkdtempSync(join(tmpdir(), 'db3-network-'));
	const keyPath = join(directory, 'key.pem');
	const certPath = join(directory, 'cert.pem');
	const requests: string[] = [];

	execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });

	return listen(createHttpsServer({ key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }, (request, response) => {
		requests.push(request.url ?? '');
		handler(request, response);
	}), requests, () => rmSync(directory, { recursive: true, force: true }));
}

/**
 * Listens on an ephemeral loopback port.
 *
 * @param server - Server to start.
 * @param requests - Shared request log.
 * @param cleanup - Extra cleanup after close.
 * @returns Running server.
 */
async function listen(server: Server, requests: string[], cleanup: () => void): Promise<LocalServer> {
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

	const address = server.address();

	if (!address || typeof address === 'string') throw new Error('Expected a TCP listen address.');

	return {
		port: address.port,
		requests,
		close: async () => {
			server.closeAllConnections?.();
			await new Promise<void>(resolve => server.close(() => resolve()));
			cleanup();
		},
	};
}
