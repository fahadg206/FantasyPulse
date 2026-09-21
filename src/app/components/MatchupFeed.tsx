"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import useBigPlayFeed, {
  BigPlayFeedTeamInput,
  FeedPlay,
} from "../libs/useBigPlayFeed";
import BigPlayToast from "./BigPlayToast";

interface PlayerMeta {
  fn?: string;
  ln?: string;
  pos?: string;
  t?: string;
}

interface MatchupFeedProps {
  week: number;
  season: string | number;
  team1: BigPlayFeedTeamInput;
  team2: BigPlayFeedTeamInput;
  playersData: { [sleeperId: string]: PlayerMeta };
  scoringSettings: { [stat: string]: number };
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
  scoringSettings,
}) => {
  const { plays, latestPlay, loading } = useBigPlayFeed({
    week,
    season,
    team1,
    team2,
    playersData,
    scoringSettings,
  });

  const teamName = (fantasyTeam: "team1" | "team2") =>
    fantasyTeam === "team1" ? team1.name : team2.name;

  if (loading) {
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
      <div className="flex justify-end">
        <BigPlayToast play={latestPlay} />
      </div>
      <AnimatePresence initial={false}>
        {plays.map((play: FeedPlay) => (
          <motion.div
            key={play.id}
            layout
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-lg bg-[#d1d1d1] dark:bg-[#2a2a2a] p-3"
          >
            <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1">
              <span>
                {play.awayTeam} {play.awayScore}-{play.homeScore}{" "}
                {play.homeTeam}
              </span>
              <span>
                Q{play.period} {play.clock}
              </span>
            </div>
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-sm">{play.playType}</p>
              {play.pointsDelta !== null && (
                <span
                  className={`text-sm font-bold ${
                    play.pointsDelta >= 0 ? "text-green-500" : "text-red-500"
                  }`}
                >
                  {play.pointsDelta >= 0 ? "+" : ""}
                  {play.pointsDelta.toFixed(1)}
                </span>
              )}
            </div>
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
                    backgroundColor:
                      FANTASY_TEAM_COLOR[play.player.fantasyTeam],
                  }}
                >
                  {teamName(play.player.fantasyTeam)}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {play.text}
            </p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default MatchupFeed;
