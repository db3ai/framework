/** An application error whose message is deliberately safe to send to the browser. */
export class HttpError extends Error {
	/** Associates a public message with its HTTP response code. */
	constructor(public readonly statusCode: number, message: string) { super(message); }
}
