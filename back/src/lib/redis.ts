import Redis from "ioredis";

/**
 * Shared Redis connection.
 *
 * Rate limiting needs a counter that every API process can see. An in-process
 * map is not authoritative: with two API processes the effective limit is twice
 * what was configured, and it resets on every restart. Redis is already a hard
 * dependency for the analysis queue, so reusing it costs nothing extra.
 */

const redisUrl = () => process.env.REDIS_URL?.trim() ?? "";

export const isRedisConfigured = () => redisUrl().length > 0;

/** Shared client, reused so a busy API does not open a socket per request. */
let client: Redis | undefined;
let connecting: Promise<Redis> | undefined;

/**
 * The shared connection, connected on first use.
 *
 * `lazyConnect` is combined with an explicit `connect()` rather than left to
 * ioredis: with `enableOfflineQueue: false` the first command issued before the
 * socket is up is rejected outright ("Stream isn't writeable"), which would turn
 * a healthy Redis into a 503 on the very first request after boot. Awaiting the
 * handshake keeps that first request working.
 */
export const getRedis = async (): Promise<Redis> => {
	const url = redisUrl();

	if (!url) {
		throw new Error("REDIS_URL is required for shared rate-limit state.");
	}

	if (client) {
		return client;
	}

	if (!connecting) {
		const redis = new Redis(url, {
			lazyConnect: true,
			maxRetriesPerRequest: 1,
			enableOfflineQueue: false,
			connectTimeout: 5000,
			// A rate limiter must not become an amplifier: when Redis is down we
			// fail closed at the call site, and retrying here would just pile up
			// attempts against a socket that is already failing.
			retryStrategy: () => null,
		});

		// Without a listener ioredis emits an unhandled "error" event and kills
		// the process. Callers handle failure through the returned promise.
		redis.on("error", () => {});

		// A cached client that has lost its socket is useless: `retryStrategy` is
		// null, so ioredis will not reconnect it. Drop the cache on the way out so
		// the next request builds a fresh connection. Without this a transient
		// Redis outage would leave the limiter permanently broken — every
		// request 503-ing — until the process was restarted.
		const forget = (failed: Redis) => {
			if (client === failed) client = undefined;
			failed.disconnect();
		};

		redis.on("end", () => {
			if (client === redis) client = undefined;
		});
		redis.on("close", () => {
			if (client === redis) client = undefined;
		});

		connecting = redis
			.connect()
			.then(() => {
				client = redis;
				return redis;
			})
			.catch((error) => {
				// Do not cache a failed handshake: the next request should retry
				// rather than inherit a permanently broken client.
				connecting = undefined;
				forget(redis);
				throw error;
			});
	}

	return connecting;
};

/**
 * Closes the shared connection. Used by tests and graceful shutdown.
 */
export const closeRedis = async () => {
	connecting = undefined;

	if (!client) return;

	const current = client;
	client = undefined;
	await current.quit().catch(() => current.disconnect());
};
