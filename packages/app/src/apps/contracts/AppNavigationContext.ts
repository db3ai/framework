/** Request-scoped identity supplied by the host after authentication and scope authorization. Never store it on an app singleton. */
export interface AppNavigationContext {
	readonly actor: { readonly id: string };
	/** Optional organisation already authorized by the host; apps must still enforce their own data permissions. */
	readonly organisationId?: string;
}
