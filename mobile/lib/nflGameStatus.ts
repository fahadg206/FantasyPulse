// A fantasy matchup's live/final state, driven by each starter's real NFL
// game status instead of the old heuristic of "does this player show 0
// points yet" - that heuristic is wrong on its own terms: a player can
// legitimately finish a game with 0 fantasy points (a backup who never
// touched the ball, a defense that allowed points, a bye), which the old
// check couldn't tell apart from "hasn't played yet".
//
// Rule: a fantasy team is only "final" once every starter with a real NFL
// team is in a completed game, or its lineup isn't even fully set (an
// empty slot never resolves to "finished"). A matchup is "live" whenever
// either side isn't final yet but at least one side has games underway or
// concluded; "pre" only when nothing on either side has kicked off. Monday
// Night Football ending at 10pm Pacific is a hard final-cutoff safety net
// on top of all that, for whatever this logic doesn't otherwise catch
// (a DST score that never reconciles, a bye-week player, etc.).

export type NflTeamGameState = "pre" | "in" | "post";
export type MatchupGameState = "pre" | "live" | "final";

// Sleeper and ESPN don't always agree on team abbreviations - verified
// against both providers' live data before shipping this: Washington is
// "WAS" in Sleeper's player data (which is what starterTeams below is built
// from) but "WSH" in ESPN's scoreboard. Every other team matched exactly.
const ESPN_TO_SLEEPER_ABBREVIATION: Record<string, string> = {
  WSH: "WAS",
};

export async function getNflGameStatusByTeam(
  week: number,
  season: string | number
): Promise<Record<string, NflTeamGameState>> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${season}`
  );
  if (!res.ok) throw new Error(`ESPN scoreboard request failed: ${res.status}`);
  const data = await res.json();

  const map: Record<string, NflTeamGameState> = {};
  for (const event of data.events || []) {
    const comp = event.competitions?.[0];
    const state = comp?.status?.type?.state as NflTeamGameState | undefined;
    if (!state) continue;
    for (const competitor of comp?.competitors || []) {
      const abbr = competitor?.team?.abbreviation;
      if (!abbr) continue;
      map[abbr] = state;
      // also store under the Sleeper-convention abbreviation, if different,
      // so a lookup by either provider's naming resolves correctly
      const sleeperAbbr = ESPN_TO_SLEEPER_ABBREVIATION[abbr];
      if (sleeperAbbr) map[sleeperAbbr] = state;
    }
  }
  return map;
}

/**
 * One fantasy team's game state from its starters' real NFL teams:
 * - "pre" when none of its starters' games have kicked off (or it has no
 *   real starters to check, e.g. lineup not set)
 * - "post" only when every starter with a real NFL team is in a completed
 *   game AND the lineup has no empty slots
 * - "in" (live) otherwise
 */
export function computeFantasyTeamGameState(
  starterTeams: (string | undefined | null)[],
  statusByTeam: Record<string, NflTeamGameState>,
  rosterIsFullySet: boolean = true
): NflTeamGameState {
  const relevant = starterTeams.filter(
    (t): t is string => !!t && statusByTeam[t] !== undefined
  );
  if (relevant.length === 0) return "pre";

  const allFinal = rosterIsFullySet && relevant.every((t) => statusByTeam[t] === "post");
  if (allFinal) return "post";

  const anyStarted = relevant.some((t) => statusByTeam[t] !== "pre");
  return anyStarted ? "in" : "pre";
}

/** true once it's past Monday Night Football's hard cutoff, 10:00pm Pacific */
export function isPastMondayNightCutoff(now: Date = new Date()): boolean {
  const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  if (pacific.getDay() !== 1) return false; // only applies on Monday itself
  return pacific.getHours() >= 22;
}

export function combineMatchupGameState(
  team1: NflTeamGameState,
  team2: NflTeamGameState,
  pastMondayNightCutoff: boolean
): MatchupGameState {
  if (pastMondayNightCutoff) return "final";
  if (team1 === "post" && team2 === "post") return "final";
  if (team1 === "pre" && team2 === "pre") return "pre";
  return "live";
}
