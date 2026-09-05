import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { AwsS3StorageAdapter } from '@flystorage/aws-s3';
import { FileStorage } from '@flystorage/file-storage';

import type { S3StorageDiskConfig } from '../types';
import { FlystorageDisk } from './FlystorageDisk';

/**
 * S3-compatible object storage disk.
 *
 * This driver supports AWS S3 plus providers that implement the S3 protocol,
 * such as DigitalOcean Spaces, by using a custom endpoint.
 */
export class S3StorageDisk extends FlystorageDisk {
	/**
	 * Creates an S3-compatible disk backed by Flystorage's AWS S3 adapter.
	 *
	 * @param name - Configured disk name.
	 * @param config - S3 disk configuration.
	 */
	constructor(name: string, config: S3StorageDiskConfig) {
		const bucket = requiredS3Option(config.bucket, 'bucket');
		const client = new S3Client(s3ClientConfig(config));

		super(name, new FileStorage(new AwsS3StorageAdapter(client, {
			bucket,
			prefix: trimSlashes(config.prefix),
			region: config.region,
			publicUrlOptions: {
				baseUrl: publicUrlBase(config.url),
				forcePathStyle: config.forcePathStyle,
				region: config.region,
			} as Record<string, unknown>,
		})));
	}
}

/**
 * Builds AWS SDK S3 client config from a storage disk config.
 *
 * @param config - S3 disk configuration.
 * @returns AWS SDK S3 client config.
 */
function s3ClientConfig(config: S3StorageDiskConfig): S3ClientConfig {
	return {
		region: config.region ?? 'us-east-1',
		endpoint: config.endpoint,
		forcePathStyle: config.forcePathStyle,
		credentials: credentials(config),
	};
}

/**
 * Resolves optional static S3 credentials from disk config.
 *
 * @param config - S3 disk configuration.
 * @returns AWS SDK credentials or undefined for default provider resolution.
 */
function credentials(config: S3StorageDiskConfig): S3ClientConfig['credentials'] {
	const accessKeyId = config.accessKeyId ?? config.key;
	const secretAccessKey = config.secretAccessKey ?? config.secret;

	if (!accessKeyId && !secretAccessKey) return undefined;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error('S3 storage disk requires both accessKeyId and secretAccessKey when either credential is configured.');
	}

	return {
		accessKeyId,
		secretAccessKey,
		sessionToken: config.sessionToken,
	};
}

/**
 * Returns a required S3 string option.
 *
 * @param value - Option value.
 * @param name - Option name used in error messages.
 * @returns Required non-empty string.
 */
function requiredS3Option(value: string | undefined, name: string): string {
	if (!value?.trim()) {
		throw new Error(`S3 storage disk requires a ${name}.`);
	}

	return value;
}

/**
 * Removes leading and trailing slashes from a configured prefix.
 *
 * @param value - Prefix value to normalize.
 * @returns Normalized prefix or undefined.
 */
function trimSlashes(value: string | undefined): string | undefined {
	const normalized = value?.replace(/^\/+|\/+$/g, '');

	return normalized ? normalized : undefined;
}

/**
 * Converts a configured public base URL into Flystorage's URL template shape.
 *
 * @param value - Configured public URL or template.
 * @returns URL template with a path placeholder.
 */
function publicUrlBase(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value.includes('{uri}')) return value;

	return `${value.replace(/\/+$/, '')}/{uri}`;
}
