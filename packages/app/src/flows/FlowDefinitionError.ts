/**
 * One actionable validation issue found in a serialized flow definition.
 */
export interface FlowDefinitionIssue {
	/** Definition path associated with the issue. */
	path: string;
	/** Human-readable explanation. */
	message: string;
}

/**
 * Error thrown when a flow definition cannot be compiled safely.
 */
export class FlowDefinitionError extends Error {
	/**
	 * Creates an aggregate validation error.
	 *
	 * @param issues - Actionable definition issues.
	 */
	constructor(public readonly issues: FlowDefinitionIssue[]) {
		super(issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
		this.name = 'FlowDefinitionError';
	}
}
