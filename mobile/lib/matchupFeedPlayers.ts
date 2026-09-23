import type { Starter } from "./getMatchupData";

export interface MatchupFeedPlayer {
  sleeperId: string;
  fn: string;
  ln: string;
  pos?: string;
  team: string;
  fantasyTeam: "team1" | "team2";
}

// Shared by ensureMatchupRecap.ts and ensureInjuryPost.ts - both need the
// same "starters -> backend.fetchMatchupFeed's players param" shape, and
// both silently drop a starter ESPN/Sleeper data can't resolve a full name
// + team for (an empty slot, or a player id missing from this week's
// players payload) rather than sending a malformed entry the feed
// endpoint can't match against play-by-play text anyway.
export function buildMatchupFeedPlayers(
  team1Starters: Starter[],
  team2Starters: Starter[],
  playersData: Record<string, any>
): MatchupFeedPlayer[] {
  const buildTeam = (starters: Starter[], fantasyTeam: "team1" | "team2") =>
    starters
      .map((s): MatchupFeedPlayer | null => {
        if (!s.id) return null;
        const meta = playersData[s.id];
        if (!meta || !meta.fn || !meta.ln || !meta.t) return null;
        return { sleeperId: s.id, fn: meta.fn, ln: meta.ln, pos: meta.pos, team: meta.t, fantasyTeam };
      })
      .filter((p): p is MatchupFeedPlayer => p !== null);

  return [...buildTeam(team1Starters, "team1"), ...buildTeam(team2Starters, "team2")];
}
