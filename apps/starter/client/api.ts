/** Same-origin JSON transport. Session tokens are HttpOnly and never read by JavaScript. */
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
	const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	const result = await response.json();
	if (!response.ok) throw new Error(result.message || 'Request failed.');
	return result;
}
