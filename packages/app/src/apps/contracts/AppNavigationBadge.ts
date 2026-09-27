/** A non-negative count with a complete accessible label, rendered as plain text by the host. */
export interface AppNavigationBadge {
	count: number;
	/** For example, "3 saved opportunities". */
	label: string;
}
