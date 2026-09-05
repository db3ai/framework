import { displayNameFromIdentifier } from '@db3.ai/pure';

export type ActiveRecordLookup = unknown | Record<string, unknown>;

/**
 * Error thrown when an ActiveRecord lookup cannot find a matching row.
 */
export class RecordNotFoundError extends Error {
	/**
	 * Creates a not-found error for a model lookup.
	 *
	 * @param modelName - Name of the model that was queried.
	 * @param lookup - Lookup value or criteria used by the query.
	 */
	constructor(
		public readonly modelName: string,
		public readonly lookup?: ActiveRecordLookup,
	) {
		super(`The requested ${displayNameFromIdentifier(modelName)} could not be found.`);
		this.name = 'RecordNotFoundError';
	}
}
