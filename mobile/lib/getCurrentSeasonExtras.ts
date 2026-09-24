import { sleeper, backend } from "./api";
import { getLeagueValueSettings } from "./playerValue";
import { computePowerRankings, PowerRankingResult } from "./powerRankings";

export interface CurrentSeasonExtras {
  tier: PowerRankingResult | null;
  /** picks-traded-flow, roster age, rookie-on-roster, and recently-acquired
   * only mean anything in a dynasty league - a redraft roster resets every
   * offseason, so none of that is real signal there. Callers gate their
   * whole GM Scout section on this instead of checking each field. */
  isDynasty: boolean;
  avgRosterAge: number | null;
  rookieOnRoster: { sleeperId: string; fn: string; ln: string; pos: string } | null;
  recentlyAcquired: {
    sleeperId: string;
    fn: string;
    ln: string;
    pos: string;
    date: string | null;
  } | null;
}

// Current-season-only GM Scout extras - tier (from the same power rankings
// engine used on the Power Rankings screen), average roster age (Sleeper's
// player data includes real age/years_exp), a rookie on the roster, and the
// most recent add. Kept separate from getManagerHistory.ts because none of
// this needs the multi-season previous_league_id chain - just this
// season's league. The roster-age/rookie/recently-acquired fields are
// dynasty-only concepts (see isDynasty above) - for a redraft league this
// skips the ~5MB full Sleeper player blob and the recently-acquired
// transaction crawl entirely, not just hiding them in the UI.
export async function getCurrentSeasonExtras(
  leagueId: string,
  managerUserId: string
): Promise<CurrentSeasonExtras> {
  const [usersRes, rostersRes, nflStateRes, settings, playersData] = await Promise.all([
    sleeper.getLeagueUsers(leagueId),
    sleeper.getLeagueRosters(leagueId),
    sleeper.getNflState(),
    getLeagueValueSettings(leagueId),
    backend.fetchPlayers(leagueId),
  ]);

  const allPlayers: Record<string, any> = settings.isDynasty
    ? await fetch("https://api.sleeper.app/v1/players/nfl").then((r) => r.json())
    : {};

  const myRoster = rostersRes.data.find((r: any) => r.owner_id === managerUserId);

  let tier: PowerRankingResult | null = null;
  try {
    let playerValuesBySleeperId: Record<string, any> = {};
    if (settings.isDynasty) {
      playerValuesBySleeperId = await backend.fetchAllPlayerValues();
    }
    const currentWeek: number = nflStateRes.data.week || 1;
    const teamsInput = rostersRes.data
      .filter((roster: any) => usersRes.data.some((u: any) => u.user_id === roster.owner_id))
      .map((roster: any) => ({
        rosterId: Number(roster.roster_id),
        userId: roster.owner_id,
        wins: parseInt(roster.settings?.wins || "0"),
        losses: parseInt(roster.settings?.losses || "0"),
        rosterSleeperIds: roster.players || [],
        starterSleeperIds: roster.starters || [],
      }));
    const rankings = computePowerRankings({
      teams: teamsInput,
      leagueSettings: settings,
      upcomingWeeks: [currentWeek, currentWeek + 1, currentWeek + 2],
      playerValuesBySleeperId,
      getWeeklyStarterProjection: (starterIds, week) =>
        starterIds.reduce((sum: number, playerId: string) => {
          const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
          return sum + (proj !== undefined ? parseFloat(proj) : 0);
        }, 0),
    });
    tier = rankings.find((r) => r.userId === managerUserId) || null;
  } catch (error) {
    console.error("Error computing tier for GM scout:", error);
  }

  let avgRosterAge: number | null = null;
  let rookieOnRoster: CurrentSeasonExtras["rookieOnRoster"] = null;
  if (myRoster && settings.isDynasty) {
    const rosterPlayers = (myRoster.players || [])
      .map((id: string) => allPlayers[id])
      .filter(Boolean);
    const ages = rosterPlayers
      .map((p: any) => p.age)
      .filter((age: any) => typeof age === "number");
    avgRosterAge =
      ages.length > 0 ? Math.round((ages.reduce((s: number, a: number) => s + a, 0) / ages.length) * 10) / 10 : null;

    const rookie = rosterPlayers.find((p: any) => p.years_exp === 0);
    rookieOnRoster = rookie
      ? { sleeperId: rookie.player_id, fn: rookie.first_name, ln: rookie.last_name, pos: rookie.position }
      : null;
  }

  let recentlyAcquired: CurrentSeasonExtras["recentlyAcquired"] = null;
  if (myRoster && settings.isDynasty) {
    try {
      const lastWeek = Math.max(1, (nflStateRes.data.display_week || 1));
      const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
      const weekTx = await Promise.all(
        weeks.map((w) =>
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
            .then((r) => r.json())
            .catch(() => [])
        )
      );
      const acquisitions = weekTx
        .flat()
        .filter(
          (t: any) =>
            t?.status === "complete" &&
            (t.roster_ids || []).includes(myRoster.roster_id) &&
            t.adds &&
            Object.values(t.adds).includes(myRoster.roster_id)
        )
        .sort((a: any, b: any) => (b.created || 0) - (a.created || 0));

      if (acquisitions.length > 0) {
        const latest = acquisitions[0];
        const addedPlayerId = Object.keys(latest.adds).find(
          (playerId) => latest.adds[playerId] === myRoster.roster_id
        );
        const player = addedPlayerId ? allPlayers[addedPlayerId] : null;
        if (player) {
          recentlyAcquired = {
            sleeperId: addedPlayerId!,
            fn: player.first_name,
            ln: player.last_name,
            pos: player.position,
            date: latest.created ? new Date(latest.created).toISOString() : null,
          };
        }
      }
    } catch (error) {
      console.error("Error computing recently-acquired for GM scout:", error);
    }
  }

  return { tier, isDynasty: settings.isDynasty, avgRosterAge, rookieOnRoster, recentlyAcquired };
}
