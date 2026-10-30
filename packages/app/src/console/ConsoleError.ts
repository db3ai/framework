/** A console request the app refused, with the HTTP status to answer and a message to show. */
export class ConsoleError extends Error {
	/**
	 * @param message - Plain message for the person using the console.
	 * @param statusCode - HTTP status.
	 */
	constructor(message: string, readonly statusCode: number) {
		super(message);
		this.name = 'ConsoleError';
	}
}
