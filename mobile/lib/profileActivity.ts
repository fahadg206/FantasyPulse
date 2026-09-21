import { backend } from "./api";
import { buildLeagueTransactions, TradeEvent, AddDropEvent } from "./leagueTransactions";
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
  myTeamName: string;
  myScore: number;
  oppTeamName: string;
  oppScore: number;
  oppAvatar?: string;
  hasOpponent: boolean;
}

/** this manager's matchup in each of their leagues for the NFL's current week */
export async function getWeeklyMatchups(
  sleeperUserId: string,
  leagues: Pick<LeagueSeasonStats, "leagueId" | "leagueName">[]
): Promise<WeeklyMatchup[]> {
  if (leagues.length === 0) return [];

  const nflState = await fetchJson(`${SLEEPER}/state/nfl`);
  const week: number = nflState.season_type === "post" ? 18 : nflState.display_week || 1;

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

        return {
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          week,
          myTeamName: teamName(myRoster.roster_id),
          myScore: myMatchup.points ?? 0,
          oppTeamName: opponent ? teamName(opponent.roster_id) : "No opponent",
          oppScore: opponent?.points ?? 0,
          oppAvatar: opponent ? teamAvatar(opponent.roster_id) : undefined,
          hasOpponent: !!opponent,
        };
      } catch (error) {
        console.error(`Error loading weekly matchup for league ${league.leagueId}:`, error);
        return null;
      }
    })
  );

  return results.filter((r): r is WeeklyMatchup => r !== null);
}
