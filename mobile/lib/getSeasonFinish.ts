// A real per-team, per-season finish - "how did this team actually do that
// year" - for showing next to a historical matchup (Rivalry, League
// History). Reuses getPlayoffBracket.ts's own real bracket resolution
// rather than a second implementation: the same real winners_bracket data
// that already renders the bracket UI already answers "did this roster
// win it all / make the final / finish 3rd / make the playoffs at all."

import { getPlayoffBracket } from "./getPlayoffBracket";

export type SeasonFinish = "Champion" | "Runner-Up" | "3rd Place" | "Made Playoffs" | "Missed Playoffs";

/** every real roster_id's finish for one season's league, resolved once from that season's real bracket. */
export async function getSeasonFinishes(leagueId: string): Promise<Record<number, SeasonFinish>> {
  const bracket = await getPlayoffBracket(leagueId).catch(() => null);
  if (!bracket) return {};

  const allMatches = bracket.rounds.flat();
  const finishes: Record<number, SeasonFinish> = {};

  const championGame = allMatches.find((m) => m.placement === 1);
  if (championGame?.winnerRosterId !== undefined) {
    finishes[championGame.winnerRosterId] = "Champion";
    const runnerUp = championGame.teams.find((t) => t?.rosterId !== undefined && t.rosterId !== championGame.winnerRosterId);
    if (runnerUp?.rosterId !== undefined) finishes[runnerUp.rosterId] = "Runner-Up";
  }

  const thirdPlaceGame = allMatches.find((m) => m.placement === 3);
  if (thirdPlaceGame?.winnerRosterId !== undefined) {
    finishes[thirdPlaceGame.winnerRosterId] = "3rd Place";
  }

  for (const match of allMatches) {
    for (const team of match.teams) {
      if (team?.rosterId === undefined) continue;
      if (!finishes[team.rosterId]) finishes[team.rosterId] = "Made Playoffs";
    }
  }

  return finishes;
}

/** one roster's real finish for a specific season - convenience wrapper around getSeasonFinishes for a single lookup (e.g. a Rivalry slate showing just the two teams involved). */
export async function getTeamSeasonFinish(leagueId: string, rosterId: number): Promise<SeasonFinish | null> {
  const finishes = await getSeasonFinishes(leagueId);
  return finishes[rosterId] ?? (Object.keys(finishes).length > 0 ? "Missed Playoffs" : null);
}
