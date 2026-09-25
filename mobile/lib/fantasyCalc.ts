// FantasyCalc's own public values API - real, live trade-value and
// positional-rank data, verified directly (curl) before wiring this up: no
// auth required, and every player object carries a direct `sleeperId`
// cross-reference (confirmed populated on all ~200-420 relevant players for
// both formats), so unlike the ESPN integration this needs no name-fallback
// matching at all. The full response for either format is a few hundred KB
// - small enough to fetch straight from the client, no server-side trim
// needed the way ESPN's ~40MB feed required.
//
// isDynasty/isSuperflex pick the value set that actually matches the
// league's own format (FantasyCalc publishes separate dynasty/redraft and
// 1QB/superflex boards), so "positionRank" here means the same thing a
// manager in this exact league would see if they looked FantasyCalc up
// themselves.

import { cachedFetch } from "./requestCache";

const FC_TTL_MS = 6 * 60 * 60 * 1000; // trade values move slowly day to day - a few hours keeps this fresh without hammering FantasyCalc on every load

export interface FantasyCalcEntry {
  value: number;
  positionRank: number;
  overallRank: number;
  trend30Day: number;
}

export async function getFantasyCalcIndex(isDynasty: boolean, isSuperflex: boolean): Promise<Map<string, FantasyCalcEntry>> {
  const numQbs = isSuperflex ? 2 : 1;
  const key = `fantasyCalc:${isDynasty}:${numQbs}`;

  const raw = await cachedFetch(key, FC_TTL_MS, async () => {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=12&ppr=1`
    );
    if (!res.ok) throw new Error(`FantasyCalc request failed: ${res.status}`);
    return (await res.json()) as any[];
  });

  const byId = new Map<string, FantasyCalcEntry>();
  for (const row of raw) {
    const sleeperId = row?.player?.sleeperId;
    if (!sleeperId || typeof row.positionRank !== "number") continue;
    byId.set(String(sleeperId), {
      value: row.value,
      positionRank: row.positionRank,
      overallRank: row.overallRank,
      trend30Day: row.trend30Day ?? 0,
    });
  }
  return byId;
}
