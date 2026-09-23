// The actual math behind the Trade Calculator's impact numbers - kept
// separate from the screen so each piece can be reasoned about (and
// sanity-checked) on its own.

import { RawPlayerValue, LeagueValueSettings, computeAdjustedValue } from "./playerValue";
import { computeLeagueAvgBestValue, needScoresForTeam, biggestNeed, TeamNeed } from "./draftLottery";
import type { PlayerPos } from "./draftProspects";
import { projectStandings, TeamSeedData, Overrides } from "./whatIfSimulation";
import type { SimTeamInfo } from "./leagueSimData";

const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
function slotEligibility(slot: string): string[] {
  return FLEX_ELIGIBILITY[slot] ?? [slot];
}

export interface LineupSlotAssignment {
  slot: string;
  playerId: string | null;
  points: number;
}

/**
 * Same greedy assignment as startSitAccuracy.ts's optimalLineupPoints, but
 * returns which player landed in which slot (not just the total) - what
 * the "preview lineup" card actually needs to render. Kept as its own
 * function rather than changing that one's return type, since
 * profileActivity.ts's all-time crawl only ever needs the total.
 */
export function computeOptimalLineupAssignment(
  rosterPlayerIds: string[],
  pointsById: Record<string, number>,
  posById: Record<string, string | undefined>,
  slots: string[]
): LineupSlotAssignment[] {
  const openSlots = slots.map((slot, i) => ({ slot, i }));
  const sorted = [...rosterPlayerIds].sort((a, b) => (pointsById[b] ?? 0) - (pointsById[a] ?? 0));
  const assignment: (string | null)[] = new Array(slots.length).fill(null);

  for (const playerId of sorted) {
    const pos = posById[playerId];
    if (!pos) continue;
    let idx = openSlots.findIndex(({ slot }) => {
      const elig = slotEligibility(slot);
      return elig.length === 1 && elig[0] === pos;
    });
    if (idx === -1) idx = openSlots.findIndex(({ slot }) => slotEligibility(slot).includes(pos));
    if (idx === -1) continue;
    const { i } = openSlots[idx];
    assignment[i] = playerId;
    openSlots.splice(idx, 1);
  }

  return slots.map((slot, i) => ({
    slot,
    playerId: assignment[i],
    points: assignment[i] ? pointsById[assignment[i]!] ?? 0 : 0,
  }));
}

const NEED_POSITIONS: PlayerPos[] = ["QB", "RB", "WR", "TE"];

/** this roster's single best real dynasty-adjusted value at each position - the same "real starter bar" input computeLeagueAvgBestValue/needScoresForTeam expect. */
export function bestValueByPosition(
  rosterPlayerIds: string[],
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings
): Record<PlayerPos, number> {
  const best = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<PlayerPos, number>;
  for (const id of rosterPlayerIds) {
    const pos = playersData?.[id]?.pos as PlayerPos | undefined;
    if (!pos || !NEED_POSITIONS.includes(pos)) continue;
    const raw = valuesBySleeperId[id];
    if (!raw) continue;
    const value = computeAdjustedValue(raw, leagueValueSettings);
    if (value > best[pos]) best[pos] = value;
  }
  return best;
}

export interface TeamNeedsResult {
  scores: Record<PlayerPos, number>;
  ranked: TeamNeed[];
  biggest: TeamNeed;
}

/** value-based needs (see lib/draftLottery.ts) for one roster against the league's own real bar - same "a great starter beats a pile of bodies" logic already shipped for the Draft Lottery board, reused here instead of a second implementation. */
export function computeTeamNeeds(
  rosterPlayerIds: string[],
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings,
  leagueAvgBestValue: Record<PlayerPos, number>
): TeamNeedsResult {
  const best = bestValueByPosition(rosterPlayerIds, playersData, valuesBySleeperId, leagueValueSettings);
  const scores = needScoresForTeam(best, leagueAvgBestValue);
  const ranked = [...NEED_POSITIONS]
    .map((pos) => ({ pos, score: scores[pos] }))
    .sort((a, b) => b.score - a.score);
  return { scores, ranked, biggest: biggestNeed(scores) };
}

/** the league's own real bar at each position, from every team's CURRENT roster - held fixed while a trade is being built, same as the Draft Lottery board does for its mock draft. */
export function computeLeagueNeedBaseline(
  managerInfo: Record<string, SimTeamInfo>,
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings
): Record<PlayerPos, number> {
  const byRoster: Record<string, Record<PlayerPos, number>> = {};
  for (const userId in managerInfo) {
    byRoster[userId] = bestValueByPosition(
      managerInfo[userId].rosterPlayerIds,
      playersData,
      valuesBySleeperId,
      leagueValueSettings
    );
  }
  return computeLeagueAvgBestValue(byRoster);
}

export interface WinImpact {
  before: { wins: number; losses: number };
  after: { wins: number; losses: number };
  winsDelta: number;
}

/**
 * Real projected-wins impact, via the same deterministic projectStandings
 * engine the Standings "What If" scenario explorer already uses (every
 * undecided game resolves to whichever side projects higher) - not a
 * second, ad-hoc formula. Runs it once off each team's CURRENT best-lineup
 * projection, once more with `adjustedProjectionCache` swapped in for
 * whatever weeks/teams the trade actually changes, and diffs the result.
 */
export function computeWinImpact(
  teamIds: string[],
  managerInfo: Record<string, TeamSeedData>,
  matchupData: Record<number, any>,
  baseProjectionCache: Record<number, Record<string, number>>,
  adjustedProjectionCache: Record<number, Record<string, number>>,
  playoffStartWeek: number,
  userId: string
): WinImpact {
  const overrides: Overrides = {};
  const before = projectStandings(teamIds, managerInfo, matchupData, baseProjectionCache, playoffStartWeek, overrides, 0, teamIds.length);
  const after = projectStandings(teamIds, managerInfo, matchupData, adjustedProjectionCache, playoffStartWeek, overrides, 0, teamIds.length);

  const beforeRow = before.find((r) => r.userId === userId);
  const afterRow = after.find((r) => r.userId === userId);

  return {
    before: { wins: beforeRow?.wins ?? 0, losses: beforeRow?.losses ?? 0 },
    after: { wins: afterRow?.wins ?? 0, losses: afterRow?.losses ?? 0 },
    winsDelta: (afterRow?.wins ?? 0) - (beforeRow?.wins ?? 0),
  };
}
