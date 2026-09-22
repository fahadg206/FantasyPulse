// A big chunk of the app's "slowness and reloading between pages" comes
// down to the same handful of expensive, mostly-static requests - the full
// players payload above all (a multi-MB fetchPlayers response), plus a
// league's own settings/users - getting re-fetched from scratch on every
// single screen mount that needs them (Dashboard, Schedule, Standings, the
// Matchup detail page, Profile, League Managers all want the same league's
// players/users/settings independently). None of that data changes
// mid-session in any way that matters to the UI, so there's no reason each
// screen should pay for its own network round trip.
//
// cachedFetch is a tiny in-memory (module-level, so it survives navigation
// but not an app restart) cache with a TTL, plus in-flight de-duplication -
// two screens asking for the same key within the same few hundred ms (e.g.
// a fast tab switch, or two components on one screen both wanting players
// data) share one request instead of firing two.
//
// Anything whose freshness actually matters for what's on screen right now
// - live scores, matchups, the current NFL week - is deliberately NOT
// routed through this and stays a plain fetch every time.

type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      inFlight.delete(key);
      return value;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });

  inFlight.set(key, promise);
  return promise;
}

/** Drops every cached entry whose key starts with `keyPrefix` (or everything, if omitted) - not currently called anywhere, but here for whenever something needs to force a refetch (e.g. after the signed-in user edits their own team name/avatar). */
export function invalidateCache(keyPrefix?: string) {
  if (!keyPrefix) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  }
}
