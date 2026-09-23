import { backend } from "./api";
import type { Starter } from "./getMatchupData";
import { ensureSystemPost } from "./posts";
import { finalScoreText } from "./announceTransactions";
import { detectRunsAndComebacks, buildMatchupRecap } from "./runsAndComebacks";

// Posts a matchup's final-score recap into the feed - extracted out of the
// Matchup detail screen, which used to be the ONLY place this ever ran.
// That meant a recap only ever appeared the first time someone happened to
// open that one specific matchup's own detail page after it went final -
// if nobody clicked into it, no recap, no matter how long ago the game
// actually ended. ensureSystemPost is already a no-op if a recap for this
// matchup exists, so this is safe to call from anywhere a final matchup is
// visible (both the detail screen and, now, the Schedule screen, which
// shows a whole week's games at once and is what people actually open) -
// whichever screen someone opens first is the one that posts it.
export async function ensureMatchupRecapPosted(params: {
  leagueId: string;
  week: number;
  season: string;
  matchupId: string;
  team1: { name: string; points: number; avatar?: string; starters: Starter[] };
  team2: { name: string; points: number; avatar?: string; starters: Starter[] };
  playersData: Record<string, any>;
  scoringSettings: Record<string, number>;
}): Promise<void> {
  const { leagueId, week, season, matchupId, team1, team2, playersData, scoringSettings } = params;

  const buildPlayers = (starters: Starter[], fantasyTeam: "team1" | "team2") =>
    starters
      .map((s) => {
        if (!s.id) return null;
        const meta = playersData[s.id];
        if (!meta || !meta.fn || !meta.ln || !meta.t) return null;
        return { sleeperId: s.id, fn: meta.fn, ln: meta.ln, pos: meta.pos, team: meta.t, fantasyTeam };
      })
      .filter(Boolean);
  const players = [...buildPlayers(team1.starters, "team1"), ...buildPlayers(team2.starters, "team2")];

  let text = finalScoreText(team1.name, team1.points, team2.name, team2.points);
  if (players.length > 0) {
    try {
      const feedData = await backend.fetchMatchupFeed(week, season, players, scoringSettings);
      const runsAndComebacks = detectRunsAndComebacks(feedData.plays || []);
      text = buildMatchupRecap(team1.name, team1.points, team2.name, team2.points, runsAndComebacks);
    } catch (error) {
      console.error("Error building matchup recap:", error);
    }
  }

  await ensureSystemPost({
    id: `matchup_${leagueId}_${week}_${matchupId}`,
    text,
    matchupCard: {
      leagueId,
      week,
      team1Name: team1.name,
      team1Score: team1.points,
      team1Avatar: team1.avatar,
      team2Name: team2.name,
      team2Score: team2.points,
      team2Avatar: team2.avatar,
      isFinal: true,
    },
    leagueId,
    targetType: "matchup",
    targetId: `${week}:${matchupId}`,
    targetLabel: `${team1.name} vs ${team2.name} - Week ${week}`,
  });
}
