"use client";

import React, { useEffect, useState } from "react";

interface FeedTeamInput {
  userId: string;
  name: string;
  starterSleeperIds: string[];
}

interface PlayerMeta {
  fn?: string;
  ln?: string;
  pos?: string;
  t?: string;
}

interface MatchupFeedProps {
  week: number;
  season: string | number;
  team1: FeedTeamInput;
  team2: FeedTeamInput;
  // loosely typed to match the weakly-typed playersData state it's fed
  // from in schedule/page.tsx
  playersData: { [sleeperId: string]: PlayerMeta };
}

interface FeedPlay {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  scoringTeam: string;
  text: string;
  playType: string;
  scoringType: string;
  player: {
    sleeperId: string;
    fn: string;
    ln: string;
    pos: string;
    team: string;
    fantasyTeam: "team1" | "team2";
  };
}

const FANTASY_TEAM_COLOR: Record<"team1" | "team2", string> = {
  team1: "#e45263",
  team2: "#af1222",
};

const MatchupFeed: React.FC<MatchupFeedProps> = ({
  week,
  season,
  team1,
  team2,
  playersData,
}) => {
  const [plays, setPlays] = useState<FeedPlay[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchFeed = async () => {
      setPlays(null);
      setError(false);

      const buildPlayers = (
        team: FeedTeamInput,
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

      if (players.length === 0) {
        setPlays([]);
        return;
      }

      try {
        const response = await fetch("/api/fetchMatchupFeed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week, season, players }),
        });
        if (!response.ok) throw new Error("feed request failed");
        const data = await response.json();
        if (!cancelled) setPlays(data.plays || []);
      } catch (err) {
        console.error("Error fetching matchup feed:", err);
        if (!cancelled) setError(true);
      }
    };

    fetchFeed();
    return () => {
      cancelled = true;
    };
  }, [week, season, team1, team2, playersData]);

  const teamName = (fantasyTeam: "team1" | "team2") =>
    fantasyTeam === "team1" ? team1.name : team2.name;

  if (error) {
    return (
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
        Couldn&apos;t load the play feed right now.
      </div>
    );
  }

  if (plays === null) {
    return (
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
        Loading scoring plays...
      </div>
    );
  }

  if (plays.length === 0) {
    return (
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
        No scoring plays yet from either team&apos;s starters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-[95vw] xl:w-[60vw] py-2">
      {plays.map((play) => (
        <div
          key={play.id}
          className="rounded-lg bg-[#d1d1d1] dark:bg-[#2a2a2a] p-3"
        >
          <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1">
            <span>
              {play.awayTeam} {play.awayScore}-{play.homeScore} {play.homeTeam}
            </span>
            <span>
              Q{play.period} {play.clock}
            </span>
          </div>
          <p className="font-bold text-sm mb-1">{play.playType}</p>
          <div className="flex items-center gap-2 mb-1">
            <img
              src={`https://sleepercdn.com/content/nfl/players/thumb/${play.player.sleeperId}.jpg`}
              alt={play.player.fn}
              className="w-8 h-8 rounded-full bg-slate-300 object-cover object-top"
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium">
                {play.player.fn} {play.player.ln}{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  {play.player.pos} · {play.player.team}
                </span>
              </span>
              <span
                className="text-[10px] font-semibold w-fit px-1.5 rounded-full text-white"
                style={{
                  backgroundColor: FANTASY_TEAM_COLOR[play.player.fantasyTeam],
                }}
              >
                {teamName(play.player.fantasyTeam)}
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {play.text}
          </p>
        </div>
      ))}
    </div>
  );
};

export default MatchupFeed;
