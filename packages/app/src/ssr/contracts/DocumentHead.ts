/** Attribute value supported by server-rendered document head tags. */
export type DocumentHeadAttributeValue = string | number | boolean | null | undefined;

/** Attributes written onto a server-rendered document head tag. */
export type DocumentHeadAttributes = Record<string, DocumentHeadAttributeValue>;

/**
 * Script emitted through the single server-rendered document head pipeline.
 *
 * Content must come from trusted application code. The renderer prevents a
 * closing script sequence from escaping the tag but does not sanitise scripts.
 */
export interface DocumentHeadScript {
	/** HTML attributes written onto the script element. */
	attributes?: DocumentHeadAttributes;
	/** Trusted inline script or JSON-LD content. */
	content?: string;
}

/**
 * Head metadata collected while rendering one HTTP request.
 *
 * Applications can mutate this request-owned object from their SSR router or
 * page components. It is rendered once into the document template.
 */
export interface DocumentHead {
	/** Browser and search-result title for the rendered document. */
	title?: string;
	/** Meta elements, including descriptions, robots and social metadata. */
	meta: DocumentHeadAttributes[];
	/** Link elements, including canonical URLs and alternate resources. */
	link: DocumentHeadAttributes[];
	/** Trusted scripts, including JSON-LD structured data. */
	script: DocumentHeadScript[];
}
