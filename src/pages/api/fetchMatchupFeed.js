// pages/api/fetchMatchupFeed.js
//
// A per-fantasy-matchup "redzone" style feed: every real NFL play worth at
// least 5 fantasy points to a player rostered by either team in this
// matchup - not just touchdowns - plus turnovers (interceptions thrown,
// lost fumbles) regardless of point value, merged across however many real
// games those players are spread across, in chronological order, with each
// play's fantasy point impact computed from the league's own scoring
// settings.
//
// There's no free source for this keyed directly off Sleeper or Dynasty
// Daddy - Sleeper's API has no live play-by-play, and Dynasty Daddy's own
// "Fantasy Redzone" feature runs on a paid third-party provider (Tank01).
// This uses ESPN's free, public (if undocumented) scoreboard/summary API
// instead, verified directly against live data rather than assumed: the
// full play-by-play (`drives.previous[]/current.plays`) covers every play
// type used below - Rush, Pass Reception, Rushing/Passing Touchdown, Field
// Goal Good, Pass Interception Return, Fumble Recovery (Opponent) - each
// with a real `statYardage` number (not just parseable from `text`) and a
// real `wallclock` ISO timestamp, and abbreviated player names ("J.Allen")
// in a small number of consistent text shapes.
//
// Scope: rushing/receiving/passing yardage (touchdown or not), field
// goals, interceptions thrown, and lost fumbles. Two-point conversions,
// safeties, and interception/fumble-return touchdowns (which would need
// crediting a defense/IDP, not currently a supported roster concept here)
// are left out rather than guessed at.
//
// Also scans every play's text (not just the scoring-play types above) for
// ESPN's own injury commentary, which rides along inside an otherwise
// ordinary play's `text` rather than being its own play type - verified
// live against real mid-game text: "MIA-M.Washington was injured during
// the play." and, later, "** Injury Update: MIA-M.Washington has returned
// to the game." Surfaced as playType "Injury" / "Injury Return" with no
// pointsDelta (there isn't one). This is real, structured in-game
// commentary - not the separate pre-game weekly injury report (which
// ESPN's summary endpoint exposes as a different `injuries` field entirely
// and uses Questionable/Doubtful/Out, not these two events).
const INJURED_RE = /([A-Z]{2,3})-([A-Z]\.[A-Za-z'-]+) was injured during the play/g;
const RETURNED_RE = /\*\* Injury Update: ([A-Z]{2,3})-([A-Z]\.[A-Za-z'-]+) has returned to the game/g;
import {
  computeRushPoints,
  computeReceptionPoints,
  computePassPoints,
  computeFieldGoalPoints,
  computeInterceptionThrownPoints,
  computeFumbleLostPoints,
} from "@/lib/bigPlayPoints";

export const config = { maxDuration: 30 };

// Below this, a gain-type play (a run, a catch, a completion) isn't worth
// surfacing as its own feed item - still lets ordinary touchdowns and long
// gains through, just not every 3-yard dump-off. Turnovers are exempt:
// those are worth knowing about regardless of the league's exact
// interception/fumble penalty value.
const MIN_GAIN_POINTS = 5;

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

// --- abbreviated-name extraction ("J.Allen"), from the full play-by-play's
// text - verified live against real plays of every type this route reads:
//   Rush:                "K.Williams left end to LA 26 for 4 yards (...)"
//   Field Goal Good:     "J.Bates 31 yard field goal is GOOD, ..."
//   Rushing Touchdown:   "(No Huddle) J.Allen left guard for 1 yard, TOUCHDOWN...."
//   Pass Reception:      "J.Allen pass short left to K.Shakir pushed ob at ... for 9 yards (...)"
//   Passing Touchdown:   "(Shotgun) J.Allen pass deep middle to J.Palmer for 43 yards, TOUCHDOWN..."
//   Pass Interception Return / Fumble Recovery (Opponent): same shapes as above

/** the ball carrier / kicker - the leading name, for any non-pass play */
function extractLeadingName(text) {
  const stripped = stripLeadingParen(text);
  const match = stripped.match(/^([A-Z]\.[A-Za-z'-]+)/);
  return match ? match[1] : null;
}

/** the passer, for any passing play (completion, incompletion, TD, or interception) */
function extractPasserName(text) {
  const stripped = stripLeadingParen(text);
  const match = stripped.match(/^([A-Z]\.[A-Za-z'-]+)\s+pass\s/i);
  return match ? match[1] : null;
}

/** the receiver, for a completed pass ("pass <depth> <direction> to NAME") */
function extractReceiverName(text) {
  const stripped = stripLeadingParen(text);
  const match = stripped.match(/pass\s+\S+\s+\S+\s+to\s+([A-Z]\.[A-Za-z'-]+)/i);
  return match ? match[1] : null;
}

/** whoever lost the ball on a fumble - the receiver if it happened on a pass play, the leading name (rusher) otherwise */
function extractFumbler(text) {
  const stripped = stripLeadingParen(text);
  if (/\bpass\b/i.test(stripped)) {
    return extractReceiverName(text);
  }
  return extractLeadingName(text);
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

// Injury commentary includes the team abbreviation right in the text
// ("MIA-M.Washington"), unlike every other play type's bare "M.Washington"
// - matched on team + name here rather than name alone, which is actually
// more precise than matchPlayerByAbbreviatedName above (no ambiguity
// possible between two same-initial-and-lastname players on different
// teams).
function matchPlayerByTeamAndAbbreviatedName(teamAbbr, abbrevName, players) {
  const match = (abbrevName || "").match(/^([A-Za-z])\.([A-Za-z'-]+)$/);
  if (!match) return null;
  const [, initial, lastName] = match;
  const cleanedLast = cleanNameString(lastName);
  const sleeperTeam = toSleeperAbbreviation(teamAbbr);
  const candidates = players.filter(
    (p) =>
      p.team === sleeperTeam &&
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
  wallclockMs,
  text,
  playType,
  player,
  pointsDelta,
}) {
  return {
    id: `${id}_${player.sleeperId}`,
    gameId,
    awayTeam: away,
    homeTeam: home,
    awayScore,
    homeScore,
    period: period || 0,
    clock: clockDisplay,
    clockSecondsRemaining: clockSecondsRemaining ?? 0,
    wallclockMs: wallclockMs ?? null,
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
            plays: drives.flatMap((drive) => drive.plays || []),
          };
        } catch (err) {
          console.error(
            `Error fetching ESPN summary for event ${event.id}:`,
            err
          );
          return { eventId: event.id, away: null, home: null, plays: [] };
        }
      })
    );

    const feed = [];

    for (const game of gamesByEvent) {
      for (const play of game.plays) {
        const playType = play.type?.text;
        const yardage = play.statYardage ?? 0;
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
          wallclockMs: play.wallclock ? Date.parse(play.wallclock) : null,
          text: play.text,
          playType,
        };

        const pushGainCredit = (matchedPlayer, pointsDelta) => {
          if (!matchedPlayer || Math.abs(pointsDelta) < MIN_GAIN_POINTS) return;
          feed.push(
            buildPlayEntry({
              ...base,
              player: {
                sleeperId: matchedPlayer.sleeperId,
                fn: matchedPlayer.fn,
                ln: matchedPlayer.ln,
                pos: matchedPlayer.pos,
                team: matchedPlayer.team,
                fantasyTeam: matchedPlayer.fantasyTeam,
              },
              pointsDelta,
            })
          );
        };

        const pushTurnoverCredit = (matchedPlayer, pointsDelta) => {
          if (!matchedPlayer) return;
          feed.push(
            buildPlayEntry({
              ...base,
              player: {
                sleeperId: matchedPlayer.sleeperId,
                fn: matchedPlayer.fn,
                ln: matchedPlayer.ln,
                pos: matchedPlayer.pos,
                team: matchedPlayer.team,
                fantasyTeam: matchedPlayer.fantasyTeam,
              },
              pointsDelta,
            })
          );
        };

        if (playType === "Rush" || playType === "Rushing Touchdown") {
          const isTd = playType === "Rushing Touchdown";
          const rusher = matchPlayerByAbbreviatedName(extractLeadingName(play.text), players);
          pushGainCredit(rusher, computeRushPoints(yardage, isTd, scoring));
        } else if (playType === "Pass Reception" || playType === "Passing Touchdown") {
          const isTd = playType === "Passing Touchdown";
          const receiver = matchPlayerByAbbreviatedName(extractReceiverName(play.text), players);
          pushGainCredit(receiver, computeReceptionPoints(yardage, isTd, scoring));
          const passer = matchPlayerByAbbreviatedName(extractPasserName(play.text), players);
          pushGainCredit(passer, computePassPoints(yardage, isTd, scoring));
        } else if (playType === "Field Goal Good") {
          const kicker = matchPlayerByAbbreviatedName(extractLeadingName(play.text), players);
          pushGainCredit(kicker, computeFieldGoalPoints(yardage, scoring));
        } else if (playType === "Pass Interception Return") {
          const passer = matchPlayerByAbbreviatedName(extractPasserName(play.text), players);
          pushTurnoverCredit(passer, computeInterceptionThrownPoints(scoring));
        } else if (playType === "Fumble Recovery (Opponent)") {
          const fumbler = matchPlayerByAbbreviatedName(extractFumbler(play.text), players);
          pushTurnoverCredit(fumbler, computeFumbleLostPoints(scoring));
        }

        // Injury commentary rides along inside whatever play it happened
        // on (a run, a penalty, anything) rather than being its own play
        // type, so this runs unconditionally on every play's text, not
        // just the scoring types handled above. A single play's text can
        // carry more than one of these (someone hurt earlier in the drive
        // returning on this play, plus someone new going down on it), so
        // every match is walked, not just the first.
        for (const m of play.text.matchAll(INJURED_RE)) {
          const [, teamAbbr, name] = m;
          const player = matchPlayerByTeamAndAbbreviatedName(teamAbbr, name, players);
          if (!player) continue;
          feed.push(
            buildPlayEntry({
              ...base,
              id: `${base.id}_injured`,
              text: `${player.team}-${player.fn[0]}.${player.ln} was injured during the play.`,
              playType: "Injury",
              player: {
                sleeperId: player.sleeperId,
                fn: player.fn,
                ln: player.ln,
                pos: player.pos,
                team: player.team,
                fantasyTeam: player.fantasyTeam,
              },
              pointsDelta: null,
            })
          );
        }
        for (const m of play.text.matchAll(RETURNED_RE)) {
          const [, teamAbbr, name] = m;
          const player = matchPlayerByTeamAndAbbreviatedName(teamAbbr, name, players);
          if (!player) continue;
          feed.push(
            buildPlayEntry({
              ...base,
              id: `${base.id}_returned`,
              text: `${player.team}-${player.fn[0]}.${player.ln} has returned to the game.`,
              playType: "Injury Return",
              player: {
                sleeperId: player.sleeperId,
                fn: player.fn,
                ln: player.ln,
                pos: player.pos,
                team: player.team,
                fantasyTeam: player.fantasyTeam,
              },
              pointsDelta: null,
            })
          );
        }
      }
    }

    // Newest first, like a real feed. Sorted by each play's real wallclock
    // timestamp, not period/clock - a matchup's players are spread across
    // multiple real games running concurrently or at different times of
    // day, and one game's own Q1 isn't comparable to another game's Q4 the
    // way period+clock assumes. wallclockMs is only missing if ESPN's data
    // itself didn't have it for that specific play (rare - verified live
    // before shipping this), in which case it falls back to the old
    // period/clock comparison against just the other plays missing it, and
    // sorts behind every play that does have a real timestamp.
    feed.sort((a, b) => {
      if (a.wallclockMs !== null && b.wallclockMs !== null) {
        return b.wallclockMs - a.wallclockMs;
      }
      if (a.wallclockMs !== null) return -1;
      if (b.wallclockMs !== null) return 1;
      if (a.period !== b.period) return b.period - a.period;
      return a.clockSecondsRemaining - b.clockSecondsRemaining;
    });

    return res.status(200).json({ plays: feed });
  } catch (error) {
    console.error("Error building matchup feed:", error);
    return res.status(500).json({ message: "Failed to build matchup feed" });
  }
}
