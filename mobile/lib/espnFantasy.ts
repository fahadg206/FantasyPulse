// ESPN's own public fantasy football data - real weekly expert rankings
// and real written game-outlook text, verified live before shipping.
// Fetched through this app's own backend (src/pages/api/fetchEspnRankings.js),
// which trims ESPN's real but massive (~40MB) full-player feed down to
// just the players with real data for the requested week - the raw feed
// has no filter that actually shrinks the response, so this can't
// reasonably happen straight from a mobile client.
//
// ESPN's own system blends several of their internal analysts into one
// rankings[week] array per player, tagged with a numeric rankSourceId
// ESPN doesn't publish a name for - rather than guess at who's who, the
// backend already averages a player's real PPR-type entries into one
// honest "ESPN Fantasy" composite number, the same shape a real named
// source (Sleeper's own projections) contributes to the page's consensus.

import { cachedFetch } from "./requestCache";
import { backend } from "./api";

const ESPN_TTL_MS = 3 * 60 * 60 * 1000; // rankings/outlooks shift through the week (injury news, etc.) - a few hours keeps this fresh without hammering the backend on every page load

export interface EspnPlayerWeek {
  name: string;
  rank?: number;
  outlook?: string;
}

/** normalizes a full name for matching across providers - lowercase, strips punctuation/suffixes (Jr., II, III, ...) that Sleeper and ESPN don't always agree on spelling the same way. */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface EspnRankingsIndex {
  /** keyed by ESPN's own numeric player id - the fast, exact path when Sleeper's own espn_id cross-reference happens to be populated */
  byId: Map<number, EspnPlayerWeek>;
  /** keyed by normalized full name - not every real player has Sleeper's espn_id field populated (confirmed live: it's missing for plenty of current, relevant players), so this is the fallback that actually gets real coverage */
  byName: Map<string, EspnPlayerWeek>;
}

export async function getEspnWeeklyData(season: string | number, week: number): Promise<EspnRankingsIndex> {
  const raw = await cachedFetch(`espnFantasyWeek:${season}:${week}`, ESPN_TTL_MS, () => backend.fetchEspnRankings(season, week));

  const byId = new Map<number, EspnPlayerWeek>();
  const byName = new Map<string, EspnPlayerWeek>();
  for (const idStr in raw) {
    const entry = raw[idStr];
    const parsed: EspnPlayerWeek = { name: entry.name, rank: entry.rank, outlook: entry.outlook };
    byId.set(Number(idStr), parsed);
    if (entry.name) byName.set(normalizePlayerName(entry.name), parsed);
  }
  return { byId, byName };
}
