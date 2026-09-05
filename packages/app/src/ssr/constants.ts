/** Marker replaced with document head tags during SSR document assembly. */
export const SSR_HEAD_MARKER = '<!--platform-ssr-head-->';

/** Marker replaced with application markup during SSR document assembly. */
export const SSR_APP_MARKER = '<!--platform-ssr-app-->';

/** Marker replaced with safely serialised hydration state. */
export const SSR_STATE_MARKER = '<!--platform-ssr-state-->';
