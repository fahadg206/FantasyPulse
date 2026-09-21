"use client";

import { useEffect, useRef, useState } from "react";

export interface BigPlayFeedTeamInput {
  userId: string;
  name: string;
  starterSleeperIds: string[];
}

export interface FeedPlay {
  id: string;
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  text: string;
  playType: string;
  pointsDelta: number | null;
  player: {
    sleeperId: string;
    fn: string;
    ln: string;
    pos: string;
    team: string;
    fantasyTeam: "team1" | "team2";
  };
}

interface PlayerMetaLookup {
  [sleeperId: string]: { fn?: string; ln?: string; pos?: string; t?: string };
}

interface UseBigPlayFeedArgs {
  week: number;
  season: string | number;
  team1: BigPlayFeedTeamInput;
  team2: BigPlayFeedTeamInput;
  playersData: PlayerMetaLookup;
  scoringSettings: { [stat: string]: number };
  pollIntervalMs?: number;
  enabled?: boolean;
}

// Polls /api/fetchMatchupFeed on an interval and surfaces newly-arrived
// plays (touchdowns, field goals, interceptions, lost fumbles) with their
// fantasy point impact, for triggering a toast/animation - without ever
// treating plays that already happened before the page was opened as "new".
export default function useBigPlayFeed({
  week,
  season,
  team1,
  team2,
  playersData,
  scoringSettings,
  pollIntervalMs = 30000,
  enabled = true,
}: UseBigPlayFeedArgs) {
  const [plays, setPlays] = useState<FeedPlay[]>([]);
  const [latestPlay, setLatestPlay] = useState<FeedPlay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const seenIds = new Set<string>();
    let isFirstFetch = true;

    const buildPlayers = (
      team: BigPlayFeedTeamInput,
      fantasyTeam: "team1" | "team2"
    ) =>
      (team.starterSleeperIds || [])
        .map((sleeperId) => {
          const meta = playersData[sleeperId];
          if (!meta || !meta.fn || !meta.ln || !meta.t) return null;
          return {
            sleeperId,
            fn: meta.fn,
            ln: meta.ln,
            pos: meta.pos,
            team: meta.t,
            fantasyTeam,
          };
        })
        .filter(Boolean);

    const players = [
      ...buildPlayers(team1, "team1"),
      ...buildPlayers(team2, "team2"),
    ];

    const poll = async () => {
      if (players.length === 0) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/fetchMatchupFeed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week, season, players, scoringSettings }),
        });
        if (!response.ok) throw new Error("feed request failed");
        const data = await response.json();
        if (cancelled) return;

        const incoming: FeedPlay[] = data.plays || [];

        if (!isFirstFetch) {
          const fresh = incoming.filter((p) => !seenIds.has(p.id));
          if (fresh.length > 0) {
            setLatestPlay(fresh[fresh.length - 1]);
          }
        }
        incoming.forEach((p) => seenIds.add(p.id));
        isFirstFetch = false;

        setPlays(incoming);
        setLoading(false);
      } catch (err) {
        console.error("Error polling big play feed:", err);
        setLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, season, team1.userId, team2.userId, enabled, pollIntervalMs]);

  return { plays, latestPlay, loading };
}
