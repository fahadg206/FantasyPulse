// Cross-league season stats for the Fantasy Profile page - every league a
// Sleeper user is in this season, their record and rank in each, rolled up
// into a season-wide total. Verified against a real multi-league Sleeper
// account before shipping: /v1/user/{id}/leagues can return a league the
// user has no roster in yet (invited but not drafted, or a similar
// in-between state) - handled by skipping any league where a roster lookup
// comes back empty, rather than assuming membership always means a roster.

const SLEEPER = "https://api.sleeper.app/v1";

export interface LeagueSeasonStats {
  leagueId: string;
  leagueName: string;
  season: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  rank: number;
  totalTeams: number;
  avatar?: string;
}

export interface FantasyProfileStats {
  sleeperUserId: string;
  season: string;
  leagues: LeagueSeasonStats[];
  totals: {
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    leaguesCount: number;
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function getFantasyProfileStats(
  sleeperUserId: string,
  season: string
): Promise<FantasyProfileStats> {
  const leaguesData = await fetchJson(
    `${SLEEPER}/user/${sleeperUserId}/leagues/nfl/${season}`
  );

  const leagueResults = await Promise.all(
    (leaguesData || []).map(async (league: any): Promise<LeagueSeasonStats | null> => {
      try {
        const rosters = await fetchJson(`${SLEEPER}/league/${league.league_id}/rosters`);
        const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
        if (!myRoster) return null;

        const pointsFor = (r: any) =>
          (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;

        const ranked = [...rosters].sort((a, b) => {
          const winsDiff = (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0);
          if (winsDiff !== 0) return winsDiff;
          return pointsFor(b) - pointsFor(a);
        });
        const rank = ranked.findIndex((r) => r.roster_id === myRoster.roster_id) + 1;

        return {
          leagueId: league.league_id,
          leagueName: league.name,
          season,
          wins: myRoster.settings?.wins ?? 0,
          losses: myRoster.settings?.losses ?? 0,
          ties: myRoster.settings?.ties ?? 0,
          pointsFor: pointsFor(myRoster),
          rank,
          totalTeams: rosters.length,
          avatar: league.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}`
            : undefined,
        };
      } catch (error) {
        console.error(`Error loading stats for league ${league.league_id}:`, error);
        return null;
      }
    })
  );

  const leagues = leagueResults.filter((l): l is LeagueSeasonStats => l !== null);

  const totals = leagues.reduce(
    (acc, l) => ({
      wins: acc.wins + l.wins,
      losses: acc.losses + l.losses,
      ties: acc.ties + l.ties,
      pointsFor: acc.pointsFor + l.pointsFor,
      leaguesCount: acc.leaguesCount + 1,
    }),
    { wins: 0, losses: 0, ties: 0, pointsFor: 0, leaguesCount: 0 }
  );

  return { sleeperUserId, season, leagues, totals };
}
