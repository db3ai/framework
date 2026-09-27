/** Browser-safe opportunity returned by the public Social service. */
export interface SocialOpportunityData {
	id: string;
	title: string;
	url: string;
	notes: string;
	status: 'saved' | 'answered' | 'dismissed';
	createdAt: string;
}
