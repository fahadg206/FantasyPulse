import { backend } from "./api";
import type { Starter } from "./getMatchupData";
import { ensureSystemPost, getPriorInjuryPostCountForTeam, postExists } from "./posts";
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

interface TeamContext {
  name: string;
  starters: Starter[];
  /** this fantasy team's record entering this game - drives the "already X-Y" flavor line */
  record?: { wins: number; losses: number };
}

// A losing record worth calling out - "already 0-4" reads as a real jab;
// "already 2-1" doesn't. Needs at least 2 losses and a losing record to
// qualify, not just "not undefeated."
function strugglingLine(name: string, record?: { wins: number; losses: number }): string | undefined {
  if (!record || record.losses < 2 || record.losses <= record.wins) return undefined;
  return pick([
    `Tough break for an already ${record.wins}-${record.losses} ${name}.`,
    `Salt in the wound for a struggling ${record.wins}-${record.losses} ${name} squad.`,
    `As if a ${record.wins}-${record.losses} record wasn't bad enough for ${name}.`,
  ]);
}

function recurringInjuryLine(name: string): string {
  return pick([
    `The injury luck continues to not go ${name}'s way.`,
    `${name} just can't catch a break on the health front.`,
    `Another one for ${name} - they've caught the injury bug this year.`,
    `${name}'s medical bill is adding up this season.`,
  ]);
}

// Only the negative-impact events (freshly hurt, or confirmed done for the
// day) get the record/recurring-injury color commentary - "returned" is
// good news and doesn't need it, and "questionable"/"doubtful" are already
// uncertain enough on their own. When both a bad record and a repeat-injury
// history apply, the repeat-injury line wins (it's the more specific,
// more interesting fact) rather than stacking both into one long post.
function flavorLine(
  fantasyTeamName: string,
  record: { wins: number; losses: number } | undefined,
  priorInjuryCount: number
): string | undefined {
  if (priorInjuryCount > 0) return recurringInjuryLine(fantasyTeamName);
  return strugglingLine(fantasyTeamName, record);
}

function textFor(
  playType: string,
  playerName: string,
  nflTeam: string,
  pos: string | undefined,
  fantasyTeamName: string,
  flavor: string | undefined
): string {
  const whoNfl = pos ? `${nflTeam}'s ${playerName} (${pos})` : `${nflTeam}'s ${playerName}`;
  const base = (() => {
    switch (playType) {
      case "Injury":
        return pick([
          `🚑 ${whoNfl} was banged up on that play - ${fantasyTeamName} might have to go the rest of the game without him.`,
          `Uh oh - ${whoNfl} just went down for ${fantasyTeamName}. Not up yet.`,
          `${whoNfl} took a hit on that one - trainers are out, and ${fantasyTeamName} is watching closely.`,
        ]);
      case "Injury Questionable":
        return pick([
          `⚠️ ${whoNfl} is questionable to return - bad spot for ${fantasyTeamName}.`,
          `Update: ${whoNfl} is being labeled questionable to return. ${fantasyTeamName} is on notice.`,
        ]);
      case "Injury Doubtful":
        return pick([
          `⚠️ ${whoNfl} is now doubtful to return - ${fantasyTeamName} should plan like he's done.`,
          `Not looking good - ${whoNfl} is doubtful to return.`,
        ]);
      case "Injury Out":
        return pick([
          `❌ ${whoNfl} is out for the rest of the game. ${fantasyTeamName} has to play this one down a piece.`,
          `${whoNfl} won't be returning - done for the day, and ${fantasyTeamName} feels it.`,
        ]);
      case "Injury Return":
        return pick([
          `✅ ${nflTeam}'s ${playerName} has returned to the game - sigh of relief for ${fantasyTeamName}.`,
          `Good news for ${fantasyTeamName} - ${playerName} is back on the field.`,
          `${playerName} shook it off - back in action for ${nflTeam}. ${fantasyTeamName} breathes easier.`,
        ]);
      default:
        return `${whoNfl} - injury update for ${fantasyTeamName}.`;
    }
  })();

  return flavor ? `${base} ${flavor}` : base;
}

// Boogie's real-time injury wire, riding the same 15s live-scoring poll
// Matchup and Schedule already run - not a separate crawl. Only ever
// checks each team's STARTING lineup (team1.starters/team2.starters here
// come from starters_full_data, never the full roster - see
// buildMatchupFeedPlayers), so a bench player getting hurt never posts;
// only someone actually in this week's lineup does, which is the only
// case that's actually fantasy-relevant news. Posts straight to the
// league's own Feed (same leagueId-tagged ensureSystemPost every other
// Boogie post uses). ensureSystemPost's own existence check (keyed off
// each play's own id) means this is safe to call every poll tick without
// tracking "have I already posted this" here - the one thing that IS
// looked up each time is how many prior injury posts this specific
// fantasy team already has this season, to decide whether this reads as
// their first bit of bad luck or a pattern.
export async function ensureInjuryPostsForMatchup(params: {
  leagueId: string;
  week: number;
  season: string;
  matchupId: string;
  team1: TeamContext;
  team2: TeamContext;
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
    injuryPlays.map(async (play: any) => {
      const postId = `injury_${leagueId}_${week}_${play.id}`;
      // Skip the flavor lookup (an extra Firestore read) entirely for an
      // event that's already posted - this function gets called every
      // poll tick for as long as the game stays live, and most of those
      // ticks are re-checking events already handled on an earlier one.
      if (await postExists(postId).catch(() => false)) return;

      const team = play.player.fantasyTeam === "team1" ? team1 : team2;
      const name = `${play.player.fn} ${play.player.ln}`;
      const now = play.wallclockMs ?? Date.now();

      let flavor: string | undefined;
      // Only worth the extra read for the events that get flavor at all -
      // "returned"/"questionable"/"doubtful" don't use priorInjuryCount.
      if (play.playType === "Injury" || play.playType === "Injury Out") {
        try {
          const priorCount = await getPriorInjuryPostCountForTeam(leagueId, team.name, now);
          flavor = flavorLine(team.name, team.record, priorCount);
        } catch (error) {
          console.error("Error checking prior injury history:", error);
        }
      }

      const text = textFor(play.playType, name, play.player.team, play.player.pos, team.name, flavor);

      return ensureSystemPost({
        id: postId,
        text,
        leagueId,
        targetType: "matchup",
        targetId: `${week}:${matchupId}`,
        targetLabel: `${team1.name} vs ${team2.name} - Week ${week}`,
        injuryTeamName: team.name,
        createdAtMs: play.wallclockMs ?? undefined,
      }).catch((error) => console.error("Error posting injury update to feed:", error));
    })
  );
}
