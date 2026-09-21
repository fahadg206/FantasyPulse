import { sleeper, backend } from "./api";
import type { ImageSourcePropType } from "react-native";

const helmet: ImageSourcePropType = require("../assets/images/helmet2.png");

export interface Starter {
  id?: string;
  fn?: string;
  ln?: string;
  avatar?: string;
  points?: string;
  proj?: string;
  pos?: string;
  team?: string;
}

export interface ScheduleData {
  [userId: string]: {
    avatar?: string | ImageSourcePropType;
    name: string;
    roster_id?: string;
    user_id?: string;
    opponent_id?: string;
    starters?: string[];
    starters_points?: number[];
    players?: string[];
    players_points?: Record<string, number>;
    starters_full_data?: Starter[];
    bench_full_data?: Starter[];
    team_points?: string;
    opponent?: string;
    matchup_id?: string;
    wins?: string;
    losses?: string;
    streak?: string;
  };
}

export interface MatchupMapData {
  avatar?: string | ImageSourcePropType;
  name: string;
  roster_id?: string;
  user_id?: string;
  opponent_id?: string;
  starters?: string[];
  starters_points?: number[];
  team_points?: string;
  opponent?: string;
  matchup_id?: string;
}

// Ports src/app/libs/getMatchupData.tsx. This is the shared data pipeline
// behind the Dashboard, Standings, and Schedule screens.
//
// `playersData` is optional: pass it in when a caller needs multiple weeks
// (Standings, League Managers) so the (large) players payload is fetched
// once and reused, instead of once per week.
export default async function getMatchupData(leagueId: string, week: number, playersData?: any) {
  const matchupMap = new Map<string, MatchupMapData[]>();
  const updatedScheduleData: ScheduleData = {};

  async function fetchPlayersData() {
    try {
      return await backend.fetchPlayers(leagueId);
    } catch (error) {
      console.error("Error while fetching players data:", error);
      return {};
    }
  }

  const fetchData = async (playersData: any) => {
    try {
      const [usersData, rostersData, scheduleData] = await Promise.all([
        sleeper.getLeagueUsers(leagueId).then((r) => r.data),
        sleeper.getLeagueRosters(leagueId).then((r) => r.data),
        sleeper.getMatchups(leagueId, week && week >= 1 ? week : 1).then((r) => r.data),
      ]);

      const usersWithRoster = usersData.filter((user: { user_id: string }) =>
        rostersData.some((roster: { owner_id: string }) => roster.owner_id === user.user_id)
      );

      for (const user of usersWithRoster) {
        updatedScheduleData[user.user_id] = {
          avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : helmet,
          name: user.display_name,
          user_id: user.user_id,
        };
      }

      for (const roster of rostersData) {
        if (updatedScheduleData[roster.owner_id]) {
          updatedScheduleData[roster.owner_id].roster_id = roster.roster_id;
          updatedScheduleData[roster.owner_id].wins = roster.settings.wins;
          updatedScheduleData[roster.owner_id].losses = roster.settings.losses;
          updatedScheduleData[roster.owner_id].streak = roster.metadata?.streak || "N/A";
        }
      }

      for (const matchup of scheduleData) {
        for (const userId in updatedScheduleData) {
          if (updatedScheduleData[userId].roster_id === matchup.roster_id) {
            updatedScheduleData[userId].matchup_id = String(matchup.matchup_id);
            updatedScheduleData[userId].team_points = matchup.points;
            updatedScheduleData[userId].starters_points = matchup.starters_points;
            updatedScheduleData[userId].players = matchup.players;
            updatedScheduleData[userId].players_points = matchup.players_points;
            updatedScheduleData[userId].starters = matchup.starters;
          }
        }
      }

      function buildPlayerCard(userId: string, playerId: string): Starter | null {
        if (playerId === "0" || !playersData[playerId]) return null;
        const isDef = playersData[playerId].pos === "DEF";
        return {
          id: playerId,
          fn: playersData[playerId].fn,
          ln: playersData[playerId].ln,
          avatar: isDef
            ? `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`
            : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`,
          points: String(updatedScheduleData[userId]?.players_points?.[playerId] ?? "0"),
          pos: playersData[playerId].pos,
          proj: playersData[playerId].wi?.[week.toString()]?.p,
          team: isDef ? playerId : playersData[playerId].t,
        };
      }

      for (const userId in updatedScheduleData) {
        // One entry per roster slot, in order - an empty slot ("0" / bye)
        // becomes `{}` rather than being skipped, so slot N always lines up
        // with slot N on the opposing team (needed to pair QB-vs-QB etc. in
        // the matchup detail view).
        updatedScheduleData[userId].starters_full_data = (updatedScheduleData[userId]?.starters || []).map(
          (starter) => buildPlayerCard(userId, starter) ?? {}
        );

        const startersSet = new Set(updatedScheduleData[userId]?.starters || []);
        const bench: Starter[] = [];
        for (const playerId of updatedScheduleData[userId]?.players || []) {
          if (startersSet.has(playerId)) continue;
          const benchData = buildPlayerCard(userId, playerId);
          if (benchData) bench.push(benchData);
        }
        updatedScheduleData[userId].bench_full_data = bench;
      }

      for (const userId in updatedScheduleData) {
        const userData = updatedScheduleData[userId];
        if (userData.matchup_id) {
          if (!matchupMap.has(userData.matchup_id)) {
            matchupMap.set(userData.matchup_id, [userData]);
          } else {
            const matchupData = matchupMap.get(userData.matchup_id);
            if (matchupData && matchupData.length > 0) {
              const firstPlayer = matchupData[0];
              firstPlayer.opponent = userData.name;
              firstPlayer.opponent_id = userData.user_id;
              matchupMap.set(userData.matchup_id, [firstPlayer]);
              userData.opponent = firstPlayer.name;
              userData.opponent_id = userData.user_id;
              matchupMap.get(userData.matchup_id)?.push(userData);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    return { matchupMap, updatedScheduleData, playersData };
  };

  const resolvedPlayersData = playersData ?? (await fetchPlayersData());
  return fetchData(resolvedPlayersData);
}
