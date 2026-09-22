// Real per-player box score lines (20/31 CMP, 248 YD, 3 TD - style), sourced
// from Sleeper's own public weekly stats feed - the same live-updating raw
// counting-stat data Sleeper's own app polls, keyed by Sleeper player_id
// (no name-matching against a different provider needed). This is
// deliberately a different source from the fantasy points already shown
// elsewhere (Starter.points, computed by the league's own scoring
// settings from Sleeper's matchup response) - this one is just the raw
// counting stats for display, not used for scoring math.

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
