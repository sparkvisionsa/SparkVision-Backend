"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeRateLimit = consumeRateLimit;
const limiterStore = new Map();
function consumeRateLimit(key, options) {
    const now = Date.now();
    const existing = limiterStore.get(key);
    if (!existing || existing.resetAt < now) {
        limiterStore.set(key, {
            count: 1,
            resetAt: now + options.windowMs,
        });
        return {
            allowed: true,
            remaining: options.limit - 1,
            resetAt: now + options.windowMs,
        };
    }
    if (existing.count >= options.limit) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: existing.resetAt,
        };
    }
    existing.count += 1;
    limiterStore.set(key, existing);
    return {
        allowed: true,
        remaining: options.limit - existing.count,
        resetAt: existing.resetAt,
    };
}
