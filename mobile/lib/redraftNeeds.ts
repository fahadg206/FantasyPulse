// Team-need determination for redraft (and keeper) leagues - a genuinely
// different question than lib/draftLottery.ts's dynasty version, which is
// deliberately scoped to the one dynasty league it was built for
// (LOTTERY_LEAGUE_IDS) and reasons entirely off long-term KTC trade value.
// A redraft team doesn't have a "long-term" - there's no next season to
// lean on, so what actually matters is how this exact roster is going to
// score for the rest of THIS season, which dynasty asset value says
// nothing about (a rookie with zero snaps can carry real dynasty value and
// zero redraft relevance).
//
// The signal here is built entirely from real data this app already
// fetches - no new API, nothing invented:
//   - season-to-date PPG: every played week's real box score
//     (players_points, from Sleeper's own matchup data - already pulled
//     for the win-impact projection) averaged per player, so it reflects
//     actual performance, not a preseason guess.
//   - rest-of-season PPG: Sleeper's own weekly player projections,
//     averaged across every week still left to play, not just next
//     week's single snapshot (steadier - a bye week or a soft/tough matchup
//     one week doesn't swing it).
// Blended 50/50 once a player has actually played, or projection-only for
// someone who hasn't (a rookie or a fresh waiver add with no box scores
// yet) - never silently scored at 0 for having no history.
//
// Same "how far below the league's own bar" formula as the dynasty
// version (lib/draftLottery.ts's needScoresForTeam) - reused directly,
// not reinvented - just fed a redraft-appropriate input. One real
// difference in the input itself: redraft blends in the backup's own
// score (70/30 best-to-second-best), not just the single best player,
// since bye-week/injury bench depth is a real redraft concern a dynasty
// team can just go trade for next month and a redraft team can't.

import type { PlayerPos } from "./draftProspects";
import { computeLeagueAvgBestValue, needScoresForTeam, biggestNeed, TeamNeed } from "./draftLottery";
import type { SimTeamInfo } from "./leagueSimData";

const NEED_POSITIONS: PlayerPos[] = ["QB", "RB", "WR", "TE"];

/** real per-player season-to-date average fantasy points, off every played week's real box score - not roster-dependent (a player's raw score that week is the same number regardless of whose bench they sat on). */
export function buildSeasonToDatePPG(matchupData: Record<number, any>, playedWeeks: number[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const games: Record<string, number> = {};
  for (const week of playedWeeks) {
    const weekData = matchupData[week];
    if (!weekData) continue;
    for (const userId in weekData) {
      const pts: Record<string, number> | undefined = weekData[userId]?.players_points;
      if (!pts) continue;
      for (const pid in pts) {
        const v = pts[pid];
        if (typeof v !== "number") continue;
        totals[pid] = (totals[pid] ?? 0) + v;
        games[pid] = (games[pid] ?? 0) + 1;
      }
    }
  }
  const ppg: Record<string, number> = {};
  for (const pid in totals) ppg[pid] = games[pid] > 0 ? totals[pid] / games[pid] : 0;
  return ppg;
}

function restOfSeasonPPG(playerId: string, remainingWeeks: number[], playersData: Record<string, any>): number {
  if (remainingWeeks.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const week of remainingWeeks) {
    const p = playersData?.[playerId]?.wi?.[week.toString()]?.p;
    if (p !== undefined) {
      sum += parseFloat(p);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** this player's "how good for the rest of this season" number - the actual redraft-relevant unit everything below is built from. */
export function redraftPlayerScore(
  playerId: string,
  seasonToDatePPG: Record<string, number>,
  remainingWeeks: number[],
  playersData: Record<string, any>
): number {
  const hasHistory = playerId in seasonToDatePPG;
  const hasFuture = remainingWeeks.length > 0;
  if (!hasHistory) return hasFuture ? restOfSeasonPPG(playerId, remainingWeeks, playersData) : 0;
  if (!hasFuture) return seasonToDatePPG[playerId];
  return seasonToDatePPG[playerId] * 0.5 + restOfSeasonPPG(playerId, remainingWeeks, playersData) * 0.5;
}

/** this roster's redraft-relevant strength at each position - best player weighted most, but the backup's own score counts too (bench depth is a real redraft concern), unlike the dynasty version which only ever looks at the single best asset. */
export function bestRedraftScoreByPosition(
  rosterPlayerIds: string[],
  playersData: Record<string, any>,
  seasonToDatePPG: Record<string, number>,
  remainingWeeks: number[]
): Record<PlayerPos, number> {
  const byPos: Record<PlayerPos, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const id of rosterPlayerIds) {
    const pos = playersData?.[id]?.pos as PlayerPos | undefined;
    if (!pos || !(pos in byPos)) continue;
    byPos[pos].push(redraftPlayerScore(id, seasonToDatePPG, remainingWeeks, playersData));
  }
  const result = {} as Record<PlayerPos, number>;
  for (const pos of NEED_POSITIONS) {
    const scores = byPos[pos].sort((a, b) => b - a);
    const best = scores[0] ?? 0;
    const second = scores[1] ?? 0;
    result[pos] = best * 0.7 + second * 0.3;
  }
  return result;
}

export interface RedraftNeedsResult {
  scores: Record<PlayerPos, number>;
  ranked: TeamNeed[];
  biggest: TeamNeed;
}

export function computeRedraftTeamNeeds(
  rosterPlayerIds: string[],
  playersData: Record<string, any>,
  seasonToDatePPG: Record<string, number>,
  remainingWeeks: number[],
  leagueAvg: Record<PlayerPos, number>
): RedraftNeedsResult {
  const best = bestRedraftScoreByPosition(rosterPlayerIds, playersData, seasonToDatePPG, remainingWeeks);
  const scores = needScoresForTeam(best, leagueAvg);
  const ranked = NEED_POSITIONS.map((pos) => ({ pos, score: scores[pos] })).sort((a, b) => b.score - a.score);
  return { scores, ranked, biggest: biggestNeed(scores) };
}

/** the league's own real redraft bar at each position, from every team's CURRENT roster - held fixed while a trade is being built, same pattern as the dynasty baseline. */
export function computeLeagueRedraftNeedBaseline(
  managerInfo: Record<string, SimTeamInfo>,
  playersData: Record<string, any>,
  seasonToDatePPG: Record<string, number>,
  remainingWeeks: number[]
): Record<PlayerPos, number> {
  const byRoster: Record<string, Record<PlayerPos, number>> = {};
  for (const userId in managerInfo) {
    byRoster[userId] = bestRedraftScoreByPosition(
      managerInfo[userId].rosterPlayerIds,
      playersData,
      seasonToDatePPG,
      remainingWeeks
    );
  }
  return computeLeagueAvgBestValue(byRoster);
}
