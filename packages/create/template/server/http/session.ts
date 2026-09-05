import type { App } from '@db3.ai/app';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './errors';

/** Cookie name is host-only; no domain-wide sharing between unrelated applications. */
export const sessionCookie = 'db3_session';

/** Sets the opaque session token in a host-only, HttpOnly cookie. */
export function setSession(reply: FastifyReply, token: string, secure: boolean) {
	reply.setCookie(sessionCookie, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 60 * 60 * 24 * 7 });
}

/** Authenticates the current cookie or rejects before any private record lookup. */
export async function requireUser(application: App, request: FastifyRequest) {
	const token = request.cookies[sessionCookie];
	const user = token ? await application.auth.authenticateToken(token) : null;
	if (!user) throw new HttpError(401, 'Please sign in.');
	return user;
}
