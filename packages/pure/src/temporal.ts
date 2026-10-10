/**
 * The only runtime dependency on the Temporal polyfill. Keep Temporal objects internal:
 * public date helpers expose Dates and strings, so consumers do not depend on its types.
 * When the minimum runtime provides Temporal, replace this export with the native global.
 * Browser consumers still require this implementation until their support policy permits
 * native Temporal; use a browser-specific package condition before removing server loading.
 * This module deliberately does not modify globalThis.
 */
export { Temporal } from '@js-temporal/polyfill';
