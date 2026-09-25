// pages/api/fetchEspnRankings.js
//
// A trim-and-proxy in front of ESPN's own public (unauthenticated, no API
// key) fantasy football player feed - real weekly expert rankings and
// real written game outlooks, verified live before shipping this. The
// raw feed has no server-side filtering that actually works (limit/sort
// filters are silently ignored) - every request returns the full ~11,600
// -player universe, a ~40MB payload, useless to ship straight to a mobile
// client. This fetches that once here, keeps only the players who
// actually have real week-N ranking or outlook data (a few hundred, not
// eleven thousand), and returns just {id, name, rank, outlook} for each -
// about 200KB instead of 40MB.
//
// Mobile matches this back to Sleeper's own player ids two ways: first by
// Sleeper's own espn_id cross-reference field (exact, but not populated
// for every player), falling back to matching on `name` (this response's
// own fullName) for whoever espn_id misses - see mobile's
// lib/espnFantasy.ts / lib/startSit.ts.

export default async function handler(req, res) {
  const { season, week } = req.query;
  if (!season || !week) {
    res.status(400).json({ error: "season and week query params are required" });
    return;
  }

  try {
    const filter = {
      players: {
        limit: 3000,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
      },
    };
    const espnRes = await fetch(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?view=kona_player_info`,
      { headers: { "X-Fantasy-Filter": JSON.stringify(filter) } }
    );
    if (!espnRes.ok) throw new Error(`ESPN fantasy players request failed: ${espnRes.status}`);
    const raw = await espnRes.json();

    const trimmed = {};
    for (const p of raw) {
      const weekRankings = (p.rankings && p.rankings[String(week)]) || [];
      const pprRanks = weekRankings
        .filter((r) => r.rankType === "PPR" && typeof r.rank === "number" && r.rank > 0)
        .map((r) => r.rank);
      const rank = pprRanks.length > 0 ? Math.round((pprRanks.reduce((s, r) => s + r, 0) / pprRanks.length) * 10) / 10 : undefined;
      const outlook = p.outlooks && p.outlooks.outlooksByWeek && p.outlooks.outlooksByWeek[String(week)];
      if (rank === undefined && !outlook) continue;
      trimmed[p.id] = { name: p.fullName, rank, outlook: outlook || undefined };
    }

    // A real week's rankings shift some through the week (injury news,
    // inactives) but not minute to minute - an hour of edge caching keeps
    // this cheap without going stale in a way that matters.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    res.status(200).json(trimmed);
  } catch (error) {
    console.error("Error fetching ESPN fantasy rankings:", error);
    res.status(500).json({ error: "Failed to fetch ESPN fantasy rankings" });
  }
}
