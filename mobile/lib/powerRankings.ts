// src/lib/powerRankings.ts
//
// Power rankings, in the spirit of Dynasty Daddy's power rankings page
// (github.com/G-Sher/dynasty-daddy), but sorted into tiers and weighted
// differently depending on whether the league is dynasty or redraft. A
// redraft roster has no future to speak of - everything resets in the
// offseason - so its power score leans entirely on this-season roster
// strength and record. A dynasty roster's long-term asset value (the
// *entire* roster's trade value, not just starters - youth and bench depth
// matter for a rebuild) factors in too.
//
// Tiers are assigned by rank percentile within the league, not a fixed
// score cutoff, so every league gets a full spread of tiers regardless of
// its size or how bunched together teams are. The bottom tier is "Rebuild"
// for dynasty leagues (there's a real rebuild to be had, via youth and
// future picks) and "No Chance" for redraft leagues (nothing carries over
// to next season, so there's nothing to rebuild toward - a team is just
// out of contention this year). Which applies is determined entirely from
// the league's own settings (see getLeagueValueSettings in
// src/lib/playerValue.ts) - never a manual toggle.

import {
  LeagueValueSettings,
  RawPlayerValue,
  computeAdjustedValue,
} from "./playerValue";

export type PowerRankingTier =
  | "Contender"
  | "Playoff Contender"
  | "Middle of the Pack"
  | "Rebuild"
  | "No Chance";

export interface PowerRankingTeamInput {
  rosterId: number;
  userId: string;
  wins: number;
  losses: number;
  /** every rostered player's Sleeper id (starters + bench) */
  rosterSleeperIds: string[];
  /** that team's current starting lineup's Sleeper ids */
  starterSleeperIds: string[];
}

export interface PowerRankingResult {
  rosterId: number;
  userId: string;
  /** overall rank, 1 = best - by the full blended powerScore (strength + record + assets) */
  rank: number;
  /** starter rank, 1 = best - by this-season starting lineup strength alone,
   * independent of record or long-term assets */
  starterRank: number;
  tier: PowerRankingTier;
  powerScore: number; // 0-100
  strengthScore: number; // 0-100 percentile, this-season roster strength
  recordScore: number; // 0-100 percentile, win pct
  /** 0-100 percentile of dynasty asset value; null for redraft leagues,
   * where long-term assets don't factor into the score at all */
  assetScore: number | null;
}

export interface ComputePowerRankingsInput {
  teams: PowerRankingTeamInput[];
  leagueSettings: LeagueValueSettings;
  /** sum of a team's starters' projected points for a given week - already
   * how this app rates weekly team strength elsewhere (see
   * playoffSimulator.ts) */
  getWeeklyStarterProjection: (
    starterSleeperIds: string[],
    week: number
  ) => number;
  /** a few upcoming weeks to average that projection over, for a steadier
   * "current strength" read than any single week (e.g. a bye week) would give */
  upcomingWeeks: number[];
  /** raw KTC value bundle by Sleeper id, from /api/fetchAllPlayerValues */
  playerValuesBySleeperId: Record<string, RawPlayerValue>;
}

/** what fraction of the league this value is at least as good as, 0-100 */
function percentileRank(values: number[], value: number): number {
  if (values.length <= 1) return 100;
  const atOrBelow = values.filter((v) => v <= value).length - 1; // exclude self once
  return Math.round((atOrBelow / (values.length - 1)) * 100);
}

function tierForRankPercentile(
  percentileFromTop: number,
  isDynasty: boolean
): PowerRankingTier {
  if (percentileFromTop <= 0.25) return "Contender";
  if (percentileFromTop <= 0.5) return "Playoff Contender";
  if (percentileFromTop <= 0.75) return "Middle of the Pack";
  return isDynasty ? "Rebuild" : "No Chance";
}

export function computePowerRankings(
  input: ComputePowerRankingsInput
): PowerRankingResult[] {
  const {
    teams,
    leagueSettings,
    getWeeklyStarterProjection,
    upcomingWeeks,
    playerValuesBySleeperId,
  } = input;

  const weeks = upcomingWeeks.length > 0 ? upcomingWeeks : [1];

  const strengthByRoster: Record<number, number> = {};
  const winPctByRoster: Record<number, number> = {};
  const assetValueByRoster: Record<number, number> = {};

  for (const team of teams) {
    const projections = weeks.map((week) =>
      getWeeklyStarterProjection(team.starterSleeperIds, week)
    );
    strengthByRoster[team.rosterId] =
      projections.reduce((sum, p) => sum + p, 0) / projections.length;

    const games = team.wins + team.losses;
    winPctByRoster[team.rosterId] = games > 0 ? team.wins / games : 0.5;

    if (leagueSettings.isDynasty) {
      let assetValue = 0;
      for (const sleeperId of team.rosterSleeperIds) {
        const raw = playerValuesBySleeperId[sleeperId];
        if (raw) assetValue += computeAdjustedValue(raw, leagueSettings);
      }
      assetValueByRoster[team.rosterId] = assetValue;
    }
  }

  const strengthValues = Object.values(strengthByRoster);
  const winPctValues = Object.values(winPctByRoster);
  const assetValues = Object.values(assetValueByRoster);

  const results: PowerRankingResult[] = teams.map((team) => {
    const strengthScore = percentileRank(
      strengthValues,
      strengthByRoster[team.rosterId]
    );
    const recordScore = percentileRank(
      winPctValues,
      winPctByRoster[team.rosterId]
    );
    const assetScore = leagueSettings.isDynasty
      ? percentileRank(assetValues, assetValueByRoster[team.rosterId])
      : null;

    const powerScore = leagueSettings.isDynasty
      ? Math.round(
          strengthScore * 0.5 + recordScore * 0.3 + (assetScore ?? 0) * 0.2
        )
      : Math.round(strengthScore * 0.65 + recordScore * 0.35);

    return {
      rosterId: team.rosterId,
      userId: team.userId,
      rank: 0,
      starterRank: 0,
      tier: "Middle of the Pack",
      powerScore,
      strengthScore,
      recordScore,
      assetScore,
    };
  });

  results.sort((a, b) => b.powerScore - a.powerScore);

  const n = results.length;
  results.forEach((result, index) => {
    result.rank = index + 1;
    const percentileFromTop = n <= 1 ? 0 : index / (n - 1); // 0 = best, 1 = worst
    result.tier = tierForRankPercentile(
      percentileFromTop,
      leagueSettings.isDynasty
    );
  });

  // starter rank: independent ordering by this-season starting lineup
  // strength alone, so a team can be e.g. "Overall #2, Starters #6" if
  // their record/assets are carrying them more than their current lineup
  [...results]
    .sort((a, b) => b.strengthScore - a.strengthScore)
    .forEach((result, index) => {
      result.starterRank = index + 1;
    });

  return results;
}
