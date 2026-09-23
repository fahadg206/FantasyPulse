import { backend } from "./api";
import type { Starter } from "./getMatchupData";
import { ensureSystemPost } from "./posts";
import { buildMatchupFeedPlayers } from "./matchupFeedPlayers";

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

const INJURY_PLAY_TYPES = new Set([
  "Injury",
  "Injury Questionable",
  "Injury Doubtful",
  "Injury Out",
  "Injury Return",
]);

// Boogie's voice per status. "Injury" and "Injury Return" are confirmed
// against real completed-game play-by-play text (see the matching comment
// in /api/fetchMatchupFeed.js); the Questionable/Doubtful/Out ones are
// real in-game designations ESPN/broadcasts use, wired up defensively in
// case they show up in ESPN's live text the same way - not verified live
// (no game was in progress while this shipped), but harmless if they
// never actually match anything.
function textFor(playType: string, name: string, team: string, pos?: string): string {
  const who = pos ? `${team}'s ${name} (${pos})` : `${team}'s ${name}`;
  switch (playType) {
    case "Injury":
      return pick([
        `🚑 ${who} was banged up on that play - trainers are out to check on him.`,
        `Uh oh - ${who} just went down. Not up yet.`,
        `${who} took a hit on that one and needs a look before he's back out there.`,
      ]);
    case "Injury Questionable":
      return pick([
        `⚠️ ${who} is questionable to return.`,
        `Update: ${who} is being labeled questionable to return.`,
      ]);
    case "Injury Doubtful":
      return pick([
        `⚠️ ${who} is now doubtful to return.`,
        `Not looking good - ${who} is doubtful to return.`,
      ]);
    case "Injury Out":
      return pick([
        `❌ ${who} is out for the rest of the game.`,
        `${who} won't be returning - done for the day.`,
      ]);
    case "Injury Return":
      return pick([
        `✅ ${team}'s ${name} has returned to the game.`,
        `Good news - ${name} is back on the field for ${team}.`,
        `${name} shook it off - back in action for ${team}.`,
      ]);
    default:
      return `${who} - injury update.`;
  }
}

// Boogie's real-time injury wire, riding the same 15s live-scoring poll
// Matchup and Schedule already run - not a separate crawl. Posts straight
// to the league's own Feed (same leagueId-tagged ensureSystemPost every
// other Boogie post uses - trades, final scores - so it shows up exactly
// where those do, via getFeedPostsForLeague). ensureSystemPost's own
// existence check (keyed off each play's own id, which the server already
// makes unique per player+status) means this is safe to call every poll
// tick without tracking "have I already posted this" here.
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

  const injuryPlays = (feedData.plays || []).filter((p: any) => INJURY_PLAY_TYPES.has(p.playType));
  if (injuryPlays.length === 0) return;

  await Promise.all(
    injuryPlays.map((play: any) => {
      const name = `${play.player.fn} ${play.player.ln}`;
      const text = textFor(play.playType, name, play.player.team, play.player.pos);

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
