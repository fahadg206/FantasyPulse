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
//
// off_snp/tm_off_snp (for SNP%) and pos_rank_ppr/pos_rank_half_ppr/
// pos_rank_std (for RANK) are real fields Sleeper's own weekly stats feed
// already publishes - confirmed live (Jared Allen^H^H Jared Goff, Week 2
// 2025: off_snp 56, tm_off_snp 59, pos_rank_half_ppr 1) - not something
// this file computes itself, the same numbers Sleeper's own app shows.

import { cachedFetch } from "./requestCache";
import { getLiveGameDetailsByTeam } from "./nflGameStatus";

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
  off_snp?: number;
  tm_off_snp?: number;
  pos_rank_ppr?: number;
  pos_rank_half_ppr?: number;
  pos_rank_std?: number;
  gp?: number;
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
  stats: RawPlayerStats;
  /** e.g. "@BUF" or "NYJ" - real ESPN scoreboard data, same source Schedule's live game status already uses */
  opponent?: string;
  /** real snap-participation percentage this game, off_snp/tm_off_snp - undefined when the feed hasn't published snap counts for this game yet */
  snapPct?: number;
  /** real positional rank that week (PPR) - the same number Sleeper's own app shows, not something derived here */
  posRank?: number;
}

/** one player's real game-by-game fantasy production, played weeks only (a bye or a week they didn't play returns no entry for it, not a phantom 0) - the season's real scoring_settings applied to Sleeper's own raw weekly stats feed, cached per (season, week) since a past week's stats are immutable. */
export async function getPlayerGameLog(
  playerId: string,
  pos: string | undefined,
  team: string | undefined,
  season: string | number,
  throughWeek: number,
  scoringSettings: Record<string, number>
): Promise<GameLogEntry[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek - 1) }, (_, i) => i + 1);
  const [weekStats, weekOpponents] = await Promise.all([
    Promise.all(
      weeks.map((week) =>
        cachedFetch(`weeklyPlayerStats:${season}:${week}`, WEEKLY_STATS_TTL_MS, () => getWeeklyPlayerStats(season, week)).catch(
          () => ({}) as Record<string, RawPlayerStats>
        )
      )
    ),
    Promise.all(
      weeks.map((week) =>
        cachedFetch(`nflOpponents:${season}:${week}`, WEEKLY_STATS_TTL_MS, () => getLiveGameDetailsByTeam(week, season)).catch(
          () => ({}) as Awaited<ReturnType<typeof getLiveGameDetailsByTeam>>
        )
      )
    ),
  ]);

  const log: GameLogEntry[] = [];
  weeks.forEach((week, i) => {
    const stats = weekStats[i][playerId];
    if (!stats) return; // didn't play (bye, not yet in the league, DNP)
    const points = computeFantasyPoints(stats, scoringSettings);
    if (points === 0 && Object.keys(stats).length === 0) return;

    const gameDetail = team ? weekOpponents[i]?.[team] : undefined;
    const snapPct = stats.off_snp !== undefined && stats.tm_off_snp ? Math.round((stats.off_snp / stats.tm_off_snp) * 100) : undefined;
    const posRank = stats.pos_rank_half_ppr ?? stats.pos_rank_ppr ?? stats.pos_rank_std;

    log.push({
      week,
      points: Math.round(points * 100) / 100,
      boxScoreLine: formatBoxScoreLine(pos, stats),
      stats,
      opponent: gameDetail ? `${gameDetail.isHome ? "" : "@"}${gameDetail.opponentAbbr ?? ""}` : undefined,
      snapPct,
      posRank,
    });
  });

  return log.reverse(); // most recent week first
}

export interface SeasonTotals {
  season: string;
  games: number;
  totalPoints: number;
  ppg: number;
}

const SEASON_TOTALS_TTL_MS = 6 * 60 * 60 * 1000;

/** one real past season's totals for this player, under the given (current) league's scoring settings - a reasonable, standard simplification real dynasty tools also make (a league's scoring rarely changes season to season), not a claim that this league literally existed with these exact settings back then. */
async function getSeasonTotals(playerId: string, season: string, scoringSettings: Record<string, number>): Promise<SeasonTotals | null> {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const weekStats = await Promise.all(
    weeks.map((week) =>
      cachedFetch(`weeklyPlayerStats:${season}:${week}`, SEASON_TOTALS_TTL_MS, () => getWeeklyPlayerStats(season, week)).catch(
        () => ({}) as Record<string, RawPlayerStats>
      )
    )
  );

  let games = 0;
  let total = 0;
  for (const stats of weekStats) {
    const line = stats[playerId];
    if (!line || Object.keys(line).length === 0) continue;
    games += 1;
    total += computeFantasyPoints(line, scoringSettings);
  }
  if (games === 0) return null;
  return { season, games, totalPoints: Math.round(total * 100) / 100, ppg: Math.round((total / games) * 100) / 100 };
}

/** real season-by-season career totals, most recent season first - one real NFL season at a time, each cached, so re-opening this player's History tab later doesn't re-pull anything already fetched. */
export async function getPlayerCareerStats(
  playerId: string,
  currentSeason: string,
  scoringSettings: Record<string, number>,
  seasonsBack = 5
): Promise<SeasonTotals[]> {
  const startYear = parseInt(currentSeason, 10);
  if (Number.isNaN(startYear)) return [];
  const seasons = Array.from({ length: seasonsBack }, (_, i) => String(startYear - i));

  const results = await Promise.all(seasons.map((season) => getSeasonTotals(playerId, season, scoringSettings).catch(() => null)));
  return results.filter((r): r is SeasonTotals => r !== null);
}
