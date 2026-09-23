// Shared league-wide season-simulation inputs - the same shape Standings'
// baseline playoff-odds column and the What-If modal already build
// (managerInfo/matchupData/projectionCache for whatIfSimulation.ts's
// runMonteCarlo/projectStandings), pulled out here so the Trade Calculator
// can run the exact same trusted projection engine for "how many wins does
// this trade add" instead of inventing a second, less-trustworthy formula.

import { sleeper, backend } from "./api";
import getMatchupData from "./getMatchupData";
import type { TeamSeedData } from "./whatIfSimulation";
import { optimalLineupPoints, NON_STARTER_SLOTS } from "./startSitAccuracy";

export interface SimTeamInfo extends TeamSeedData {
  name: string;
  avatar?: string;
  rosterId: number;
  /** every player id on this roster right now (starters + bench) */
  rosterPlayerIds: string[];
  starters?: string[];
}

export interface LeagueSimData {
  teamIds: string[];
  managerInfo: Record<string, SimTeamInfo>;
  matchupData: Record<number, any>;
  /** week -> userId -> that team's best-lineup projected points, off CURRENT rosters */
  projectionCache: Record<number, Record<string, number>>;
  playoffStartWeek: number;
  playoffSpots: number;
  divisionsCount: number;
  weekNumbers: number[];
  startingSlots: string[];
  posById: Record<string, string | undefined>;
}

/** this team's best-possible lineup projected points for `week`, off whichever roster player ids are passed in - not necessarily their real current starters, so a trade's hypothetical post-trade roster can be projected the same way. */
export function projectedLineupPoints(
  rosterPlayerIds: string[],
  week: number,
  playersData: Record<string, any>,
  startingSlots: string[]
): number {
  const posById: Record<string, string | undefined> = {};
  const projById: Record<string, number> = {};
  for (const id of rosterPlayerIds) {
    posById[id] = playersData?.[id]?.pos;
    const p = playersData?.[id]?.wi?.[week.toString()]?.p;
    projById[id] = p !== undefined ? parseFloat(p) : 0;
  }
  return optimalLineupPoints(rosterPlayerIds, projById, posById, startingSlots);
}

export async function buildLeagueSimData(leagueId: string): Promise<LeagueSimData> {
  const playersData = await backend.fetchPlayers(leagueId);
  const [{ data: usersData }, { data: rostersData }, { data: leagueSettings }] = await Promise.all([
    sleeper.getLeagueUsers(leagueId),
    sleeper.getLeagueRosters(leagueId),
    sleeper.getLeague(leagueId),
  ]);

  const playoffStartWeek: number = leagueSettings.settings.playoff_week_start;
  const playoffSpots: number = leagueSettings.settings?.playoff_teams || 6;
  const divisionsCount: number = leagueSettings.settings?.divisions ?? 0;
  const startingSlots: string[] = (leagueSettings.roster_positions || []).filter(
    (p: string) => !NON_STARTER_SLOTS.has(p)
  );

  const usersWithRoster = usersData.filter((u: any) => rostersData.some((r: any) => r.owner_id === u.user_id));
  const managerInfo: Record<string, SimTeamInfo> = {};
  for (const user of usersWithRoster) {
    const roster = rostersData.find((r: any) => r.owner_id === user.user_id);
    managerInfo[user.user_id] = {
      name: user.display_name,
      avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined,
      rosterId: roster?.roster_id,
      rosterPlayerIds: roster?.players ?? [],
      starters: roster?.starters,
      division: roster?.settings?.division,
      team_points_for: roster?.settings?.fpts,
      team_points_for_dec: roster?.settings?.fpts_decimal,
      wins: roster?.settings?.wins,
      losses: roster?.settings?.losses,
    };
  }

  const weekNumbers = Array.from({ length: Math.max(0, playoffStartWeek - 1) }, (_, i) => i + 1);
  const weekResults = await Promise.all(weekNumbers.map((week) => getMatchupData(leagueId, week, playersData)));
  const matchupData: Record<number, any> = {};
  weekNumbers.forEach((week, i) => {
    matchupData[week] = weekResults[i].updatedScheduleData;
  });

  const posById: Record<string, string | undefined> = {};
  for (const pid in playersData) posById[pid] = playersData[pid]?.pos;

  const projectionCache: Record<number, Record<string, number>> = {};
  for (const week of weekNumbers) {
    projectionCache[week] = {};
    for (const userId in managerInfo) {
      projectionCache[week][userId] = projectedLineupPoints(
        managerInfo[userId].rosterPlayerIds,
        week,
        playersData,
        startingSlots
      );
    }
  }

  return {
    teamIds: Object.keys(managerInfo),
    managerInfo,
    matchupData,
    projectionCache,
    playoffStartWeek,
    playoffSpots,
    divisionsCount,
    weekNumbers,
    startingSlots,
    posById,
  };
}
