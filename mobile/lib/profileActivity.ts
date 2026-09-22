import { backend } from "./api";
import { buildLeagueTransactions, TradeEvent, AddDropEvent } from "./leagueTransactions";
import { rankTeams, determinePlayoffTeams } from "./whatIfSimulation";
import {
  getNflGameStatusByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
} from "./nflGameStatus";
import type { LeagueSeasonStats } from "./fantasyProfile";

// Everything that makes a profile feel alive beyond a bare win/loss record:
// the players this manager rosters the most across their leagues, what
// they've most recently added (trade or waiver), and how their team looks
// in whatever league-week is live right now. Built on top of the same
// `leagues` list getFantasyProfileStats already fetched (leagueId +
// leagueName), so nothing here re-derives "which leagues is this person
// in" from scratch.

const SLEEPER = "https://api.sleeper.app/v1";

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export interface Title {
  leagueName: string;
  season: string;
}

export interface CareerStats {
  seasonsPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  playoffAppearances: number;
  championships: number;
  /** which league + season each championship came from - covers leagues no longer active too, same as the rest of this crawl */
  titles: Title[];
}

// Sleeper's earliest supported fantasy season - a safe floor for "every
// season this manager has ever played," short of an API that just lists a
// user's full history directly (Sleeper doesn't expose one).
const EARLIEST_SLEEPER_SEASON = 2017;

// Career totals across literally every league this manager has ever been
// in - not just the ones they're still in now. Enumerates every season
// from EARLIEST_SLEEPER_SEASON through the current one via Sleeper's
// per-season "leagues this user is in" endpoint, which already returns
// that exact season's league_id for each league directly - no need to
// chain-walk previous_league_id the way getManagerHistory.ts does for a
// single league, and it also naturally reaches a league the manager left
// or that later folded, which a chain starting from their current leagues
// never could. Counts every championship a manager has actually won
// (getManagerHistory only tracks the single best finish ever, not how
// many times).
export async function getCareerStats(sleeperUserId: string, currentSeason: string): Promise<CareerStats> {
  const endYear = parseInt(currentSeason, 10) || new Date().getFullYear();
  const seasons = Array.from(
    { length: Math.max(0, endYear - EARLIEST_SLEEPER_SEASON + 1) },
    (_, i) => String(EARLIEST_SLEEPER_SEASON + i)
  );

  const seasonLeagueLists = await Promise.all(
    seasons.map((season) =>
      fetchJson(`${SLEEPER}/user/${sleeperUserId}/leagues/nfl/${season}`).catch(() => [])
    )
  );
  const leagueIds = Array.from(
    new Set(seasonLeagueLists.flat().map((l: any) => l.league_id as string).filter(Boolean))
  );

  if (leagueIds.length === 0) {
    return { seasonsPlayed: 0, wins: 0, losses: 0, ties: 0, winPct: 0, playoffAppearances: 0, championships: 0, titles: [] };
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let seasonsPlayed = 0;
  let playoffAppearances = 0;
  let championships = 0;
  const titles: Title[] = [];

  await Promise.all(
    leagueIds.map(async (leagueId) => {
      try {
        const [leagueInfo, rosters, bracket] = await Promise.all([
          fetchJson(`${SLEEPER}/league/${leagueId}`),
          fetchJson(`${SLEEPER}/league/${leagueId}/rosters`),
          fetch(`${SLEEPER}/league/${leagueId}/winners_bracket`)
            .then((r) => r.json())
            .catch(() => []),
        ]);

        const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
        const w = myRoster?.settings?.wins ?? 0;
        const l = myRoster?.settings?.losses ?? 0;
        const t = myRoster?.settings?.ties ?? 0;

        // Only counts a season as "played" once games actually happened -
        // skips the current in-progress season's 0-0 placeholder record,
        // same guard getManagerHistory.ts uses.
        if (myRoster && w + l + t > 0) {
          wins += w;
          losses += l;
          ties += t;
          seasonsPlayed += 1;

          const rosterIds = rosters.map((r: any) => String(r.roster_id));
          const winsMap: Record<string, number> = {};
          const pointsMap: Record<string, number> = {};
          const seedMap: Record<string, { division?: number }> = {};
          for (const r of rosters) {
            const id = String(r.roster_id);
            winsMap[id] = r.settings?.wins ?? 0;
            pointsMap[id] = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
            seedMap[id] = { division: r.settings?.division };
          }
          const playoffSpots = Math.min(leagueInfo.settings?.playoff_teams ?? 6, rosterIds.length);
          const divisionsCount = leagueInfo.settings?.divisions ?? 0;
          const ranked = rankTeams(rosterIds, winsMap, pointsMap);
          const { qualifiers } = determinePlayoffTeams(ranked, seedMap, divisionsCount, playoffSpots);
          if (qualifiers.includes(String(myRoster.roster_id))) {
            playoffAppearances += 1;
          }

          if (Array.isArray(bracket) && bracket.length > 0) {
            const championshipGame = bracket.find((g: any) => g.p === 1 && g.w !== undefined);
            if (championshipGame && championshipGame.w === myRoster.roster_id) {
              championships += 1;
              titles.push({ leagueName: leagueInfo.name ?? "Unknown League", season: leagueInfo.season ?? "" });
            }
          }
        }
      } catch (error) {
        console.error(`Error loading career history for league ${leagueId}:`, error);
      }
    })
  );

  titles.sort((a, b) => Number(b.season) - Number(a.season));

  const games = wins + losses + ties || 1;
  return {
    seasonsPlayed,
    wins,
    losses,
    ties,
    winPct: (wins + ties * 0.5) / games,
    playoffAppearances,
    championships,
    titles,
  };
}

export interface TopRosteredPlayer {
  playerId: string;
  name: string;
  pos?: string;
  team?: string;
  leagueCount: number;
}

/** the players this manager owns in the most of their leagues at once - not "best players," just most-trusted roster spots */
export async function getTopRosteredPlayers(
  sleeperUserId: string,
  leagues: Pick<LeagueSeasonStats, "leagueId">[],
  limit = 3
): Promise<TopRosteredPlayer[]> {
  if (leagues.length === 0) return [];

  const counts = new Map<string, number>();
  let playersData: Record<string, any> | null = null;

  await Promise.all(
    leagues.map(async (league) => {
      try {
        const rosters = await fetchJson(`${SLEEPER}/league/${league.leagueId}/rosters`);
        const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
        if (!myRoster) return;
        // The player id space is global (not per-league), so any one
        // league's player map resolves names for all of them - fetched
        // once, from whichever league responds first.
        if (!playersData) {
          playersData = await backend.fetchPlayers(league.leagueId).catch(() => ({}));
        }
        for (const playerId of myRoster.players ?? []) {
          counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
        }
      } catch (error) {
        console.error(`Error loading roster for league ${league.leagueId}:`, error);
      }
    })
  );

  const data = playersData ?? {};
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([playerId, leagueCount]) => {
      const p = (data as Record<string, any>)[playerId];
      if (!p) return { playerId, name: "Unknown Player", leagueCount };
      if (p.pos === "DEF") return { playerId, name: `${p.t ?? playerId} D/ST`, pos: "DEF", team: p.t, leagueCount };
      return {
        playerId,
        name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim() || "Unknown Player",
        pos: p.pos,
        team: p.t,
        leagueCount,
      };
    });
}

export interface RecentAcquisition {
  playerId: string;
  name: string;
  pos?: string;
  team?: string;
  leagueId: string;
  leagueName: string;
  via: "trade" | "waiver";
  timestamp: number;
}

/** this manager's most recent adds - by trade or waiver - across every league they're in, newest first */
export async function getRecentAcquisitions(
  sleeperUserId: string,
  leagues: Pick<LeagueSeasonStats, "leagueId" | "leagueName">[],
  limit = 5
): Promise<RecentAcquisition[]> {
  if (leagues.length === 0) return [];

  const all: RecentAcquisition[] = [];

  await Promise.all(
    leagues.map(async (league) => {
      try {
        const events = await buildLeagueTransactions(league.leagueId);
        for (const event of events) {
          if (event.kind === "add") {
            const add = event as AddDropEvent;
            if (add.team.userId !== sleeperUserId) continue;
            all.push({
              playerId: add.asset.id ?? add.asset.label,
              name: add.asset.label,
              pos: add.asset.pos,
              team: add.asset.team,
              leagueId: league.leagueId,
              leagueName: league.leagueName,
              via: "waiver",
              timestamp: add.timestamp,
            });
          } else if (event.kind === "trade2") {
            const trade = event as TradeEvent & { kind: "trade2" };
            if (trade.teamA.userId === sleeperUserId) {
              for (const asset of trade.aGets) {
                all.push({
                  playerId: asset.id ?? asset.label,
                  name: asset.label,
                  pos: asset.pos,
                  team: asset.team,
                  leagueId: league.leagueId,
                  leagueName: league.leagueName,
                  via: "trade",
                  timestamp: trade.timestamp,
                });
              }
            } else if (trade.teamB.userId === sleeperUserId) {
              for (const asset of trade.aGives) {
                all.push({
                  playerId: asset.id ?? asset.label,
                  name: asset.label,
                  pos: asset.pos,
                  team: asset.team,
                  leagueId: league.leagueId,
                  leagueName: league.leagueName,
                  via: "trade",
                  timestamp: trade.timestamp,
                });
              }
            }
          } else if (event.kind === "tradeMulti") {
            const trade = event as TradeEvent & { kind: "tradeMulti" };
            const myPart = trade.parts.find((p) => p.team.userId === sleeperUserId);
            if (!myPart) continue;
            for (const asset of myPart.receives) {
              all.push({
                playerId: asset.id ?? asset.label,
                name: asset.label,
                pos: asset.pos,
                team: asset.team,
                leagueId: league.leagueId,
                leagueName: league.leagueName,
                via: "trade",
                timestamp: trade.timestamp,
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error loading transactions for league ${league.leagueId}:`, error);
      }
    })
  );

  // Draft picks and unresolved player ids both come through with no `pos`
  // (assetFromPlayer only sets it for real, resolved players) - this is
  // "players acquired," not picks, so both get filtered out here.
  return all
    .filter((a) => !!a.pos)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export interface WeeklyMatchup {
  leagueId: string;
  leagueName: string;
  week: number;
  matchupId: string;
  myTeamName: string;
  myScore: number;
  myAvatar?: string;
  oppTeamName: string;
  oppScore: number;
  oppAvatar?: string;
  hasOpponent: boolean;
  /** true only while real NFL games are actually underway for this matchup - not "final" and not "hasn't started" */
  isLive: boolean;
}

/** this manager's matchup in each of their leagues for the NFL's current week */
export async function getWeeklyMatchups(
  sleeperUserId: string,
  leagues: Pick<LeagueSeasonStats, "leagueId" | "leagueName">[]
): Promise<WeeklyMatchup[]> {
  if (leagues.length === 0) return [];

  const nflState = await fetchJson(`${SLEEPER}/state/nfl`);
  const week: number = nflState.season_type === "post" ? 18 : nflState.display_week || 1;

  // Both shared across every league below (global, not per-league) - real
  // NFL game status for live/final, and player -> team lookup so a
  // roster's starters can be checked against that status. Same "fetched
  // once, from whichever league responds first" pattern already used for
  // player names elsewhere in this file.
  const [statusByTeam, playersData] = await Promise.all([
    getNflGameStatusByTeam(week, nflState.season).catch(() => ({})),
    backend.fetchPlayers(leagues[0].leagueId).catch(() => ({})),
  ]);
  const pastMondayCutoff = isPastMondayNightCutoff();

  const results = await Promise.all(
    leagues.map(async (league): Promise<WeeklyMatchup | null> => {
      try {
        const [rosters, users, matchups] = await Promise.all([
          fetchJson(`${SLEEPER}/league/${league.leagueId}/rosters`),
          fetchJson(`${SLEEPER}/league/${league.leagueId}/users`),
          fetchJson(`${SLEEPER}/league/${league.leagueId}/matchups/${week}`),
        ]);

        const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
        if (!myRoster) return null;
        const myMatchup = matchups.find((m: any) => m.roster_id === myRoster.roster_id);
        if (!myMatchup) return null;

        const teamName = (rosterId: number) => {
          const roster = rosters.find((r: any) => r.roster_id === rosterId);
          const user = users.find((u: any) => u.user_id === roster?.owner_id);
          return user?.display_name ?? "A team";
        };
        const teamAvatar = (rosterId: number) => {
          const roster = rosters.find((r: any) => r.roster_id === rosterId);
          const user = users.find((u: any) => u.user_id === roster?.owner_id);
          return user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined;
        };

        const opponent = matchups.find(
          (m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id
        );

        // Same real-per-starter-game-state check used everywhere else in
        // this app (the dashboard scoreboard, schedule, matchup screen) -
        // not a naive "scores aren't 0" heuristic.
        const startersTeams = (starters: string[] | undefined) =>
          (starters ?? []).filter((id) => id && id !== "0").map((id) => (playersData as any)[id]?.t);
        const rosterFullySet = (starters: string[] | undefined) => {
          const real = (starters ?? []).filter((id) => id && id !== "0");
          return real.length > 0 && real.length === (starters?.length ?? 0);
        };
        const myState = computeFantasyTeamGameState(
          startersTeams(myMatchup.starters),
          statusByTeam,
          rosterFullySet(myMatchup.starters)
        );
        const oppState = opponent
          ? computeFantasyTeamGameState(startersTeams(opponent.starters), statusByTeam, rosterFullySet(opponent.starters))
          : "pre";
        const isLive = combineMatchupGameState(myState, oppState, pastMondayCutoff) === "live";

        return {
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          week,
          matchupId: String(myMatchup.matchup_id),
          myTeamName: teamName(myRoster.roster_id),
          myScore: myMatchup.points ?? 0,
          myAvatar: teamAvatar(myRoster.roster_id),
          oppTeamName: opponent ? teamName(opponent.roster_id) : "No opponent",
          oppScore: opponent?.points ?? 0,
          oppAvatar: opponent ? teamAvatar(opponent.roster_id) : undefined,
          hasOpponent: !!opponent,
          isLive,
        };
      } catch (error) {
        console.error(`Error loading weekly matchup for league ${league.leagueId}:`, error);
        return null;
      }
    })
  );

  return results.filter((r): r is WeeklyMatchup => r !== null);
}
