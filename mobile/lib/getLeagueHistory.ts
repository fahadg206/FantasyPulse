import { sleeper } from "./api";

export interface HistoryTeam {
  name: string;
  avatar?: string;
}

export interface SeasonHistory {
  season: string;
  /** that season's own Sleeper league id - not the current league's, since a Sleeper league gets a new id every season and only chains back via previous_league_id. Needed to fetch that season's own bracket (getPlayoffBracket) rather than only ever being able to show the current one. */
  leagueId: string;
  leagueName: string;
  champion?: HistoryTeam;
  runnerUp?: HistoryTeam;
  thirdPlace?: HistoryTeam;
}

// Crawls the league's previous_league_id chain (same pattern as
// getRivalry.ts) and pulls the playoff bracket for each season to surface
// who actually won it - Sleeper's league object itself has no "champion"
// field, but the winners_bracket's p:1 entry (the championship game) does,
// via its winning roster_id.
export async function getLeagueHistory(leagueId: string): Promise<SeasonHistory[]> {
  const history: SeasonHistory[] = [];
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId && currentLeagueId !== "0") {
    const leagueIdForRequest: string = currentLeagueId;
    try {
      const [leagueRes, usersRes, rostersRes, bracket] = await Promise.all([
        sleeper.getLeague(leagueIdForRequest),
        sleeper.getLeagueUsers(leagueIdForRequest),
        sleeper.getLeagueRosters(leagueIdForRequest),
        fetch(`https://api.sleeper.app/v1/league/${leagueIdForRequest}/winners_bracket`).then((r) => r.json()),
      ]);

      const rosterToTeam: Record<number, HistoryTeam> = {};
      for (const roster of rostersRes.data) {
        const owner = usersRes.data.find((u: any) => u.user_id === roster.owner_id);
        rosterToTeam[roster.roster_id] = {
          name: owner?.display_name ?? "Unknown",
          avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
        };
      }

      if (Array.isArray(bracket)) {
        const championGame = bracket.find((g: any) => g.p === 1 && g.w !== undefined);
        if (championGame) {
          const thirdPlaceGame = bracket.find((g: any) => g.p === 3 && g.w !== undefined);
          history.push({
            season: leagueRes.data.season,
            leagueId: leagueIdForRequest,
            leagueName: leagueRes.data.name,
            champion: rosterToTeam[championGame.w],
            runnerUp: rosterToTeam[championGame.l],
            thirdPlace: thirdPlaceGame ? rosterToTeam[thirdPlaceGame.w] : undefined,
          });
        }
      }

      currentLeagueId = leagueRes.data.previous_league_id;
    } catch (error) {
      console.error("Error loading season history:", error);
      break;
    }
  }

  history.sort((a, b) => parseInt(b.season) - parseInt(a.season));
  return history;
}
