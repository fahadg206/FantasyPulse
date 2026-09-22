import type { FeedPlay } from "./useBigPlayFeed";

// Basketball-style "run" and "comeback" detection, adapted to fantasy
// scoring plays instead of possessions: a run is a stretch of scoring
// plays that all go to one team while the other team scores nothing in
// between, and a comeback is a team that was down by a real margin at
// some point and still came out ahead (or at least closed the gap) by the
// end. Built on the same big-play feed data (lib/useBigPlayFeed.ts /
// backend.fetchMatchupFeed) already used for the live scoring toast - only
// the plays that feed already surfaces (TDs, field goals, turnovers with
// fantasy impact) count, the same way a real "run" call is about scoring
// plays, not every yard gained. Deliberately conservative about what
// counts as "significant" - these are meant to be the handful of
// storylines worth mentioning, not a play-by-play recap.

export interface FantasyRun {
  team: "team1" | "team2";
  points: number;
  playCount: number;
  players: string[];
}

export interface FantasyComeback {
  /** the team that was behind and still came out ahead (or tied it back up) */
  team: "team1" | "team2";
  deficitOvercome: number;
  finalMargin: number;
}

const MIN_RUN_POINTS = 12;
const MIN_COMEBACK_DEFICIT = 10;

export interface RunsAndComebacks {
  biggestRun: FantasyRun | null;
  comeback: FantasyComeback | null;
}

/**
 * `plays` is expected newest-first, exactly as backend.fetchMatchupFeed /
 * useBigPlayFeed return it - reversed internally to walk the game in the
 * order it actually happened.
 */
export function detectRunsAndComebacks(plays: FeedPlay[]): RunsAndComebacks {
  const chronological = [...plays]
    .reverse()
    .filter((p) => p.player && typeof p.pointsDelta === "number" && p.pointsDelta > 0);

  let team1Score = 0;
  let team2Score = 0;
  let maxDeficitTeam1 = 0; // biggest gap team1 ever faced (team2 ahead)
  let maxDeficitTeam2 = 0; // biggest gap team2 ever faced (team1 ahead)

  let currentRun: { team: "team1" | "team2"; points: number; playCount: number; players: Set<string> } | null = null;
  let biggestRun: FantasyRun | null = null;

  const closeRun = () => {
    if (!currentRun || currentRun.points < MIN_RUN_POINTS) return;
    if (!biggestRun || currentRun.points > biggestRun.points) {
      biggestRun = {
        team: currentRun.team,
        points: currentRun.points,
        playCount: currentRun.playCount,
        players: Array.from(currentRun.players),
      };
    }
  };

  for (const play of chronological) {
    const team = play.player.fantasyTeam;
    const delta = play.pointsDelta ?? 0;
    const playerName = `${play.player.fn} ${play.player.ln}`.trim();

    if (team === "team1") team1Score += delta;
    else team2Score += delta;

    maxDeficitTeam1 = Math.max(maxDeficitTeam1, team2Score - team1Score);
    maxDeficitTeam2 = Math.max(maxDeficitTeam2, team1Score - team2Score);

    if (!currentRun || currentRun.team !== team) {
      closeRun();
      currentRun = { team, points: delta, playCount: 1, players: new Set([playerName]) };
    } else {
      currentRun.points += delta;
      currentRun.playCount += 1;
      currentRun.players.add(playerName);
    }
  }
  closeRun();

  const finalMargin = team1Score - team2Score;
  let comeback: FantasyComeback | null = null;
  if (maxDeficitTeam1 >= MIN_COMEBACK_DEFICIT && finalMargin >= 0) {
    comeback = { team: "team1", deficitOvercome: Math.round(maxDeficitTeam1 * 10) / 10, finalMargin: Math.round(finalMargin * 10) / 10 };
  } else if (maxDeficitTeam2 >= MIN_COMEBACK_DEFICIT && finalMargin <= 0) {
    comeback = { team: "team2", deficitOvercome: Math.round(maxDeficitTeam2 * 10) / 10, finalMargin: Math.round(-finalMargin * 10) / 10 };
  }

  return { biggestRun, comeback };
}

/** first and last names only, comma-separated, capped at 2 - a run credits everyone involved but the recap shouldn't turn into a full roster dump */
function playerList(players: string[]): string {
  if (players.length <= 2) return players.join(" and ");
  return `${players.slice(0, 2).join(", ")}, and others`;
}

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * An ESPN-style recap paragraph for a final matchup - leads with the
 * result, then works in whatever's actually notable about how it
 * happened (a run, a comeback), falling back to a plain result sentence
 * when the game didn't have either. Team names are passed in already
 * resolved to team1/team2 so this stays agnostic to which side "team1"
 * even means.
 */
export function buildMatchupRecap(
  team1Name: string,
  team1Score: number,
  team2Name: string,
  team2Score: number,
  runsAndComebacks: RunsAndComebacks
): string {
  const p1 = team1Score.toFixed(2);
  const p2 = team2Score.toFixed(2);

  if (team1Score === team2Score) {
    return `🏈 FINAL: ${team1Name} and ${team2Name} finish knotted up at ${p1} apiece. A push nobody saw coming.`;
  }

  const winner = team1Score > team2Score ? team1Name : team2Name;
  const loser = team1Score > team2Score ? team2Name : team1Name;
  const winnerPts = team1Score > team2Score ? p1 : p2;
  const loserPts = team1Score > team2Score ? p2 : p1;
  const winnerKey = team1Score > team2Score ? "team1" : "team2";

  const lede = pick([
    `🏈 FINAL: ${winner} outlasts ${loser}, ${winnerPts} to ${loserPts}.`,
    `${winner} gets it done over ${loser}, ${winnerPts}-${loserPts}. Final.`,
    `Final score: ${winner} ${winnerPts}, ${loser} ${loserPts}.`,
    `${winner} closes it out, ${winnerPts}-${loserPts} over ${loser}.`,
  ]);

  const { biggestRun, comeback } = runsAndComebacks;

  // A comeback by the eventual winner is the headline storyline - more
  // relevant than a run by itself, since it explains the whole arc of the
  // game rather than just one stretch of it.
  if (comeback && comeback.team === winnerKey) {
    return `${lede} ${winner} trailed by as many as ${comeback.deficitOvercome} before turning it around to steal this one.`;
  }

  if (biggestRun) {
    const runTeam = biggestRun.team === "team1" ? team1Name : team2Name;
    const stretch = pick([
      `${runTeam} put together a ${biggestRun.points.toFixed(1)}-point stretch unanswered, powered by ${playerList(biggestRun.players)}.`,
      `The turning point was a ${biggestRun.points.toFixed(1)}-0 run for ${runTeam}, keyed by ${playerList(biggestRun.players)}.`,
      `${runTeam} ripped off ${biggestRun.points.toFixed(1)} unanswered points behind ${playerList(biggestRun.players)}.`,
    ]);
    return `${lede} ${stretch}`;
  }

  if (comeback) {
    // The losing team mounted a real comeback attempt but still came up
    // short - worth a mention, phrased as "not quite enough."
    const comebackTeam = comeback.team === "team1" ? team1Name : team2Name;
    return `${lede} ${comebackTeam} clawed back from down ${comeback.deficitOvercome}, but it wasn't enough.`;
  }

  return lede;
}
