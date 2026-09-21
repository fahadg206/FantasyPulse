import { sleeper } from "./api";
import type { Starter } from "./getMatchupData";

export interface TopPerformer {
  playerId: string;
  name: string;
  team?: string;
  pos?: string;
  avatar?: string;
  ppg: number;
  isProjected: boolean;
}

// Accepts either a resolved Starter (`.team`) or a raw players-payload entry
// (`.t`), since both shapes show up at name-rendering call sites.
export function displayName(s: { fn?: string; ln?: string; team?: string; t?: string }): string {
  if (s.fn && s.ln) return `${s.fn.charAt(0)}. ${s.ln}`;
  const team = s.team ?? s.t;
  if (team) return `${team} D/ST`;
  return "Unknown";
}

function toPerformer(s: Starter, ppg: number, isProjected: boolean): TopPerformer {
  return {
    playerId: s.id ?? "",
    name: displayName(s),
    team: s.team,
    pos: s.pos,
    avatar: s.avatar,
    ppg,
    isProjected,
  };
}

export type SeasonTotals = Record<string, Record<string, { sum: number; games: number }>>;

// One fetch per completed week for the whole league (every roster's points
// come back in a single response), rather than per-team - so this can be
// called once and reused for every matchup on the Schedule screen, or for
// both sides of one matchup on the detail page.
export async function getSeasonTotals(leagueId: string, throughWeek: number): Promise<SeasonTotals> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  if (weeks.length === 0) return {};

  const weekResponses = await Promise.all(weeks.map((w) => sleeper.getMatchups(leagueId, w)));
  const totals: SeasonTotals = {};

  for (const res of weekResponses) {
    for (const teamEntry of res.data as any[]) {
      const rosterId = String(teamEntry.roster_id);
      if (!totals[rosterId]) totals[rosterId] = {};
      const pointsMap = teamEntry.players_points ?? {};
      for (const playerId in pointsMap) {
        const pts = pointsMap[playerId];
        if (pts === undefined || pts === null) continue;
        if (!totals[rosterId][playerId]) totals[rosterId][playerId] = { sum: 0, games: 0 };
        totals[rosterId][playerId].sum += pts;
        if (pts > 0) totals[rosterId][playerId].games += 1;
      }
    }
  }
  return totals;
}

function topNFromTotals(
  totals: SeasonTotals[string] | undefined,
  starters: Starter[],
  n: number
): TopPerformer[] {
  if (!totals) return [];
  const scored: TopPerformer[] = [];
  for (const s of starters) {
    if (!s.id) continue;
    const t = totals[s.id];
    if (!t || t.games === 0) continue;
    scored.push(toPerformer(s, t.sum / t.games, false));
  }
  return scored.sort((a, b) => b.ppg - a.ppg).slice(0, n);
}

// No completed weeks yet (e.g. Week 1 pregame) - fall back to each
// starter's average projection over the next up to 3 weeks, using the
// players payload already fetched by getMatchupData (no extra network call).
function topNFromProjections(starters: Starter[], playersData: any, currentWeek: number, n: number): TopPerformer[] {
  const weeks = [currentWeek, currentWeek + 1, currentWeek + 2];
  const scored: TopPerformer[] = [];

  for (const s of starters) {
    if (!s.id) continue;
    const rawProjections: any[] = weeks.map((w) => playersData?.[s.id!]?.wi?.[w.toString()]?.p);
    const projections = rawProjections.filter((p) => p !== undefined).map((p) => parseFloat(p));
    if (projections.length === 0) continue;
    const ppg = projections.reduce((a, b) => a + b, 0) / projections.length;
    scored.push(toPerformer(s, ppg, true));
  }
  return scored.sort((a, b) => b.ppg - a.ppg).slice(0, n);
}

// Top N performers for one team, given season totals already fetched via
// getSeasonTotals (or falling back to projections if there's no history yet).
export function getTopNForTeam(
  totals: SeasonTotals,
  rosterId: string,
  starters: Starter[],
  playersData: any,
  currentWeek: number,
  n: number
): TopPerformer[] {
  const realStarters = starters.filter((s) => s.id);
  const historical = topNFromTotals(totals[rosterId], realStarters, n);
  if (historical.length > 0) return historical;
  return topNFromProjections(realStarters, playersData, currentWeek, n);
}

// Convenience wrapper for a single matchup: fetches season totals once and
// returns each side's top N in one call.
export async function getTopPerformers(
  leagueId: string,
  team1RosterId: string,
  team1Starters: Starter[],
  team2RosterId: string,
  team2Starters: Starter[],
  throughWeek: number,
  playersData: any,
  currentWeek: number,
  n = 1
): Promise<{ team1: TopPerformer[]; team2: TopPerformer[] }> {
  const totals = await getSeasonTotals(leagueId, throughWeek);
  return {
    team1: getTopNForTeam(totals, team1RosterId, team1Starters, playersData, currentWeek, n),
    team2: getTopNForTeam(totals, team2RosterId, team2Starters, playersData, currentWeek, n),
  };
}
