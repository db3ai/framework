/** Immutable notification that one application note has already been saved. */
export class NoteSaved {
	/**
	 * Carries identifiers rather than a request, model connection or mutable service.
	 * @param noteId - Saved note identity.
	 * @param ownerId - Authorized owner identity determined by the producer.
	 */
	constructor(readonly noteId: string, readonly ownerId: string) {}
}
