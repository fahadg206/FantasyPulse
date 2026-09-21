// pages/api/fetchGmScout.js
//
// Real, multi-season manager stats for the GM Scout panel - trade count,
// draft pick flow, and league history - computed live from Sleeper's own
// API rather than a database this app doesn't have. See src/lib/gmScout.ts
// for why this is honest: Sleeper preserves real season-over-season history
// for one league's lineage via `previous_league_id`, which is walked here
// live. What this can't reproduce is Dynasty Daddy's cross-league manager
// tracking (the same person's activity across entirely different leagues
// over time) - only their CURRENT season's league count is derivable live.
import {
  pickFlowFromTrade,
  classifyBadges,
} from "@/lib/gmScout";

export const config = { maxDuration: 60 };

const SLEEPER = "https://api.sleeper.app/v1";
const MAX_SEASONS = 4;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function walkSeasonChain(startLeagueId) {
  const chain = [];
  let leagueId = startLeagueId;
  while (leagueId && chain.length < MAX_SEASONS) {
    const league = await fetchJson(`${SLEEPER}/league/${leagueId}`);
    chain.push(league);
    leagueId = league.previous_league_id || null;
  }
  return chain;
}

async function fetchSeasonTradeStats(league, managerUserId) {
  const [rosters, users] = await Promise.all([
    fetchJson(`${SLEEPER}/league/${league.league_id}/rosters`),
    fetchJson(`${SLEEPER}/league/${league.league_id}/users`),
  ]);

  const roster = rosters.find((r) => r.owner_id === managerUserId);
  if (!roster) return null;

  const lastWeek = Math.max((league.settings?.playoff_week_start || 15) - 1, 1);
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);

  const weeklyTransactions = await Promise.all(
    weeks.map((week) =>
      fetchJson(`${SLEEPER}/league/${league.league_id}/transactions/${week}`).catch(
        () => []
      )
    )
  );
  const transactions = weeklyTransactions.flat();

  const trades = transactions.filter(
    (t) =>
      t.type === "trade" &&
      t.status === "complete" &&
      (t.roster_ids || []).includes(roster.roster_id)
  );

  let picksGained = 0;
  let picksLost = 0;
  for (const trade of trades) {
    const flow = pickFlowFromTrade(trade.draft_picks, roster.roster_id);
    picksGained += flow.gained;
    picksLost += flow.lost;
  }

  return {
    season: league.season,
    leagueId: league.league_id,
    rosterId: roster.roster_id,
    roster,
    tradeCount: trades.length,
    picksGained,
    picksLost,
    transactions,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { leagueId, managerUserId } = req.body || {};
  if (!leagueId || !managerUserId) {
    return res
      .status(400)
      .json({ message: "leagueId and managerUserId are required" });
  }

  try {
    const chain = await walkSeasonChain(leagueId);

    const seasonStats = (
      await Promise.all(
        chain.map((league) => fetchSeasonTradeStats(league, managerUserId))
      )
    ).filter(Boolean);

    if (seasonStats.length === 0) {
      return res.status(404).json({ message: "Manager not found in this league" });
    }

    const currentSeason = seasonStats[0];
    const lastSeason = seasonStats[1] || null;

    const totalTrades = seasonStats.reduce((sum, s) => sum + s.tradeCount, 0);
    const totalPicksGained = seasonStats.reduce(
      (sum, s) => sum + s.picksGained,
      0
    );
    const totalPicksLost = seasonStats.reduce((sum, s) => sum + s.picksLost, 0);

    const [leaguesResponse, allPlayers] = await Promise.all([
      fetchJson(
        `${SLEEPER}/user/${managerUserId}/leagues/nfl/${currentSeason.season}`
      ).catch(() => []),
      fetchJson(`${SLEEPER}/players/nfl`).catch(() => ({})),
    ]);

    const rosterPlayerIds = currentSeason.roster.players || [];
    const rosterPlayers = rosterPlayerIds
      .map((id) => allPlayers[id])
      .filter(Boolean);

    const ages = rosterPlayers
      .map((p) => p.age)
      .filter((age) => typeof age === "number");
    const avgRosterAge =
      ages.length > 0
        ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10
        : null;

    const rookie = rosterPlayers.find((p) => p.years_exp === 0);
    const rookieOnRoster = rookie
      ? {
          sleeperId: rookie.player_id,
          fn: rookie.first_name,
          ln: rookie.last_name,
          pos: rookie.position,
        }
      : null;

    const acquisitions = currentSeason.transactions
      .filter(
        (t) =>
          t.status === "complete" &&
          (t.roster_ids || []).includes(currentSeason.rosterId) &&
          t.adds &&
          Object.values(t.adds).includes(currentSeason.rosterId)
      )
      .sort((a, b) => (b.created || 0) - (a.created || 0));

    let recentlyAcquired = null;
    if (acquisitions.length > 0) {
      const latest = acquisitions[0];
      const addedPlayerId = Object.keys(latest.adds).find(
        (playerId) => latest.adds[playerId] === currentSeason.rosterId
      );
      const player = addedPlayerId ? allPlayers[addedPlayerId] : null;
      if (player) {
        recentlyAcquired = {
          sleeperId: addedPlayerId,
          fn: player.first_name,
          ln: player.last_name,
          pos: player.position,
          date: latest.created ? new Date(latest.created).toISOString() : null,
        };
      }
    }

    const netPickFlow = totalPicksGained - totalPicksLost;

    return res.status(200).json({
      seasonsTracked: seasonStats.length,
      seasons: seasonStats.map((s) => ({
        season: s.season,
        tradeCount: s.tradeCount,
        picksGained: s.picksGained,
        picksLost: s.picksLost,
      })),
      tradesThisSeason: currentSeason.tradeCount,
      tradesLastSeason: lastSeason ? lastSeason.tradeCount : null,
      totalTrades,
      picksGained: totalPicksGained,
      picksLost: totalPicksLost,
      netPickFlow,
      leaguesCount: Array.isArray(leaguesResponse) ? leaguesResponse.length : null,
      avgRosterAge,
      rookieOnRoster,
      recentlyAcquired,
      badges: classifyBadges({
        totalTrades,
        netPickFlow,
        seasonsTracked: seasonStats.length,
      }),
      record: {
        wins: currentSeason.roster.settings?.wins || 0,
        losses: currentSeason.roster.settings?.losses || 0,
        pointsFor:
          (currentSeason.roster.settings?.fpts || 0) +
          (currentSeason.roster.settings?.fpts_decimal || 0) / 100,
      },
    });
  } catch (error) {
    console.error("Error building GM scout stats:", error);
    return res.status(500).json({ message: "Failed to build GM scout stats" });
  }
}
