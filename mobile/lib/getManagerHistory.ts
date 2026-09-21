import { sleeper } from "./api";
import { rankTeams, determinePlayoffTeams } from "./whatIfSimulation";
import { pickFlowFromTrade, classifyBadges, GmScoutBadge } from "./gmScoutMath";

export interface SeasonRecord {
  season: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export type Finish = "Champion" | "Runner-Up" | "3rd Place" | "Made Playoffs" | "Missed Playoffs";

const FINISH_RANK: Record<Finish, number> = {
  Champion: 1,
  "Runner-Up": 2,
  "3rd Place": 3,
  "Made Playoffs": 4,
  "Missed Playoffs": 5,
};

export interface ManagerAllTimeStats {
  userId: string;
  name: string;
  avatar?: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  seasonsPlayed: number;
  bestFinish: Finish | null;
  bestFinishSeason: string | null;
  bestSeason: SeasonRecord | null;
  worstSeason: SeasonRecord | null;
  totalTransactions: number;
  totalTrades: number;
  picksGained: number;
  picksLost: number;
  badges: GmScoutBadge[];
  totalPointsFor: number;
  playoffAppearances: number;
  // Filled in after all managers are computed - 1-indexed, 1 is best.
  ranks: {
    winPct: number;
    bestFinish: number;
    bestSeason: number;
    transactions: number;
    playoffAppearances: number;
  };
  leagueSize: number;
}

function seasonQuality(s: SeasonRecord): number {
  // Sort key for "best"/"worst" season: win% first, points as tiebreaker.
  const games = s.wins + s.losses + s.ties || 1;
  return (s.wins + s.ties * 0.5) / games + s.pointsFor / 1_000_000;
}

// Crawls the league's previous_league_id chain once and builds career-long
// stats per manager (keyed by the stable Sleeper user_id, since roster_ids
// get reused/reassigned season to season) - record, best/worst season,
// best playoff finish ever, and total transaction volume, each ranked
// against every other manager who has ever been in this league.
export async function getManagerHistory(leagueId: string): Promise<Record<string, ManagerAllTimeStats>> {
  const byUser: Record<
    string,
    {
      name: string;
      avatar?: string;
      wins: number;
      losses: number;
      ties: number;
      totalPointsFor: number;
      seasons: SeasonRecord[];
      bestFinish: Finish | null;
      bestFinishSeason: string | null;
      totalTransactions: number;
      totalTrades: number;
      picksGained: number;
      picksLost: number;
      playoffAppearances: number;
    }
  > = {};

  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId && currentLeagueId !== "0") {
    const leagueIdForRequest: string = currentLeagueId;
    try {
      const [leagueRes, usersRes, rostersRes, bracket] = await Promise.all([
        sleeper.getLeague(leagueIdForRequest),
        sleeper.getLeagueUsers(leagueIdForRequest),
        sleeper.getLeagueRosters(leagueIdForRequest),
        fetch(`https://api.sleeper.app/v1/league/${leagueIdForRequest}/winners_bracket`)
          .then((r) => r.json())
          .catch(() => []),
      ]);

      const season: string = leagueRes.data.season;
      const rosterToUser: Record<number, string> = {};

      for (const roster of rostersRes.data) {
        const ownerId: string = roster.owner_id;
        rosterToUser[roster.roster_id] = ownerId;
        const owner = usersRes.data.find((u: any) => u.user_id === ownerId);
        if (!byUser[ownerId]) {
          byUser[ownerId] = {
            name: owner?.display_name ?? "Unknown",
            avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
            wins: 0,
            losses: 0,
            ties: 0,
            totalPointsFor: 0,
            seasons: [],
            bestFinish: null,
            bestFinishSeason: null,
            totalTransactions: 0,
            totalTrades: 0,
            picksGained: 0,
            picksLost: 0,
            playoffAppearances: 0,
          };
        }

        const wins = roster.settings?.wins ?? 0;
        const losses = roster.settings?.losses ?? 0;
        const ties = roster.settings?.ties ?? 0;
        const pointsFor =
          (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100;

        const entry = byUser[ownerId];
        entry.wins += wins;
        entry.losses += losses;
        entry.ties += ties;
        entry.totalPointsFor += pointsFor;
        // Only count a season as "played" if games actually happened -
        // skips the current in-progress season's 0-0 placeholder record.
        if (wins + losses + ties > 0) {
          entry.seasons.push({ season, wins, losses, ties, pointsFor });
        }
      }

      if (Array.isArray(bracket) && bracket.length > 0) {
        const championGame = bracket.find((g: any) => g.p === 1 && g.w !== undefined);
        const thirdPlaceGame = bracket.find((g: any) => g.p === 3 && g.w !== undefined);

        const applyFinishForUser = (userId: string | undefined, finish: Finish) => {
          const entry = userId ? byUser[userId] : undefined;
          if (!entry) return;
          if (!entry.bestFinish || FINISH_RANK[finish] < FINISH_RANK[entry.bestFinish]) {
            entry.bestFinish = finish;
            entry.bestFinishSeason = season;
          }
        };
        const applyFinish = (rosterId: number | undefined, finish: Finish) => {
          if (rosterId === undefined) return;
          applyFinishForUser(rosterToUser[rosterId], finish);
        };

        if (championGame) {
          applyFinish(championGame.w, "Champion");
          applyFinish(championGame.l, "Runner-Up");
        }
        if (thirdPlaceGame) applyFinish(thirdPlaceGame.w, "3rd Place");

        // Who actually qualified for the playoffs is read off the season's
        // final standings (tiebreak: wins then points-for, division leaders
        // auto-qualifying) instead of scanned out of the bracket's
        // participant list. Sleeper's bracket JSON only sets a game's
        // t1/t2 directly when that slot's participant was already known
        // when the round was created - a bye team, or any later-round slot
        // that's only ever referenced via t1_from/t2_from, can be invisible
        // to a naive participant scan despite genuinely having made the
        // playoffs. This is what was causing real playoff teams to show up
        // as "Missed Playoffs".
        const seasonRosterIds = rostersRes.data.map((r: any) => String(r.roster_id));
        const seasonWins: Record<string, number> = {};
        const seasonPoints: Record<string, number> = {};
        const seasonSeed: Record<string, { division?: number }> = {};
        for (const roster of rostersRes.data) {
          const id = String(roster.roster_id);
          seasonWins[id] = roster.settings?.wins ?? 0;
          seasonPoints[id] = (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100;
          seasonSeed[id] = { division: roster.settings?.division };
        }
        const playoffSpots = Math.min(leagueRes.data.settings?.playoff_teams ?? 6, seasonRosterIds.length);
        const divisionsCount = leagueRes.data.settings?.divisions ?? 0;
        const ranked = rankTeams(seasonRosterIds, seasonWins, seasonPoints);
        const { qualifiers } = determinePlayoffTeams(ranked, seasonSeed, divisionsCount, playoffSpots);
        const qualifierSet = new Set(qualifiers);

        for (const rosterIdStr of seasonRosterIds) {
          const userId = rosterToUser[Number(rosterIdStr)];
          if (!userId || !byUser[userId]) continue;
          if (qualifierSet.has(rosterIdStr)) {
            byUser[userId].playoffAppearances += 1;
            applyFinishForUser(userId, "Made Playoffs");
          } else {
            applyFinishForUser(userId, "Missed Playoffs");
          }
        }
      }

      // Transaction volume for this season - every add/drop/trade side
      // counts once per manager it touched.
      const weeksCount: number = Math.max(1, (leagueRes.data.settings?.playoff_week_start ?? 15) - 1);
      const weeks = Array.from({ length: weeksCount }, (_, i) => i + 1);
      const weekTxResults = await Promise.all(
        weeks.map((w) =>
          fetch(`https://api.sleeper.app/v1/league/${leagueIdForRequest}/transactions/${w}`)
            .then((r) => r.json())
            .catch(() => [])
        )
      );
      const transactions = weekTxResults.flat().filter((t: any) => t?.status === "complete");
      for (const t of transactions) {
        const touchedRosterIds = new Set<number>([
          ...Object.values(t.adds ?? {}),
          ...Object.values(t.drops ?? {}),
        ] as number[]);
        for (const rosterId of touchedRosterIds) {
          const userId = rosterToUser[rosterId];
          if (byUser[userId]) byUser[userId].totalTransactions += 1;
        }

        // trade-specific: who traded, and who gained/lost draft picks -
        // verified against real trade transactions (owner_id/
        // previous_owner_id on each draft_pick) before this went live.
        if (t.type === "trade") {
          for (const rosterId of (t.roster_ids ?? []) as number[]) {
            const userId = rosterToUser[rosterId];
            if (!byUser[userId]) continue;
            byUser[userId].totalTrades += 1;
            const flow = pickFlowFromTrade(t.draft_picks, rosterId);
            byUser[userId].picksGained += flow.gained;
            byUser[userId].picksLost += flow.lost;
          }
        }
      }

      currentLeagueId = leagueRes.data.previous_league_id;
    } catch (error) {
      console.error("Error loading manager history:", error);
      break;
    }
  }

  const userIds = Object.keys(byUser);
  const leagueSize = userIds.length;

  const stats: Record<string, ManagerAllTimeStats> = {};
  for (const userId of userIds) {
    const u = byUser[userId];
    const games = u.wins + u.losses + u.ties || 1;
    const sortedSeasons = [...u.seasons].sort((a, b) => seasonQuality(b) - seasonQuality(a));
    stats[userId] = {
      userId,
      name: u.name,
      avatar: u.avatar,
      wins: u.wins,
      losses: u.losses,
      ties: u.ties,
      winPct: (u.wins + u.ties * 0.5) / games,
      seasonsPlayed: u.seasons.length,
      bestFinish: u.bestFinish,
      bestFinishSeason: u.bestFinishSeason,
      bestSeason: sortedSeasons[0] ?? null,
      worstSeason: sortedSeasons[sortedSeasons.length - 1] ?? null,
      totalTransactions: u.totalTransactions,
      totalTrades: u.totalTrades,
      picksGained: u.picksGained,
      picksLost: u.picksLost,
      badges: classifyBadges({
        totalTrades: u.totalTrades,
        netPickFlow: u.picksGained - u.picksLost,
        seasonsTracked: u.seasons.length,
      }),
      totalPointsFor: u.totalPointsFor,
      playoffAppearances: u.playoffAppearances,
      ranks: { winPct: 1, bestFinish: 1, bestSeason: 1, transactions: 1, playoffAppearances: 1 },
      leagueSize,
    };
  }

  const byWinPct = [...userIds].sort((a, b) => stats[b].winPct - stats[a].winPct);
  byWinPct.forEach((id, i) => (stats[id].ranks.winPct = i + 1));

  const byFinish = [...userIds].sort((a, b) => {
    const rankA = stats[a].bestFinish ? FINISH_RANK[stats[a].bestFinish!] : 99;
    const rankB = stats[b].bestFinish ? FINISH_RANK[stats[b].bestFinish!] : 99;
    return rankA - rankB;
  });
  byFinish.forEach((id, i) => (stats[id].ranks.bestFinish = i + 1));

  const byBestSeason = [...userIds].sort((a, b) => {
    const qa = stats[a].bestSeason ? seasonQuality(stats[a].bestSeason!) : -1;
    const qb = stats[b].bestSeason ? seasonQuality(stats[b].bestSeason!) : -1;
    return qb - qa;
  });
  byBestSeason.forEach((id, i) => (stats[id].ranks.bestSeason = i + 1));

  const byTransactions = [...userIds].sort((a, b) => stats[b].totalTransactions - stats[a].totalTransactions);
  byTransactions.forEach((id, i) => (stats[id].ranks.transactions = i + 1));

  const byPlayoffAppearances = [...userIds].sort((a, b) => stats[b].playoffAppearances - stats[a].playoffAppearances);
  byPlayoffAppearances.forEach((id, i) => (stats[id].ranks.playoffAppearances = i + 1));

  return stats;
}
