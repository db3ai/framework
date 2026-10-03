/** Plain-text test content with an optional absolute HTTP(S) action link. */
export interface IntercomMessage {
	title: string;
	body: string;
	action?: { label: string; href: string };
}
