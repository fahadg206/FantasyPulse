"use client";

import React from "react";
import useBigPlayFeed, { BigPlayFeedTeamInput } from "../libs/useBigPlayFeed";
import BigPlayToast from "./BigPlayToast";

interface PlayerMeta {
  fn?: string;
  ln?: string;
  pos?: string;
  t?: string;
}

interface MatchupBigPlayWatcherProps {
  week: number;
  season: string | number;
  team1: BigPlayFeedTeamInput;
  team2: BigPlayFeedTeamInput;
  playersData: { [sleeperId: string]: PlayerMeta };
  scoringSettings: { [stat: string]: number };
  enabled?: boolean;
}

// A standalone watcher so a matchup card can get big-play toast
// notifications (a new touchdown/turnover for its starters) without the
// full Feed list being open - it's its own component purely so it can call
// useBigPlayFeed safely once per matchup card rendered in a list.
const MatchupBigPlayWatcher: React.FC<MatchupBigPlayWatcherProps> = ({
  week,
  season,
  team1,
  team2,
  playersData,
  scoringSettings,
  enabled = true,
}) => {
  const { latestPlay } = useBigPlayFeed({
    week,
    season,
    team1,
    team2,
    playersData,
    scoringSettings,
    enabled,
  });

  return <BigPlayToast play={latestPlay} />;
};

export default MatchupBigPlayWatcher;
