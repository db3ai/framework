/**
 * Where a server built by `db3 build:server` registers its compiled local apps, by source entry
 * path, so `Apps.load` imports them without a TypeScript loader.
 */
export const COMPILED_APPS = Symbol.for('db3.compiledApps');
