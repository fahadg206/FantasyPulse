// Real trade-value overhaul for redraft leagues - dynasty is unchanged
// (computeAdjustedValue's real KTC dynasty-market bucket, format-adjusted
// for the league's own scoring, was never the complaint).
//
// Redraft used to reuse the exact same KTC-crawled "RdrftValue" bucket,
// only linearly rescaled per-position for PPR/passing-TD settings. Two
// real problems with that in practice: (1) it treats value as additive -
// two $2,000 players always "equal" one $4,000 player - when a real
// redraft market prices a true difference-maker at a real premium over
// bulk depth, and (2) it's this app's own derived approximation, not a
// real published market.
//
// FantasyCalc's own public API (already integrated for Start/Sit's rank
// source) publishes a real, live, community-driven redraft trade-value
// market - not a KTC rescale - keyed directly by Sleeper ID (no name
// matching). Verified live before wiring this up: it still prices real
// injured/IR players off their real season-long expectation rather than
// zeroing them out (A.J. Brown on IR: real value 2550, WR23 - not 0),
// which is exactly the "injured or not" bar this needed to clear.

import { getFantasyCalcIndex } from "./fantasyCalc";
import { computeAdjustedValue, RawPlayerValue, LeagueValueSettings } from "./playerValue";

export type TradeValueLookup = (playerId: string) => number;

/**
 * One value function per league format, built once and reused
 * synchronously everywhere a trade screen needs a player's real trade
 * value - dynasty keeps computeAdjustedValue's real KTC dynasty market;
 * redraft reasons off FantasyCalc's real redraft market instead, falling
 * back to the old KTC-derived redraft bucket only for the rare player
 * FantasyCalc doesn't carry (so nobody silently prices at zero).
 */
export async function buildTradeValueLookup(
  leagueValueSettings: LeagueValueSettings,
  valuesBySleeperId: Record<string, RawPlayerValue>
): Promise<TradeValueLookup> {
  if (leagueValueSettings.isDynasty) {
    return (playerId: string) => {
      const raw = valuesBySleeperId[playerId];
      return raw ? computeAdjustedValue(raw, leagueValueSettings) : 0;
    };
  }

  const fantasyCalc = await getFantasyCalcIndex(false, leagueValueSettings.isSuperflex).catch(
    () => new Map<string, { value: number }>()
  );

  return (playerId: string) => {
    const entry = fantasyCalc.get(playerId);
    if (entry) return entry.value;
    const raw = valuesBySleeperId[playerId];
    return raw ? computeAdjustedValue(raw, leagueValueSettings) : 0;
  };
}
