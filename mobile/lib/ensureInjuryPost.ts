import { backend } from "./api";
import type { Starter } from "./getMatchupData";
import { ensureSystemPost } from "./posts";
import { buildMatchupFeedPlayers } from "./matchupFeedPlayers";

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function injuredText(name: string, team: string, pos?: string): string {
  const who = pos ? `${team}'s ${name} (${pos})` : `${team}'s ${name}`;
  return pick([
    `🚑 ${who} was banged up on that play - trainers are out to check on him.`,
    `Uh oh - ${who} just went down. Not up yet.`,
    `${who} took a hit on that one and needs a look before he's back out there.`,
  ]);
}

function returnedText(name: string, team: string): string {
  return pick([
    `✅ ${team}'s ${name} has returned to the game.`,
    `Good news - ${name} is back on the field for ${team}.`,
    `${name} shook it off - back in action for ${team}.`,
  ]);
}

// Boogie's real-time injury wire, riding the same 15s live-scoring poll
// Matchup and Schedule already run - not a separate crawl. ESPN's live
// play-by-play carries exactly two structured injury events ("was injured
// during the play" and "has returned to the game" - see
// /api/fetchMatchupFeed.js), not the full vocabulary a broadcast uses
// ("questionable to return" is an official in-game designation ESPN
// doesn't expose here), so these two are what's actually reported rather
// than invented. ensureSystemPost's own existence check (keyed off each
// play's own id, which the server already makes unique per player+event)
// means this is safe to call every poll tick without tracking "have I
// already posted this" here.
export async function ensureInjuryPostsForMatchup(params: {
  leagueId: string;
  week: number;
  season: string;
  matchupId: string;
  team1: { name: string; starters: Starter[] };
  team2: { name: string; starters: Starter[] };
  playersData: Record<string, any>;
  scoringSettings: Record<string, number>;
}): Promise<void> {
  const { leagueId, week, season, matchupId, team1, team2, playersData, scoringSettings } = params;

  const players = buildMatchupFeedPlayers(team1.starters, team2.starters, playersData);
  if (players.length === 0) return;

  let feedData;
  try {
    feedData = await backend.fetchMatchupFeed(week, season, players, scoringSettings);
  } catch (error) {
    console.error("Error fetching matchup feed for injury check:", error);
    return;
  }

  const injuryPlays = (feedData.plays || []).filter(
    (p: any) => p.playType === "Injury" || p.playType === "Injury Return"
  );
  if (injuryPlays.length === 0) return;

  await Promise.all(
    injuryPlays.map((play: any) => {
      const name = `${play.player.fn} ${play.player.ln}`;
      const text =
        play.playType === "Injury"
          ? injuredText(name, play.player.team, play.player.pos)
          : returnedText(name, play.player.team);

      return ensureSystemPost({
        id: `injury_${leagueId}_${week}_${play.id}`,
        text,
        leagueId,
        targetType: "matchup",
        targetId: `${week}:${matchupId}`,
        targetLabel: `${team1.name} vs ${team2.name} - Week ${week}`,
        createdAtMs: play.wallclockMs ?? undefined,
      }).catch((error) => console.error("Error posting injury update to feed:", error));
    })
  );
}
