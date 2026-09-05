#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReleaseContextIssues, formatReleaseIssues } from './lib/framework-release-policy.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const context = {
	eventName: process.env.GITHUB_EVENT_NAME,
	version: process.env.FRAMEWORK_RELEASE_VERSION,
	confirmation: process.env.FRAMEWORK_RELEASE_CONFIRMATION,
	repository: process.env.GITHUB_REPOSITORY,
	visibility: process.env.GITHUB_REPOSITORY_VISIBILITY,
	refType: process.env.GITHUB_REF_TYPE,
	refName: process.env.GITHUB_REF_NAME,
	defaultBranch: process.env.GITHUB_DEFAULT_BRANCH,
};
const issues = collectReleaseContextIssues(context);

if (issues.length > 0) {
	throw new Error(formatReleaseIssues('Unsafe framework release context', issues));
}

assertAnnotatedTagAtHead(context.refName ?? '', context.defaultBranch ?? '');
console.log(`Validated public release-candidate context for ${context.refName}.`);

/**
 * Confirms the dispatched ref is an annotated tag resolving to the checkout.
 *
 * Lightweight or mismatched tags are rejected so the candidate has a durable,
 * reviewable source identity before any release artifact is assembled.
 *
 * @param {string} tagName - Validated release tag name.
 * @param {string} defaultBranch - Public repository default branch.
 * @returns {void}
 */
function assertAnnotatedTagAtHead(tagName, defaultBranch) {
	const reference = `refs/tags/${tagName}`;
	const referenceType = runGit(['cat-file', '-t', reference]);

	if (referenceType !== 'tag') {
		throw new Error(`Release ref ${reference} must be an annotated tag.`);
	}

	const tagCommit = runGit(['rev-parse', `${reference}^{commit}`]);
	const headCommit = runGit(['rev-parse', 'HEAD']);

	if (tagCommit !== headCommit) {
		throw new Error(`Release tag ${reference} does not resolve to the checked-out commit.`);
	}

	runGit(['check-ref-format', `refs/heads/${defaultBranch}`]);
	runGit(['merge-base', '--is-ancestor', 'HEAD', `refs/remotes/origin/${defaultBranch}`]);
}

/**
 * Runs one read-only Git command and returns trimmed standard output.
 *
 * @param {string[]} arguments_ - Git arguments.
 * @returns {string} Trimmed command output.
 */
function runGit(arguments_) {
	const result = spawnSync('git', arguments_, {
		cwd: resolve(REPOSITORY_ROOT),
		encoding: 'utf8',
		stdio: 'pipe',
	});

	if (result.status !== 0) {
		throw new Error([
			`Git release-context check failed: git ${arguments_.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}

	return result.stdout.trim();
}
