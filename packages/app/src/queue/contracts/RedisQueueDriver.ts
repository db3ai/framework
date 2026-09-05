/**
 * Connection and key options for the Redis queue driver.
 */
export interface RedisQueueDriverOptions {
	/**
	 * Redis connection URL. When omitted, the driver reads QUEUE_REDIS_URL or REDIS_URL.
	 */
	url?: string;
	/**
	 * Redis host used when no URL is supplied.
	 */
	host?: string;
	/**
	 * Redis port used when no URL is supplied.
	 */
	port?: number;
	/**
	 * Redis username for ACL authentication.
	 */
	username?: string;
	/**
	 * Redis password for authentication.
	 */
	password?: string;
	/**
	 * Redis database index selected after connecting.
	 */
	database?: number;
	/**
	 * Prefix applied to every key owned by this queue driver.
	 */
	keyPrefix?: string;
	/**
	 * Milliseconds to wait before failing the Redis connection attempt.
	 */
	connectionTimeoutMs?: number;
}
