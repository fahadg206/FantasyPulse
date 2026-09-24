// Real per-player box score lines (20/31 CMP, 248 YD, 3 TD - style), sourced
// from Sleeper's own public weekly stats feed - the same live-updating raw
// counting-stat data Sleeper's own app polls, keyed by Sleeper player_id
// (no name-matching against a different provider needed). This is
// deliberately a different source from the fantasy points already shown
// elsewhere (Starter.points, computed by the league's own scoring
// settings from Sleeper's matchup response) - this one is just the raw
// counting stats for display, not used for scoring math.
//
// getPlayerGameLog below DOES turn these into real fantasy points, for the
// player detail card's game log - not by re-deriving them from a roster's
// matchup data (which only exists for weeks that player was actually
// rostered somewhere in this league), but by dotting the raw stat line
// against the league's own scoring_settings directly. Verified live
// against real Week 2 data: reproduces Sleeper's own reported
// players_points to within rounding on every sample checked.

import { cachedFetch } from "./requestCache";

export interface RawPlayerStats {
  pass_cmp?: number;
  pass_att?: number;
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  rush_att?: number;
  rush_yd?: number;
  rush_td?: number;
  rec?: number;
  rec_tgt?: number;
  rec_yd?: number;
  rec_td?: number;
  fum_lost?: number;
  [stat: string]: number | undefined;
}

export async function getWeeklyPlayerStats(
  season: string | number,
  week: number
): Promise<Record<string, RawPlayerStats>> {
  const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`);
  if (!res.ok) throw new Error(`Sleeper weekly stats request failed: ${res.status}`);
  return res.json();
}

/** the position-appropriate "20/31 CMP, 248 YD, 3 TD" line - null when there's nothing to show yet (game hasn't started, or this position doesn't get a box score line at all) */
export function formatBoxScoreLine(pos: string | undefined, stats: RawPlayerStats | undefined): string | null {
  if (!stats || pos === "DEF" || pos === "K") return null;

  const parts: string[] = [];

  if (stats.pass_att) {
    let seg = `${stats.pass_cmp ?? 0}/${stats.pass_att} CMP, ${stats.pass_yd ?? 0} YD`;
    if (stats.pass_td) seg += `, ${stats.pass_td} TD`;
    if (stats.pass_int) seg += `, ${stats.pass_int} INT`;
    parts.push(seg);
  }
  if (stats.rush_att) {
    let seg = `${stats.rush_att} CAR, ${stats.rush_yd ?? 0} YD`;
    if (stats.rush_td) seg += `, ${stats.rush_td} TD`;
    parts.push(seg);
  }
  if (stats.rec_tgt || stats.rec) {
    let seg = `${stats.rec ?? 0}/${stats.rec_tgt ?? stats.rec ?? 0} REC, ${stats.rec_yd ?? 0} YD`;
    if (stats.rec_td) seg += `, ${stats.rec_td} TD`;
    parts.push(seg);
  }
  if (stats.fum_lost) parts.push(`${stats.fum_lost} FUM LOST`);

  return parts.length > 0 ? parts.join(", ") : null;
}

/** the real fantasy points a raw stat line is worth under one league's own scoring settings - a dot product, since Sleeper's raw stat keys (pass_yd, rec_td, ...) are the same keys scoring_settings prices per unit. Works for any player in any week regardless of whether they were actually rostered in this league that week. */
export function computeFantasyPoints(stats: RawPlayerStats | undefined, scoringSettings: Record<string, number>): number {
  if (!stats) return 0;
  let total = 0;
  for (const key in stats) {
    const value = stats[key];
    const multiplier = scoringSettings[key];
    if (typeof value === "number" && typeof multiplier === "number") total += value * multiplier;
  }
  return total;
}

const WEEKLY_STATS_TTL_MS = 60 * 60 * 1000; // a past week's stats never change - an hour is just to bound memory, not correctness

export interface GameLogEntry {
  week: number;
  points: number;
  boxScoreLine: string | null;
}

/** one player's real game-by-game fantasy production, played weeks only (a bye or a week they didn't play returns no entry for it, not a phantom 0) - the season's real scoring_settings applied to Sleeper's own raw weekly stats feed, cached per (season, week) since a past week's stats are immutable. */
export async function getPlayerGameLog(
  playerId: string,
  pos: string | undefined,
  season: string | number,
  throughWeek: number,
  scoringSettings: Record<string, number>
): Promise<GameLogEntry[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek - 1) }, (_, i) => i + 1);
  const weekStats = await Promise.all(
    weeks.map((week) =>
      cachedFetch(`weeklyPlayerStats:${season}:${week}`, WEEKLY_STATS_TTL_MS, () => getWeeklyPlayerStats(season, week)).catch(
        () => ({}) as Record<string, RawPlayerStats>
      )
    )
  );

  const log: GameLogEntry[] = [];
  weeks.forEach((week, i) => {
    const stats = weekStats[i][playerId];
    if (!stats) return; // didn't play (bye, not yet in the league, DNP)
    const points = computeFantasyPoints(stats, scoringSettings);
    if (points === 0 && Object.keys(stats).length === 0) return;
    log.push({ week, points: Math.round(points * 100) / 100, boxScoreLine: formatBoxScoreLine(pos, stats) });
  });

  return log.reverse(); // most recent week first
}
