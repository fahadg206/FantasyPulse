import { backend, sleeper } from "./api";
import { buildLeagueTransactions, TradeEvent, AddDropEvent } from "./leagueTransactions";
import { rankTeams, determinePlayoffTeams } from "./whatIfSimulation";
import {
  getNflGameStatusByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
} from "./nflGameStatus";
import { optimalLineupPoints, NON_STARTER_SLOTS, StartSitAccuracy } from "./startSitAccuracy";
import type { LeagueSeasonStats } from "./fantasyProfile";

// Everything that makes a profile feel alive beyond a bare win/loss record:
// the players this manager rosters the most across their leagues, what
// they've most recently added (trade or waiver), and how their team looks
// in whatever league-week is live right now. Built on top of the same
// `leagues` list getFantasyProfileStats already fetched (leagueId +
// leagueName), so nothing here re-derives "which leagues is this person
// in" from scratch.
//
// League/roster/user lookups below go through lib/api.ts's `sleeper`
// client (cached) rather than raw fetch, so a league already warmed by
// another screen - or by getFantasyProfileStats's own crawl just before
// this runs - is an instant hit instead of a second round trip. Matchups,
// winners brackets, and NFL state stay on raw fetchJson - live-ish data
// this app deliberately never caches, same as everywhere else.

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
export interface AllTimeStats {
  career: CareerStats;
  startSit: StartSitAccuracy;
}

// Career totals AND all-time start/sit accuracy, computed together in one
// pass - these used to be two fully independent crawls (getCareerStats and
// getStartSitAccuracy), each separately enumerating every season since
// EARLIEST_SLEEPER_SEASON and separately re-fetching every league's
// /league/{id} + /rosters, which is what made the profile page slow to
// load: the two crawls were the single biggest chunk of its network time
// and most of that work was pure duplication. Merged here since both were
// only ever called together, from ProfileActivity.tsx.
export async function getAllTimeStats(sleeperUserId: string, currentSeason: string): Promise<AllTimeStats> {
  const endYear = parseInt(currentSeason, 10) || new Date().getFullYear();
  const seasons = Array.from(
    { length: Math.max(0, endYear - EARLIEST_SLEEPER_SEASON + 1) },
    (_, i) => String(EARLIEST_SLEEPER_SEASON + i)
  );

  const seasonLeagueLists = await Promise.all(
    seasons.map((season) =>
      sleeper
        .getUserLeagues(sleeperUserId, season)
        .then((r) => r.data)
        .catch(() => [])
    )
  );
  const leagueIds = Array.from(
    new Set(seasonLeagueLists.flat().map((l: any) => l.league_id as string).filter(Boolean))
  );

  const emptyCareer: CareerStats = {
    seasonsPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    winPct: 0,
    playoffAppearances: 0,
    championships: 0,
    titles: [],
  };
  const emptyStartSit: StartSitAccuracy = { actualPoints: 0, optimalPoints: 0, accuracy: 0, weeksAnalyzed: 0 };
  if (leagueIds.length === 0) {
    return { career: emptyCareer, startSit: emptyStartSit };
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let seasonsPlayed = 0;
  let playoffAppearances = 0;
  let championships = 0;
  const titles: Title[] = [];

  let actualPoints = 0;
  let optimalPoints = 0;
  let weeksAnalyzed = 0;
  // Player position lookup is global, not per-league - fetched once and
  // shared across every league processed below, same as
  // getTopRosteredPlayers/getStartSitAccuracy did independently before.
  let posById: Record<string, string | undefined> | null = null;

  await Promise.all(
    leagueIds.map(async (leagueId) => {
      try {
        const [leagueInfo, rosters, bracket] = await Promise.all([
          sleeper.getLeague(leagueId).then((r) => r.data),
          sleeper.getLeagueRosters(leagueId).then((r) => r.data),
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
        // same guard getManagerHistory.ts uses. Applies to the start/sit
        // side of this crawl too now (getStartSitAccuracy never used to
        // skip the weekly-matchup fetches for an unplayed season, just
        // wasted the network round trip on nothing to analyze).
        if (!myRoster || w + l + t === 0) return;

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

        // --- start/sit accuracy for this same league, reusing leagueInfo/rosters/myRoster above ---
        const slots: string[] = (leagueInfo.roster_positions || []).filter(
          (p: string) => !NON_STARTER_SLOTS.has(p)
        );
        if (slots.length === 0) return;

        if (!posById) {
          const playersData = await backend.fetchPlayers(leagueId).catch(() => ({}));
          const map: Record<string, string | undefined> = {};
          for (const pid in playersData) map[pid] = (playersData as any)[pid]?.pos;
          posById = map;
        }

        const weeksCount = Math.max(1, (leagueInfo.settings?.playoff_week_start ?? 15) - 1);
        const weeks = Array.from({ length: weeksCount }, (_, i) => i + 1);
        const weekResults = await Promise.all(
          weeks.map((wk) => fetchJson(`${SLEEPER}/league/${leagueId}/matchups/${wk}`).catch(() => []))
        );

        for (const matchups of weekResults) {
          const mine = (matchups as any[]).find((m) => m.roster_id === myRoster.roster_id);
          if (!mine?.starters || !mine?.players_points || !mine?.players) continue;

          const starters: string[] = mine.starters.filter((id: string) => id && id !== "0");
          const rosterPlayerIds: string[] = mine.players;
          if (starters.length === 0 || rosterPlayerIds.length === 0) continue;

          const pointsById: Record<string, number> = mine.players_points;
          const weekHasRealScoring = Object.values(pointsById).some((p) => (p as number) !== 0);
          if (!weekHasRealScoring) continue;

          const actual = starters.reduce((sum, id) => sum + (pointsById[id] ?? 0), 0);
          const optimal = optimalLineupPoints(rosterPlayerIds, pointsById, posById!, slots);

          actualPoints += actual;
          optimalPoints += Math.max(optimal, actual);
          weeksAnalyzed += 1;
        }
      } catch (error) {
        console.error(`Error loading all-time stats for league ${leagueId}:`, error);
      }
    })
  );

  titles.sort((a, b) => Number(b.season) - Number(a.season));

  const games = wins + losses + ties || 1;
  return {
    career: {
      seasonsPlayed,
      wins,
      losses,
      ties,
      winPct: (wins + ties * 0.5) / games,
      playoffAppearances,
      championships,
      titles,
    },
    startSit: {
      actualPoints,
      optimalPoints,
      accuracy: optimalPoints > 0 ? actualPoints / optimalPoints : 0,
      weeksAnalyzed,
    },
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
        const { data: rosters } = await sleeper.getLeagueRosters(league.leagueId);
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
  /**
   * Sleeper's public API has no documented field for "this is a Chopped
   * (weekly-elimination) league" or "this roster was eliminated in week
   * N" - verified against both Sleeper's own docs and a community Chopped
   * tracker's source before concluding that. This is the best available
   * proxy: no paired opponent shows up for this week at all (a real
   * head-to-head league only lacks one on a bye week in an odd-numbered
   * league, which degrades gracefully into the same rank display rather
   * than breaking). When true, rank/eliminatedWeek are reconstructed by
   * replaying each week's scores ourselves (lowest score among not-yet-
   * eliminated rosters each week), the same technique a public Chopped
   * tracker uses for the same reason.
   */
  isChoppedFormat: boolean;
  /** current rank among still-active rosters, only set when isChoppedFormat and not eliminated */
  rank?: number;
  totalActiveTeams?: number;
  /** set once eliminated - the week it happened */
  eliminatedWeek?: number;
}

/** this manager's matchup in each of their leagues for the NFL's current week */
/**
 * Replays a Chopped-format league's completed weeks to reconstruct who
 * was eliminated and when, since Sleeper's API doesn't expose that state
 * directly - one elimination per week, the roster with the lowest score
 * that week among everyone not already eliminated. Returns rosterId ->
 * the week they were chopped.
 */
async function reconstructChoppedEliminations(
  leagueId: string,
  currentWeek: number,
  rosterIds: string[]
): Promise<Record<string, number>> {
  const completedWeeks = Array.from({ length: Math.max(0, currentWeek - 1) }, (_, i) => i + 1);
  const weekResults = await Promise.all(
    completedWeeks.map((w) => fetchJson(`${SLEEPER}/league/${leagueId}/matchups/${w}`).catch(() => []))
  );

  const eliminatedWeek: Record<string, number> = {};
  const stillActive = new Set(rosterIds.map(String));

  weekResults.forEach((matchups, i) => {
    const week = i + 1;
    const scores = (matchups as any[])
      .filter((m) => stillActive.has(String(m.roster_id)))
      .map((m) => ({ rosterId: String(m.roster_id), points: m.points ?? 0 }));
    if (scores.length === 0) return;
    // A week nobody's actually played yet (points all 0) isn't a real
    // result to eliminate anyone over.
    if (!scores.some((s) => s.points > 0)) return;

    const lowest = scores.reduce((min, s) => (s.points < min.points ? s : min));
    eliminatedWeek[lowest.rosterId] = week;
    stillActive.delete(lowest.rosterId);
  });

  return eliminatedWeek;
}

export async function getWeeklyMatchups(
  sleeperUserId: string,
  leagues: Pick<LeagueSeasonStats, "leagueId" | "leagueName">[]
): Promise<WeeklyMatchup[]> {
  if (leagues.length === 0) return [];

  const { data: nflState } = await sleeper.getNflState();
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
          sleeper.getLeagueRosters(league.leagueId).then((r) => r.data),
          sleeper.getLeagueUsers(league.leagueId).then((r) => r.data),
          sleeper.getMatchups(league.leagueId, week).then((r) => r.data),
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

        // Guarded so two rosters that both lack a matchup_id (which is
        // exactly the Chopped-format signal below) never spuriously
        // "pair up" with each other via undefined === undefined.
        const hasRealMatchupId = myMatchup.matchup_id !== undefined && myMatchup.matchup_id !== null;
        const opponent = hasRealMatchupId
          ? matchups.find((m: any) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id)
          : undefined;
        const isChoppedFormat = !opponent;

        let rank: number | undefined;
        let totalActiveTeams: number | undefined;
        let eliminatedWeek: number | undefined;
        if (isChoppedFormat) {
          const eliminations = await reconstructChoppedEliminations(
            league.leagueId,
            week,
            rosters.map((r: any) => r.roster_id)
          );
          eliminatedWeek = eliminations[String(myRoster.roster_id)];
          const activeRosterIds = rosters
            .map((r: any) => String(r.roster_id))
            .filter((id: string) => eliminations[id] === undefined);
          totalActiveTeams = activeRosterIds.length;
          if (eliminatedWeek === undefined) {
            const ranked = [...activeRosterIds].sort((a, b) => {
              const scoreOf = (rid: string) => matchups.find((m: any) => String(m.roster_id) === rid)?.points ?? 0;
              return scoreOf(b) - scoreOf(a);
            });
            const idx = ranked.indexOf(String(myRoster.roster_id));
            rank = idx === -1 ? undefined : idx + 1;
          }
        }

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
          isChoppedFormat,
          rank,
          totalActiveTeams,
          eliminatedWeek,
        };
      } catch (error) {
        console.error(`Error loading weekly matchup for league ${league.leagueId}:`, error);
        return null;
      }
    })
  );

  return results.filter((r): r is WeeklyMatchup => r !== null);
}
