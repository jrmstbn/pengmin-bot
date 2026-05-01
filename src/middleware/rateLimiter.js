/**
 * src/middleware/rateLimiter.js — Per-User Rate Limiter
 *
 * A sliding-window rate limiter backed by a simple in-memory Map.
 * Designed to prevent API abuse and manage OpenAI costs.
 *
 * For multi-process deployments, replace the Map with Redis (ioredis).
 */

class RateLimiter {
  /**
   * @param {Object} opts
   * @param {number} opts.windowMs    Time window in milliseconds.
   * @param {number} opts.maxRequests Max requests per window per key.
   */
  constructor({ windowMs = 5_000, maxRequests = 1 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    // Map<userId, { count: number, resetAt: number }>
    this.store = new Map();

    // Cleanup stale entries every 5 minutes.
    setInterval(() => this.#cleanup(), 5 * 60 * 1000);
  }

  /**
   * check()
   * Returns the remaining cooldown in ms if the user is limited, or 0 if allowed.
   * Increments the request counter as a side effect.
   *
   * @param {string} key  Usually the Discord userId.
   * @returns {number}    ms remaining if limited, 0 if allowed.
   */
  check(key) {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now >= record.resetAt) {
      // First request in this window.
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }

    if (record.count >= this.maxRequests) {
      // Still within the window and over the limit.
      return record.resetAt - now;
    }

    // Within window, under limit.
    record.count++;
    return 0;
  }

  /** Remove expired entries to prevent memory leaks. */
  #cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store) {
      if (now >= record.resetAt) this.store.delete(key);
    }
  }
}

module.exports = RateLimiter;
