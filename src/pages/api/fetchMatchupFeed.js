// pages/api/fetchMatchupFeed.js
//
// A per-fantasy-matchup "redzone" style feed: every real NFL scoring play
// (touchdown, field goal) AND turnover (interception thrown, fumble lost)
// involving a player rostered by either team in this matchup, merged across
// however many real games those players are spread across, in
// chronological order, with each play's fantasy point impact computed from
// the league's own scoring settings.
//
// There's no free source for this keyed directly off Sleeper or Dynasty
// Daddy - Sleeper's API has no live play-by-play, and Dynasty Daddy's own
// "Fantasy Redzone" feature runs on a paid third-party provider (Tank01).
// This uses ESPN's free, public (if undocumented) scoreboard/summary API
// instead, verified directly against live data rather than assumed:
//   - a game summary's top-level `scoringPlays` array is already exactly
//     the scoring plays for that game, in chronological order, with each
//     play's `text` leading with the scoring player's full name (e.g.
//     "Harrison Butker 40 Yd Field Goal", "Joshua Palmer 43 Yd pass from
//     Josh Allen").
//   - the full play-by-play (`drives.previous[].plays`, needed to find
//     turnovers that don't result in a defensive score, since those never
//     appear in scoringPlays) uses ABBREVIATED names instead ("J.Allen" not
//     "Josh Allen"), and a different text structure - handled separately.
//
// Scope: rushing/receiving/passing touchdowns, field goals, interceptions
// thrown, and lost fumbles. Two-point conversions, safeties, and
// interception/fumble-return touchdowns (which would need crediting a
// defense/IDP, not currently a supported roster concept here) are left out
// rather than guessed at.
import {
  computeRushingTouchdownPoints,
  computeReceivingTouchdownPoints,
  computePassingTouchdownPoints,
  computeFieldGoalPoints,
  computeInterceptionThrownPoints,
  computeFumbleLostPoints,
} from "@/lib/bigPlayPoints";

export const config = { maxDuration: 30 };

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

// Sleeper and ESPN don't always agree on team abbreviations - verified
// against both providers' live data: Washington is "WAS" in Sleeper's
// player data (what `players[].team` below is built from) but "WSH" in
// ESPN's scoreboard. Every other team matched exactly. Without this,
// Washington's games would never be recognized as relevant and its
// players would never appear in the feed.
function toSleeperAbbreviation(espnAbbreviation) {
  return espnAbbreviation === "WSH" ? "WAS" : espnAbbreviation;
}

function cleanNameString(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bjr\.?\b|\bsr\.?\b|\biii\b|\bii\b|\biv\b/g, "")
    .replace(/[.'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingParen(text) {
  return (text || "").replace(/^\([^)]*\)\s*/, "");
}

// --- full-name matching, for scoringPlays text ---

function extractLeadingName(text) {
  const match = (text || "").match(
    /^([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+)+?) \d/
  );
  return match ? match[1] : null;
}

function extractPasser(text) {
  const match = (text || "").match(
    /pass from ([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+)+?)(?:\s*\(|$)/
  );
  return match ? match[1] : null;
}

function extractYardage(text) {
  const match = (text || "").match(/(\d+)\s*Yd/);
  return match ? parseInt(match[1], 10) : null;
}

function matchPlayerByFullName(name, players) {
  if (!name) return null;
  const cleaned = cleanNameString(name);

  const exact = players.find(
    (p) => cleanNameString(`${p.fn} ${p.ln}`) === cleaned
  );
  if (exact) return exact;

  const lastNameToken = cleaned.split(" ").slice(-1)[0];
  const lastNameMatches = players.filter(
    (p) => cleanNameString(p.ln) === lastNameToken
  );
  return lastNameMatches.length === 1 ? lastNameMatches[0] : null;
}

// --- abbreviated-name matching ("J.Allen"), for full play-by-play text ---

function extractInterceptionPasser(text) {
  const stripped = stripLeadingParen(text);
  const match = stripped.match(/^([A-Z]\.[A-Za-z'-]+)\s+pass\s/i);
  return match ? match[1] : null;
}

function extractFumbler(text) {
  const stripped = stripLeadingParen(text);
  if (/\bpass\b/i.test(stripped)) {
    const match = stripped.match(
      /pass\s+\S+\s+\S+\s+to\s+([A-Z]\.[A-Za-z'-]+)/i
    );
    return match ? match[1] : null;
  }
  const match = stripped.match(/^([A-Z]\.[A-Za-z'-]+)/);
  return match ? match[1] : null;
}

function matchPlayerByAbbreviatedName(abbrevName, players) {
  const match = (abbrevName || "").match(/^([A-Za-z])\.([A-Za-z'-]+)$/);
  if (!match) return null;
  const [, initial, lastName] = match;
  const cleanedLast = cleanNameString(lastName);
  const candidates = players.filter(
    (p) =>
      p.fn?.[0]?.toLowerCase() === initial.toLowerCase() &&
      cleanNameString(p.ln) === cleanedLast
  );
  return candidates.length === 1 ? candidates[0] : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function buildPlayEntry({
  id,
  gameId,
  away,
  home,
  awayScore,
  homeScore,
  period,
  clockDisplay,
  clockSecondsRemaining,
  text,
  playType,
  player,
  pointsDelta,
}) {
  return {
    id,
    gameId,
    awayTeam: away,
    homeTeam: home,
    awayScore,
    homeScore,
    period: period || 0,
    clock: clockDisplay,
    clockSecondsRemaining: clockSecondsRemaining ?? 0,
    text,
    playType,
    player,
    pointsDelta: pointsDelta === undefined ? null : pointsDelta,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { week, season, players, scoringSettings } = req.body || {};

  if (!week || !season || !Array.isArray(players) || players.length === 0) {
    return res
      .status(400)
      .json({ message: "week, season, and players are required" });
  }
  const scoring = scoringSettings || {};

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
      return competitors.some((abbr) =>
        teamsInvolved.has(toSleeperAbbreviation(abbr))
      );
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

          const drives = [
            ...(summary.drives?.previous || []),
            ...(summary.drives?.current ? [summary.drives.current] : []),
          ];

          return {
            eventId: event.id,
            away,
            home,
            scoringPlays: summary.scoringPlays || [],
            plays: drives.flatMap((drive) => drive.plays || []),
          };
        } catch (err) {
          console.error(
            `Error fetching ESPN summary for event ${event.id}:`,
            err
          );
          return { eventId: event.id, away: null, home: null, scoringPlays: [], plays: [] };
        }
      })
    );

    const feed = [];

    for (const game of gamesByEvent) {
      // --- scoring plays: touchdowns and field goals ---
      for (const play of game.scoringPlays) {
        const scorer = matchPlayerByFullName(
          extractLeadingName(play.text),
          players
        );
        const yardage = extractYardage(play.text);
        const playType = play.type?.text;
        const base = {
          id: play.id,
          gameId: game.eventId,
          away: game.away,
          home: game.home,
          awayScore: play.awayScore,
          homeScore: play.homeScore,
          period: play.period?.number,
          clockDisplay: play.clock?.displayValue,
          clockSecondsRemaining: play.clock?.value,
          text: play.text,
          playType,
        };

        if (scorer && yardage !== null) {
          let pointsDelta = null;
          if (playType === "Rushing Touchdown") {
            pointsDelta = computeRushingTouchdownPoints(yardage, scoring);
          } else if (playType === "Passing Touchdown") {
            pointsDelta = computeReceivingTouchdownPoints(yardage, scoring);
          } else if (playType === "Field Goal Good") {
            pointsDelta = computeFieldGoalPoints(yardage, scoring);
          }

          if (pointsDelta !== null) {
            feed.push(
              buildPlayEntry({
                ...base,
                player: {
                  sleeperId: scorer.sleeperId,
                  fn: scorer.fn,
                  ln: scorer.ln,
                  pos: scorer.pos,
                  team: scorer.team,
                  fantasyTeam: scorer.fantasyTeam,
                },
                pointsDelta,
              })
            );
          }
        }

        // passing TD credit goes to a second, separately matched player
        if (playType === "Passing Touchdown" && yardage !== null) {
          const passer = matchPlayerByFullName(
            extractPasser(play.text),
            players
          );
          if (passer) {
            feed.push(
              buildPlayEntry({
                ...base,
                player: {
                  sleeperId: passer.sleeperId,
                  fn: passer.fn,
                  ln: passer.ln,
                  pos: passer.pos,
                  team: passer.team,
                  fantasyTeam: passer.fantasyTeam,
                },
                pointsDelta: computePassingTouchdownPoints(yardage, scoring),
              })
            );
          }
        }
      }

      // --- turnovers: interceptions thrown and lost fumbles ---
      for (const play of game.plays) {
        const playType = play.type?.text;
        const base = {
          id: play.id,
          gameId: game.eventId,
          away: game.away,
          home: game.home,
          awayScore: play.awayScore,
          homeScore: play.homeScore,
          period: play.period?.number,
          clockDisplay: play.clock?.displayValue,
          clockSecondsRemaining: play.clock?.value,
          text: play.text,
          playType,
        };

        if (playType === "Pass Interception Return") {
          const passer = matchPlayerByAbbreviatedName(
            extractInterceptionPasser(play.text),
            players
          );
          if (passer) {
            feed.push(
              buildPlayEntry({
                ...base,
                player: {
                  sleeperId: passer.sleeperId,
                  fn: passer.fn,
                  ln: passer.ln,
                  pos: passer.pos,
                  team: passer.team,
                  fantasyTeam: passer.fantasyTeam,
                },
                pointsDelta: computeInterceptionThrownPoints(scoring),
              })
            );
          }
        } else if (playType === "Fumble Recovery (Opponent)") {
          const fumbler = matchPlayerByAbbreviatedName(
            extractFumbler(play.text),
            players
          );
          if (fumbler) {
            feed.push(
              buildPlayEntry({
                ...base,
                player: {
                  sleeperId: fumbler.sleeperId,
                  fn: fumbler.fn,
                  ln: fumbler.ln,
                  pos: fumbler.pos,
                  team: fumbler.team,
                  fantasyTeam: fumbler.fantasyTeam,
                },
                pointsDelta: computeFumbleLostPoints(scoring),
              })
            );
          }
        }
      }
    }

    // Newest first, like a real feed (and like the reference screenshot -
    // its top item was an OT play, the most recent thing that happened).
    // Within the same period a lower clock value is later in real time;
    // across periods, a higher period number is later - period 5 is OT,
    // which comes after all of regulation, so it belongs at the top, not
    // the bottom. Cross-game interleaving is inherently approximate
    // without real timestamps (games run concurrently), so ties fall back
    // to fetch order.
    feed.sort((a, b) => {
      if (a.period !== b.period) return b.period - a.period;
      return a.clockSecondsRemaining - b.clockSecondsRemaining;
    });

    return res.status(200).json({ plays: feed });
  } catch (error) {
    console.error("Error building matchup feed:", error);
    return res.status(500).json({ message: "Failed to build matchup feed" });
  }
}
