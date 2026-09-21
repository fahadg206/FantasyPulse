// pages/api/fetchMatchupFeed.js
//
// A per-fantasy-matchup "redzone" style feed: every real NFL scoring play
// (touchdown, field goal, safety, 2-point conversion) involving a player
// rostered by either team in this matchup, merged across however many real
// games those players are spread across, in chronological order.
//
// There's no free source for this keyed directly off Sleeper or Dynasty
// Daddy - Sleeper's API has no live play-by-play, and Dynasty Daddy's own
// "Fantasy Redzone" feature runs on a paid third-party provider (Tank01).
// This uses ESPN's free, public (if undocumented) scoreboard/summary API
// instead: no signup, no key. Verified directly against the live API - each
// game summary's top-level `scoringPlays` array is already exactly the
// scoring plays for that game, in chronological order, with each play's
// `text` leading with the scoring player's name (e.g. "Harrison Butker 40
// Yd Field Goal", "Joshua Palmer 43 Yd pass from Josh Allen") - that name is
// parsed out here and matched against this matchup's rostered players.
export const config = { maxDuration: 30 };

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

function cleanNameString(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bjr\.?\b|\bsr\.?\b|\biii\b|\bii\b|\biv\b/g, "")
    .replace(/[.'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ESPN scoring play text always leads with the scoring player's name.
function extractLeadingName(text) {
  const match = (text || "").match(
    /^([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+)+?) \d/
  );
  return match ? match[1] : null;
}

function matchPlayer(text, players) {
  const leadingName = extractLeadingName(text);
  if (!leadingName) return null;
  const cleaned = cleanNameString(leadingName);

  const exact = players.find(
    (p) => cleanNameString(`${p.fn} ${p.ln}`) === cleaned
  );
  if (exact) return exact;

  // fall back to a last-name match (handles nickname/suffix mismatches),
  // only when it's unambiguous among this matchup's players
  const lastNameToken = cleaned.split(" ").slice(-1)[0];
  const lastNameMatches = players.filter(
    (p) => cleanNameString(p.ln) === lastNameToken
  );
  return lastNameMatches.length === 1 ? lastNameMatches[0] : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { week, season, players } = req.body || {};

  if (!week || !season || !Array.isArray(players) || players.length === 0) {
    return res
      .status(400)
      .json({ message: "week, season, and players are required" });
  }

  try {
    const scoreboard = await fetchJson(
      `${ESPN_SCOREBOARD_URL}?week=${week}&seasontype=2&year=${season}`
    );

    const teamsInvolved = new Set(players.map((p) => p.team).filter(Boolean));

    const relevantEvents = (scoreboard.events || []).filter((event) => {
      const competitors =
        event.competitions?.[0]?.competitors?.map(
          (c) => c.team?.abbreviation
        ) || [];
      return competitors.some((abbr) => teamsInvolved.has(abbr));
    });

    const gamesByEvent = await Promise.all(
      relevantEvents.map(async (event) => {
        try {
          const summary = await fetchJson(
            `${ESPN_SUMMARY_URL}?event=${event.id}`
          );
          const competitors = event.competitions?.[0]?.competitors || [];
          const away = competitors.find((c) => c.homeAway === "away")?.team
            ?.abbreviation;
          const home = competitors.find((c) => c.homeAway === "home")?.team
            ?.abbreviation;

          return {
            eventId: event.id,
            away,
            home,
            scoringPlays: summary.scoringPlays || [],
          };
        } catch (err) {
          console.error(
            `Error fetching ESPN summary for event ${event.id}:`,
            err
          );
          return { eventId: event.id, away: null, home: null, scoringPlays: [] };
        }
      })
    );

    const feed = [];
    for (const game of gamesByEvent) {
      for (const play of game.scoringPlays) {
        const matched = matchPlayer(play.text, players);
        if (!matched) continue;

        feed.push({
          id: play.id,
          gameId: game.eventId,
          awayTeam: game.away,
          homeTeam: game.home,
          awayScore: play.awayScore,
          homeScore: play.homeScore,
          period: play.period?.number || 0,
          clock: play.clock?.displayValue,
          clockSecondsRemaining: play.clock?.value ?? 0,
          scoringTeam: play.team?.abbreviation,
          text: play.text,
          playType: play.type?.text,
          scoringType: play.scoringType?.displayName,
          player: {
            sleeperId: matched.sleeperId,
            fn: matched.fn,
            ln: matched.ln,
            pos: matched.pos,
            team: matched.team,
            fantasyTeam: matched.fantasyTeam,
          },
        });
      }
    }

    // Chronological order across every game in this feed: each game's own
    // scoringPlays already come in order, so within the same period a lower
    // clock value is later in real time; across periods, a higher period
    // number is later. Cross-game interleaving is inherently approximate
    // without real timestamps (games run concurrently), so ties fall back
    // to fetch order.
    feed.sort((a, b) => {
      if (a.period !== b.period) return a.period - b.period;
      return b.clockSecondsRemaining - a.clockSecondsRemaining;
    });

    return res.status(200).json({ plays: feed });
  } catch (error) {
    console.error("Error building matchup feed:", error);
    return res.status(500).json({ message: "Failed to build matchup feed" });
  }
}
