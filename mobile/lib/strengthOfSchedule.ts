// Real fantasy strength of schedule - not "which NFL defenses do your
// players face," the actual fantasy question: for every week you have
// left, how good is the MANAGER you're lined up against? A team playing a
// string of rebuilding rosters the rest of the way has it easy regardless
// of how tough their opponents' real NFL matchups are; a team running into
// the league's best lineups every week does not.
//
// Built entirely on top of lib/leagueSimData.ts's already-fetched
// league-wide data (real per-team weekly projections, real matchup
// pairings including future weeks, since Sleeper generates the whole
// season's schedule upfront) - no new fetch pipeline, same trusted inputs
// Power Rankings, the Trade Calculator, and Standings' own What-If already
// use. matchupData[week][userId] is getMatchupData.ts's own ScheduleData
// shape, so wins/losses/streak/starters_full_data/bench_full_data (with
// real per-player points) all come along for free - the analytics below
// are read straight off it, not invented.

import { percentileRank } from "./powerRankings";
import type { LeagueSimData } from "./leagueSimData";

export type SOSTier = "Brutal" | "Tough" | "Balanced" | "Favorable" | "Cakewalk";

export const TIER_FOR_SCORE = (score: number): SOSTier => {
  if (score >= 80) return "Brutal";
  if (score >= 60) return "Tough";
  if (score >= 40) return "Balanced";
  if (score >= 20) return "Favorable";
  return "Cakewalk";
};

export interface PlayerCard {
  id: string;
  name: string;
  pos?: string;
  team?: string;
  avatar?: string;
  /** real season-to-date average actual points, off weeks this player actually posted a score */
  avgPoints: number;
}

export interface TeamAnalytics {
  wins: number;
  losses: number;
  /** Sleeper's own roster.metadata.streak, e.g. "2W" or "1L" */
  streak: string;
  /** real season-to-date average actual points per game */
  avgPoints: number;
  /** top scorers on the roster this season, by real average points - starters and bench both, so an injured stud still surfaces */
  bestPlayers: PlayerCard[];
}

export interface WeeklyOpponent extends TeamAnalytics {
  week: number;
  opponentUserId: string;
  opponentName: string;
  opponentAvatar?: string;
  /** 0-100 percentile - how strong this opponent's roster is league-wide, right now */
  strength: number;
}

export interface TeamSOS extends TeamAnalytics {
  userId: string;
  name: string;
  avatar?: string;
  /** every remaining week's opponent, in order */
  remaining: WeeklyOpponent[];
  /** average opponent strength across every remaining week - the headline number, 0-100, higher = harder */
  sosScore: number;
  tier: SOSTier;
  toughest?: WeeklyOpponent;
  easiest?: WeeklyOpponent;
  /** the worst any-3-consecutive-week stretch left on this team's schedule */
  gauntlet?: { startWeek: number; endWeek: number; avgStrength: number };
}

/** every team's own current real strength (blends actual season-to-date scoring with rest-of-season projection, same shape as the redraft team-needs blend) - percentile-ranked 0-100, the number every opponent gets judged by below. */
function computeTeamStrength(sim: LeagueSimData, currentWeek: number): Record<string, number> {
  const rawByTeam: Record<string, number> = {};

  for (const userId of sim.teamIds) {
    const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
    const remainingWeeks = sim.weekNumbers.filter((w) => w >= currentWeek);

    let actualTotal = 0;
    let actualCount = 0;
    for (const w of playedWeeks) {
      const pts = parseFloat(sim.matchupData[w]?.[userId]?.team_points || "0");
      if (pts > 0) {
        actualTotal += pts;
        actualCount += 1;
      }
    }

    let projTotal = 0;
    let projCount = 0;
    for (const w of remainingWeeks) {
      const p = sim.projectionCache[w]?.[userId];
      if (p !== undefined) {
        projTotal += p;
        projCount += 1;
      }
    }

    const actualAvg = actualCount > 0 ? actualTotal / actualCount : undefined;
    const projAvg = projCount > 0 ? projTotal / projCount : undefined;

    rawByTeam[userId] =
      actualAvg !== undefined && projAvg !== undefined
        ? actualAvg * 0.5 + projAvg * 0.5
        : actualAvg ?? projAvg ?? 0;
  }

  const values = Object.values(rawByTeam);
  const strength: Record<string, number> = {};
  for (const userId in rawByTeam) strength[userId] = percentileRank(values, rawByTeam[userId]);
  return strength;
}

/** real season-to-date average ACTUAL points for display (unlike computeTeamStrength above, no projection blended in - this is the literal "points they're averaging" number). */
function computeAvgPoints(sim: LeagueSimData, userId: string, currentWeek: number): number {
  const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
  let total = 0;
  let count = 0;
  for (const w of playedWeeks) {
    const pts = parseFloat(sim.matchupData[w]?.[userId]?.team_points || "0");
    if (pts > 0) {
      total += pts;
      count += 1;
    }
  }
  return count > 0 ? Math.round((total / count) * 10) / 10 : 0;
}

/** top real scorers on a roster this season - averaged off every played week's actual player_points, starters and bench alike (so a stud who got hurt and benched still shows up as this team's best player). */
function computeBestPlayers(sim: LeagueSimData, userId: string, currentWeek: number): PlayerCard[] {
  const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
  const totals: Record<string, { name: string; pos?: string; team?: string; avatar?: string; total: number; count: number }> = {};

  for (const w of playedWeeks) {
    const teamWeek = sim.matchupData[w]?.[userId];
    if (!teamWeek) continue;
    const cards = [...(teamWeek.starters_full_data || []), ...(teamWeek.bench_full_data || [])];
    for (const c of cards) {
      if (!c?.id) continue;
      const pts = parseFloat(c.points || "0");
      if (!totals[c.id]) {
        const name = `${c.fn ?? ""} ${c.ln ?? ""}`.trim() || c.id;
        totals[c.id] = { name, pos: c.pos, team: c.team, avatar: c.avatar, total: 0, count: 0 };
      }
      totals[c.id].total += pts;
      totals[c.id].count += 1;
    }
  }

  return Object.entries(totals)
    .map(([id, t]) => ({
      id,
      name: t.name,
      pos: t.pos,
      team: t.team,
      avatar: t.avatar,
      avgPoints: t.count > 0 ? Math.round((t.total / t.count) * 10) / 10 : 0,
    }))
    .filter((p) => p.avgPoints > 0)
    .sort((a, b) => b.avgPoints - a.avgPoints)
    .slice(0, 4);
}

function computeTeamAnalytics(sim: LeagueSimData, currentWeek: number): Record<string, TeamAnalytics> {
  // Sleeper's wins/losses/streak come off the roster's live settings/metadata,
  // not any particular week - any week's fetch carries the same current
  // values, so the earliest one on hand is as good as any.
  const anyWeek = sim.weekNumbers[0];
  const analytics: Record<string, TeamAnalytics> = {};
  for (const userId of sim.teamIds) {
    const info = sim.managerInfo[userId];
    const weekRow = sim.matchupData[anyWeek]?.[userId];
    analytics[userId] = {
      wins: parseInt(info?.wins as any, 10) || 0,
      losses: parseInt(info?.losses as any, 10) || 0,
      streak: weekRow?.streak && weekRow.streak !== "N/A" ? weekRow.streak : "-",
      avgPoints: computeAvgPoints(sim, userId, currentWeek),
      bestPlayers: computeBestPlayers(sim, userId, currentWeek),
    };
  }
  return analytics;
}

/** who a team actually plays a given week - the two sides sharing a real matchup_id, Sleeper's own already-generated pairing for that week (future weeks included). Exported so other Boogie storylines (rematch alerts, bench-regret recaps) can look up the same real pairing without duplicating this lookup. */
export function findOpponent(sim: LeagueSimData, week: number, userId: string): string | null {
  const mine = sim.matchupData[week]?.[userId];
  if (!mine?.matchup_id) return null;
  for (const otherId of sim.teamIds) {
    if (otherId === userId) continue;
    const other = sim.matchupData[week]?.[otherId];
    if (other?.matchup_id === mine.matchup_id) return otherId;
  }
  return null;
}

export function computeStrengthOfSchedule(sim: LeagueSimData, currentWeek: number): TeamSOS[] {
  const strength = computeTeamStrength(sim, currentWeek);
  const analytics = computeTeamAnalytics(sim, currentWeek);
  const remainingWeeks = sim.weekNumbers.filter((w) => w >= currentWeek);

  const results: TeamSOS[] = sim.teamIds.map((userId) => {
    const info = sim.managerInfo[userId];
    const remaining: WeeklyOpponent[] = [];

    for (const week of remainingWeeks) {
      const oppId = findOpponent(sim, week, userId);
      if (!oppId) continue;
      const oppInfo = sim.managerInfo[oppId];
      const oppAnalytics = analytics[oppId];
      remaining.push({
        week,
        opponentUserId: oppId,
        opponentName: oppInfo?.name ?? "Unknown",
        opponentAvatar: oppInfo?.avatar,
        strength: strength[oppId] ?? 0,
        ...oppAnalytics,
      });
    }

    const sosScore =
      remaining.length > 0 ? Math.round(remaining.reduce((s, r) => s + r.strength, 0) / remaining.length) : 0;

    let toughest: WeeklyOpponent | undefined;
    let easiest: WeeklyOpponent | undefined;
    for (const r of remaining) {
      if (!toughest || r.strength > toughest.strength) toughest = r;
      if (!easiest || r.strength < easiest.strength) easiest = r;
    }

    // Worst 3-consecutive-week window, if there are at least 3 games left.
    let gauntlet: TeamSOS["gauntlet"];
    for (let i = 0; i + 3 <= remaining.length; i++) {
      const window = remaining.slice(i, i + 3);
      const avg = window.reduce((s, r) => s + r.strength, 0) / 3;
      if (!gauntlet || avg > gauntlet.avgStrength) {
        gauntlet = { startWeek: window[0].week, endWeek: window[2].week, avgStrength: Math.round(avg) };
      }
    }

    return {
      userId,
      name: info?.name ?? "Unknown Team",
      avatar: info?.avatar,
      remaining,
      sosScore,
      tier: TIER_FOR_SCORE(sosScore),
      toughest,
      easiest,
      gauntlet,
      ...analytics[userId],
    };
  });

  return results.sort((a, b) => b.sosScore - a.sosScore);
}
