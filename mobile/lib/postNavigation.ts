// Where a post's target pill (Feather icon + targetLabel, rendered by
// PostCard) actually navigates to, once tapped. Used to live duplicated
// three different ways across feed.tsx, profile/[username].tsx, and
// ProfileTabbedPosts.tsx (and was missing entirely on the post thread
// screen, app/post/[postId].tsx - tapping a target pill there did
// nothing) - centralized here so all four agree, and so a new post type
// only needs a case added in one place.
//
// Boogie's own analyst takes (targetType "analysis") aren't real Sleeper
// entities the way a matchup or trade is, so they don't have a natural
// entity id to carry in targetId - instead each one's ensureXPost writer
// (lib/boogieAnalyst.ts) encodes a small "kind:...rest" tag of its own
// choosing, and the switch below is the one place that format gets read
// back apart. Keep the two in sync when adding a new analyst post type.

import type { Post } from "./posts";

export interface PostTargetRoute {
  pathname: string;
  params: Record<string, string>;
}

export function getPostTargetRoute(post: Pick<Post, "targetType" | "targetId" | "leagueId">): PostTargetRoute | null {
  const { targetType, targetId, leagueId } = post;
  if (!targetType || !targetId || !leagueId) return null;

  if (targetType === "matchup") {
    const [week, matchupID] = targetId.split(":");
    if (!week || !matchupID) return null;
    return { pathname: "/league/[leagueID]/matchup", params: { leagueID: leagueId, week, matchupID } };
  }

  if (targetType === "trade") {
    return { pathname: "/league/[leagueID]/trades", params: { leagueID: leagueId } };
  }

  if (targetType === "waiver") {
    // The Trades tab only ever lists trades, not waiver moves - it would
    // be a dead end here. The waiver headliner's own targetId is the
    // acquiring manager's userId, so this goes straight to their profile.
    return { pathname: "/profile/manager/[sleeperUserId]", params: { sleeperUserId: targetId } };
  }

  if (targetType === "analysis") {
    const [kind, ...rest] = targetId.split(":");
    switch (kind) {
      case "sos":
        return { pathname: "/league/[leagueID]/strengthofschedule", params: { leagueID: leagueId } };
      case "playoffs":
        return { pathname: "/league/[leagueID]/standings", params: { leagueID: leagueId } };
      case "powerrank":
        return { pathname: "/league/[leagueID]/powerrankings", params: { leagueID: leagueId } };
      case "rematch":
      case "benchregret": {
        const [week, matchupID] = rest;
        if (!week || !matchupID) return null;
        return { pathname: "/league/[leagueID]/matchup", params: { leagueID: leagueId, week, matchupID } };
      }
      default:
        return null;
    }
  }

  return null;
}
