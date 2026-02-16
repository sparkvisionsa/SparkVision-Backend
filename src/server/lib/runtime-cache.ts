type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  staleUntil: number;
};

const valueStore = new Map<string, CacheEntry<unknown>>();
const pendingStore = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 400;

function nowMs() {
  return Date.now();
}

function getEntryState<T>(key: string): { state: "fresh" | "stale" | "miss"; value: T | null } {
  const entry = valueStore.get(key);
  if (!entry) return { state: "miss", value: null };
  const currentTime = nowMs();
  if (entry.staleUntil <= currentTime) {
    valueStore.delete(key);
    return { state: "miss", value: null };
  }
  if (entry.expiresAt <= currentTime) {
    return { state: "stale", value: entry.value as T };
  }
  return { state: "fresh", value: entry.value as T };
}

function setEntry<T>(key: string, value: T, ttlMs: number, staleTtlMs = 0) {
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

export async function getOrSetRuntimeCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = getEntryState<T>(key);
  if (cached.state === "fresh" && cached.value !== null) {
    return cached.value;
  }

  const pending = pendingStore.get(key) as Promise<T> | undefined;
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

export async function getOrSetRuntimeCacheStaleWhileRevalidate<T>(
  key: string,
  ttlMs: number,
  staleTtlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = getEntryState<T>(key);
  if (cached.state === "fresh" && cached.value !== null) {
    return cached.value;
  }

  const pending = pendingStore.get(key) as Promise<T> | undefined;

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
        // Keep stale value when background refresh fails.
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

export function clearRuntimeCacheByPrefix(prefix: string) {
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
