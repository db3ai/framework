import './test-environment.mjs';

requireReleaseInfrastructure();

/**
 * Makes infrastructure-backed conformance suites mandatory for a release run.
 *
 * @returns {void}
 */
function requireReleaseInfrastructure() {
	process.env.TEST_REDIS_REQUIRED = '1';
}
