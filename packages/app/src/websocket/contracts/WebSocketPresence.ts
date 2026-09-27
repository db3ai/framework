/** Approximate authenticated presence on one endpoint in this API process. */
export interface WebSocketPresence {
	userId: string;
	/** Multiple tabs/devices for the same account count as separate connections. */
	connections: number;
}
