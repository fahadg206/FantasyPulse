import { sleeper } from "./api";

export interface TeamManagersMap {
  [year: string]: {
    [rosterId: string]: {
      team: { avatar: string; name: string };
      managers: string[];
    };
  };
}

export interface RivalUser {
  managerID: string;
  userName: string;
  avatar: string;
}

export interface LeagueManagersResult {
  currentSeason: string;
  teamManagersMap: TeamManagersMap;
  users: Record<string, RivalUser>;
}

function getTeamData(users: Record<string, any>, ownerId: string) {
  const user = users[ownerId];
  if (user) {
    return {
      avatar: user.avatar || "",
      name: user.team_name || user.display_name,
    };
  }
  return { avatar: "", name: "Unknown Team" };
}

function getManagers(roster: any): string[] {
  const managers: string[] = [];
  if (roster.owner_id) managers.push(roster.owner_id);
  if (roster.co_owners) for (const co of roster.co_owners) managers.push(co);
  return managers;
}

// Ports getLeagueTeamManagers() - crawls the league's previous_league_id chain
// to build a per-year roster->manager map and a flat user directory.
export async function fetchLeagueManagers(leagueId: string): Promise<LeagueManagersResult> {
  const teamManagersMap: TeamManagersMap = {};
  const users: Record<string, RivalUser> = {};
  let currentLeagueId: string | null = leagueId;
  let currentSeason = "";

  while (currentLeagueId && currentLeagueId !== "0") {
    const leagueIdForRequest: string = currentLeagueId;
    const usersRes = await sleeper.getLeagueUsers(leagueIdForRequest);
    const rostersRes = await sleeper.getLeagueRosters(leagueIdForRequest);
    const leagueRes = await sleeper.getLeague(leagueIdForRequest);

    const year = leagueRes.data.season;
    if (!currentSeason) currentSeason = year;

    const usersById: Record<string, any> = {};
    for (const u of usersRes.data) {
      usersById[u.user_id] = u;
      if (!users[u.user_id]) {
        users[u.user_id] = {
          managerID: u.user_id,
          userName: u.display_name,
          avatar: u.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : "",
        };
      }
    }

    teamManagersMap[year] = {};
    for (const roster of rostersRes.data) {
      teamManagersMap[year][roster.roster_id] = {
        team: getTeamData(usersById, roster.owner_id),
        managers: getManagers(roster),
      };
    }

    currentLeagueId = leagueRes.data.previous_league_id;
  }

  return { currentSeason, teamManagersMap, users };
}

function getRosterId(map: TeamManagersMap, managerId: string, year: string): string | null {
  const yearMap = map[year];
  if (!yearMap) return null;
  for (const rosterId in yearMap) {
    if (yearMap[rosterId].managers.includes(managerId)) return rosterId;
  }
  return null;
}

export interface RivalryMatchup {
  week: number;
  year: string;
  matchup: { roster_id: string; starters: string[]; points: number[] }[];
  isPlayoff: boolean;
}

export interface Rivalry {
  points: { one: number; two: number };
  wins: { one: number; two: number };
  ties: number;
  // Same shape, but tallied only from games played in a playoff week
  // (week >= that season's playoff_week_start) - tracked separately since
  // a playoff meeting is a much rarer, higher-stakes event than a regular
  // season one and managers want to see it called out on its own.
  playoffPoints: { one: number; two: number };
  playoffWins: { one: number; two: number };
  playoffTies: number;
  matchups: RivalryMatchup[];
}

function processRivalryMatchups(
  inputMatchups: any[],
  week: number,
  rosterIdOne: string,
  rosterIdTwo: string
): { matchup: RivalryMatchup["matchup"]; week: number } | undefined {
  if (!inputMatchups || inputMatchups.length === 0) return undefined;

  const byMatchupId: Record<string, RivalryMatchup["matchup"]> = {};
  for (const m of inputMatchups) {
    const rosterId = String(m.roster_id);
    if (rosterId === rosterIdOne || rosterId === rosterIdTwo) {
      if (!byMatchupId[m.matchup_id]) byMatchupId[m.matchup_id] = [];
      byMatchupId[m.matchup_id].push({
        roster_id: rosterId,
        starters: m.starters,
        points: m.starters_points,
      });
    }
  }

  const keys = Object.keys(byMatchupId);
  const matchup = byMatchupId[keys[0]];
  if (keys.length > 1 || !matchup || matchup.length === 1) return undefined;

  if (matchup[0].roster_id === rosterIdTwo) {
    const [a, b] = matchup;
    matchup[0] = b;
    matchup[1] = a;
  }
  return { matchup, week };
}

// Ports getRivalryMatchups() - crawls league history computing aggregate
// wins/points and per-week matchup detail between two managers.
/**
 * Which (rosterA, rosterB) pairings are REAL winners-bracket games, by
 * round - resolved from Sleeper's own bracket structure (t1/t2, or
 * t1_from/t2_from chaining to an earlier match's winner or loser, the same
 * chain getPlayoffBracket.ts walks to render the bracket UI) rather than
 * just "both teams happened to play during a playoff week."
 *
 * This is what actually distinguishes a real playoff meeting from a
 * losers-bracket/toilet-bowl one: Sleeper runs those as a genuinely
 * separate schedule during the same weeks for teams that didn't make (or
 * were eliminated from) the real bracket, and the only way to tell them
 * apart is checking whether this exact pairing, this exact round, is one
 * the winners_bracket structure actually produces - a `t1_from.l` chain
 * (a 3rd/5th-place-style consolation game between two teams who DID make
 * the real playoffs) still counts; a pairing that never appears anywhere
 * in this structure doesn't, whether that's the toilet bowl or a team
 * that's already been eliminated playing out the string.
 */
async function resolveWinnersBracketPairsByRound(leagueId: string): Promise<Map<number, Set<string>>> {
  const pairsByRound = new Map<number, Set<string>>();
  try {
    const bracket = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/winners_bracket`).then((r) => r.json());
    if (!Array.isArray(bracket) || bracket.length === 0) return pairsByRound;

    const matchById = new Map<number, any>();
    for (const m of bracket) matchById.set(m.m, m);

    const resolveSide = (m: any, side: "t1" | "t2"): number | undefined => {
      if (m[side] !== undefined) return m[side];
      const from = m[`${side}_from`];
      if (!from) return undefined;
      if (from.w !== undefined) return matchById.get(from.w)?.w;
      if (from.l !== undefined) return matchById.get(from.l)?.l;
      return undefined;
    };

    for (const m of bracket) {
      const a = resolveSide(m, "t1");
      const b = resolveSide(m, "t2");
      if (a === undefined || b === undefined) continue;
      const key = [a, b].sort((x, y) => x - y).join("-");
      if (!pairsByRound.has(m.r)) pairsByRound.set(m.r, new Set());
      pairsByRound.get(m.r)!.add(key);
    }
  } catch {
    // Falls through with an empty map - the caller treats that as "bracket
    // data unavailable" and falls back to the plain week-based check
    // rather than silently dropping a season's real playoff history.
  }
  return pairsByRound;
}

export async function fetchRivalry(
  leagueId: string,
  userOneId: string,
  userTwoId: string,
  teamManagersMap: TeamManagersMap
): Promise<Rivalry> {
  const rivalry: Rivalry = {
    points: { one: 0, two: 0 },
    wins: { one: 0, two: 0 },
    ties: 0,
    playoffPoints: { one: 0, two: 0 },
    playoffWins: { one: 0, two: 0 },
    playoffTies: 0,
    matchups: [],
  };
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId && currentLeagueId !== "0") {
    const leagueIdForRequest: string = currentLeagueId;
    const leagueData: any = await sleeper
      .getLeague(leagueIdForRequest)
      .then((res) => res.data)
      .catch(() => null);
    if (!leagueData) break;

    const year = leagueData.season;
    const rosterIdOne = getRosterId(teamManagersMap, userOneId, year);
    const rosterIdTwo = getRosterId(teamManagersMap, userTwoId, year);

    if (!rosterIdOne || !rosterIdTwo || rosterIdOne === rosterIdTwo) {
      currentLeagueId = leagueData.previous_league_id;
      continue;
    }

    const playoffStartWeek: number = leagueData.settings.playoff_week_start;
    // Sleeper's matchups endpoint covers playoff weeks the same way as
    // regular season ones (same matchup_id pairing shape) - a fixed
    // 3-week playoff window past the start week comfortably covers every
    // league's bracket length, and fetching a few extra empty weeks past
    // a shorter season is harmless (processRivalryMatchups just skips them).
    const lastWeek = Math.min(18, playoffStartWeek + 3);
    const [matchupResponses, bracketPairsByRound] = await Promise.all([
      Promise.all(Array.from({ length: lastWeek }, (_, i) => i + 1).map((w) => sleeper.getMatchups(leagueIdForRequest, w))),
      resolveWinnersBracketPairsByRound(leagueIdForRequest),
    ]);
    // Only when the bracket actually resolved - an empty map means the
    // fetch failed or this season has no bracket data at all, and the old
    // plain week-based check is a better fallback than silently dropping
    // every playoff meeting that season ever had.
    const hasBracketData = bracketPairsByRound.size > 0;

    matchupResponses.forEach((res, i) => {
      const week = i + 1;
      const processed = processRivalryMatchups(res.data, week, rosterIdOne, rosterIdTwo);
      if (!processed) return;
      const [sideA, sideB] = processed.matchup;
      const ptsA = sideA.points.reduce((t, v) => t + v, 0);
      const ptsB = sideB.points.reduce((t, v) => t + v, 0);
      // A future/not-yet-played week still shows up as a scheduled matchup
      // with every score at 0 - skip it rather than count it as a 0-0 tie.
      if (ptsA === 0 && ptsB === 0) return;

      const isPlayoff = week >= playoffStartWeek;

      // A playoff-week meeting only counts if it's a REAL winners-bracket
      // game for that round - not a parallel losers-bracket/toilet-bowl
      // pairing, and not two teams still on the schedule after one (or
      // both) of them has already been eliminated. Once bracket data is
      // available and doesn't confirm this pairing, the meeting is
      // dropped entirely - it's not a "regular season" game either.
      if (isPlayoff && hasBracketData) {
        const round = week - playoffStartWeek + 1;
        const key = [parseInt(rosterIdOne, 10), parseInt(rosterIdTwo, 10)].sort((a, b) => a - b).join("-");
        if (!bracketPairsByRound.get(round)?.has(key)) return;
      }

      const target = isPlayoff ? rivalry.playoffPoints : rivalry.points;
      target.one += ptsA;
      target.two += ptsB;
      const winsTarget = isPlayoff ? rivalry.playoffWins : rivalry.wins;
      if (ptsA > ptsB) winsTarget.one++;
      else if (ptsA < ptsB) winsTarget.two++;
      else if (isPlayoff) rivalry.playoffTies++;
      else rivalry.ties++;

      rivalry.matchups.push({ week: processed.week, year, matchup: processed.matchup, isPlayoff });
    });

    currentLeagueId = leagueData.previous_league_id;
  }

  rivalry.matchups.sort((a, b) => parseInt(a.year) - parseInt(b.year) || b.week - a.week);
  return rivalry;
}

export interface RivalryMoment {
  matchup: RivalryMatchup;
  margin: number;
  totalOne: number;
  totalTwo: number;
}

export interface NemesisPlayer {
  playerId: string;
  /** total points this player has put up in games against the OTHER side, across every tracked meeting */
  totalPoints: number;
  games: number;
}

export interface RivalryHighlights {
  /** most recent result(s) in a row, chronologically - null if there's no real history */
  streak: { side: "one" | "two" | "tie"; count: number } | null;
  closestGame: RivalryMoment | null;
  biggestBlowout: (RivalryMoment & { winner: "one" | "two" }) | null;
  highestCombined: RivalryMoment | null;
  /** the single player who has personally torched the OTHER side the hardest, across every meeting - real cumulative production, not a one-game fluke */
  nemesisOne: NemesisPlayer | null;
  nemesisTwo: NemesisPlayer | null;
}

/**
 * Derived storylines off the same matchup history fetchRivalry already
 * pulls - no extra fetches, just real arithmetic over real box scores.
 * Works off a chronologically-sorted copy (year asc, week asc) rather than
 * rivalry.matchups' own display order (year asc, week desc - tuned for
 * that array's own nav UI, not for "what happened most recently").
 */
export function computeRivalryHighlights(rivalry: Rivalry): RivalryHighlights {
  const chronological = [...rivalry.matchups].sort(
    (a, b) => parseInt(a.year) - parseInt(b.year) || a.week - b.week
  );

  let streak: RivalryHighlights["streak"] = null;
  for (let i = chronological.length - 1; i >= 0; i--) {
    const m = chronological[i];
    const totalOne = m.matchup[0].points.reduce((t, v) => t + parseFloat(String(v)), 0);
    const totalTwo = m.matchup[1].points.reduce((t, v) => t + parseFloat(String(v)), 0);
    const side: "one" | "two" | "tie" = totalOne > totalTwo ? "one" : totalOne < totalTwo ? "two" : "tie";
    if (!streak) {
      streak = { side, count: 1 };
    } else if (streak.side === side) {
      streak.count += 1;
    } else {
      break;
    }
  }

  let closestGame: RivalryMoment | null = null;
  let biggestBlowout: (RivalryMoment & { winner: "one" | "two" }) | null = null;
  let highestCombined: RivalryMoment | null = null;
  const pointsForOne: Record<string, { total: number; games: number }> = {};
  const pointsForTwo: Record<string, { total: number; games: number }> = {};

  for (const m of rivalry.matchups) {
    const totalOne = m.matchup[0].points.reduce((t, v) => t + parseFloat(String(v)), 0);
    const totalTwo = m.matchup[1].points.reduce((t, v) => t + parseFloat(String(v)), 0);
    const margin = Math.abs(totalOne - totalTwo);
    const moment: RivalryMoment = { matchup: m, margin, totalOne, totalTwo };

    if (!closestGame || margin < closestGame.margin) closestGame = moment;
    if (totalOne !== totalTwo && (!biggestBlowout || margin > biggestBlowout.margin)) {
      biggestBlowout = { ...moment, winner: totalOne > totalTwo ? "one" : "two" };
    }
    if (!highestCombined || totalOne + totalTwo > highestCombined.totalOne + highestCombined.totalTwo) {
      highestCombined = moment;
    }

    m.matchup[0].starters.forEach((playerId, i) => {
      if (!playerId || playerId === "0") return;
      const pts = m.matchup[0].points[i] ?? 0;
      if (!pointsForOne[playerId]) pointsForOne[playerId] = { total: 0, games: 0 };
      pointsForOne[playerId].total += pts;
      pointsForOne[playerId].games += 1;
    });
    m.matchup[1].starters.forEach((playerId, i) => {
      if (!playerId || playerId === "0") return;
      const pts = m.matchup[1].points[i] ?? 0;
      if (!pointsForTwo[playerId]) pointsForTwo[playerId] = { total: 0, games: 0 };
      pointsForTwo[playerId].total += pts;
      pointsForTwo[playerId].games += 1;
    });
  }

  const topOf = (map: Record<string, { total: number; games: number }>): NemesisPlayer | null => {
    let best: NemesisPlayer | null = null;
    for (const playerId in map) {
      if (!best || map[playerId].total > best.totalPoints) {
        best = { playerId, totalPoints: map[playerId].total, games: map[playerId].games };
      }
    }
    return best;
  };

  return {
    streak,
    closestGame,
    biggestBlowout,
    highestCombined,
    nemesisOne: topOf(pointsForOne),
    nemesisTwo: topOf(pointsForTwo),
  };
}
