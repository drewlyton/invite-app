import { defineMiddleware } from "astro:middleware";
import { LRUCache } from "lru-cache";

// Define the interface for the rate limit tracking object
interface RateLimitData {
	count: number;
	resetTime: number;
}

// Configure the LRU Cache with explicit types <Key, Value>
const rateLimitCache = new LRUCache<string, RateLimitData>({
	max: 5000, // Maximum number of unique IP addresses to track
	ttl: 60 * 1000, // Time-to-Live: 1 minute (in milliseconds)
	allowStale: false, // Do not return expired items
	updateAgeOnGet: false, // Do not reset the TTL clock when a user makes a request
});

const MAX_REQUESTS = 30; // Limit each IP to 30 requests per minute

export const onRequest = defineMiddleware(async (context, next) => {
	const { request, url } = context;

	// Only apply rate limiting to API routes
	if (url.pathname.startsWith("/api/")) {
		// Extract client IP address securely
		const forwardedFor = request.headers.get("x-forwarded-for");
		const ip: string =
			forwardedFor?.split(",")[0]?.trim() ||
			request.headers.get("cf-connecting-ip") ||
			"unknown";

		// Retrieve or initialize tracking data for this IP
		let rateData = rateLimitCache.get(ip);

		if (!rateData) {
			rateData = {
				count: 0,
				resetTime: Date.now() + (rateLimitCache.ttl || 60000),
			};
		}

		// Increment request count
		rateData.count++;

		// Save updated data back to the cache
		rateLimitCache.set(ip, rateData);

		// Block the client if they exceed the maximum allowed requests
		if (rateData.count > MAX_REQUESTS) {
			const now = Date.now();
			const retryAfter = Math.ceil(
				Math.max(0, rateData.resetTime - now) / 1000,
			);

			return new Response(
				JSON.stringify({
					error: "Too Many Requests",
					message: "You have exceeded your rate limit. Please try again later.",
				}),
				{
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": String(retryAfter), // Seconds the client must wait
					},
				},
			);
		}
	}

	return next();
});
