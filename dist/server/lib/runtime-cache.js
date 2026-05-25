"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrSetRuntimeCache = getOrSetRuntimeCache;
exports.getOrSetRuntimeCacheStaleWhileRevalidate = getOrSetRuntimeCacheStaleWhileRevalidate;
exports.clearRuntimeCacheByPrefix = clearRuntimeCacheByPrefix;
const valueStore = new Map();
const pendingStore = new Map();
const MAX_CACHE_ENTRIES = 400;
function nowMs() {
    return Date.now();
}
function getEntryState(key) {
    const entry = valueStore.get(key);
    if (!entry)
        return { state: "miss", value: null };
    const currentTime = nowMs();
    if (entry.staleUntil <= currentTime) {
        valueStore.delete(key);
        return { state: "miss", value: null };
    }
    if (entry.expiresAt <= currentTime) {
        return { state: "stale", value: entry.value };
    }
    return { state: "fresh", value: entry.value };
}
function setEntry(key, value, ttlMs, staleTtlMs = 0) {
    if (valueStore.size >= MAX_CACHE_ENTRIES) {
        const currentTime = nowMs();
        for (const [entryKey, entryValue] of valueStore.entries()) {
            if (entryValue.staleUntil <= currentTime) {
                valueStore.delete(entryKey);
            }
        }
        if (valueStore.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = valueStore.keys().next().value;
            if (oldestKey) {
                valueStore.delete(oldestKey);
            }
        }
    }
    const expiresAt = nowMs() + ttlMs;
    const staleUntil = expiresAt + Math.max(staleTtlMs, 0);
    valueStore.set(key, {
        value,
        expiresAt,
        staleUntil,
    });
}
async function getOrSetRuntimeCache(key, ttlMs, loader) {
    const cached = getEntryState(key);
    if (cached.state === "fresh" && cached.value !== null) {
        return cached.value;
    }
    const pending = pendingStore.get(key);
    if (pending) {
        return pending;
    }
    const next = loader()
        .then((value) => {
        setEntry(key, value, ttlMs);
        return value;
    })
        .finally(() => {
        pendingStore.delete(key);
    });
    pendingStore.set(key, next);
    return next;
}
async function getOrSetRuntimeCacheStaleWhileRevalidate(key, ttlMs, staleTtlMs, loader) {
    const cached = getEntryState(key);
    if (cached.state === "fresh" && cached.value !== null) {
        return cached.value;
    }
    const pending = pendingStore.get(key);
    if (cached.state === "stale" && cached.value !== null) {
        if (!pending) {
            const refresh = loader()
                .then((value) => {
                setEntry(key, value, ttlMs, staleTtlMs);
                return value;
            })
                .finally(() => {
                pendingStore.delete(key);
            });
            pendingStore.set(key, refresh);
            void refresh.catch(() => {
            });
        }
        return cached.value;
    }
    if (pending) {
        return pending;
    }
    const next = loader()
        .then((value) => {
        setEntry(key, value, ttlMs, staleTtlMs);
        return value;
    })
        .finally(() => {
        pendingStore.delete(key);
    });
    pendingStore.set(key, next);
    return next;
}
function clearRuntimeCacheByPrefix(prefix) {
    for (const key of valueStore.keys()) {
        if (key.startsWith(prefix)) {
            valueStore.delete(key);
        }
    }
    for (const key of pendingStore.keys()) {
        if (key.startsWith(prefix)) {
            pendingStore.delete(key);
        }
    }
}
