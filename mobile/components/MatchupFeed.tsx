import { View, Text, Image, ActivityIndicator } from "react-native";
import { MotiView } from "moti";
import useBigPlayFeed, { BigPlayFeedTeamInput, FeedPlay } from "../lib/useBigPlayFeed";
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
  /** forces the dark card palette regardless of system color scheme - for
   * embedding in an always-dark header (matchup.tsx's ESPN-style banner)
   * instead of the light/dark-adaptive default */
  forceDark?: boolean;
}

const FANTASY_TEAM_COLOR: Record<"team1" | "team2", string> = {
  team1: "#e45263",
  team2: "#af1222",
};

// Mirrors src/app/components/MatchupFeed.tsx on the web app: a
// chronological feed of real NFL scoring plays and turnovers involving
// either team's starters, with each play's fantasy point delta shown.
export default function MatchupFeed({
  week,
  season,
  team1,
  team2,
  playersData,
  scoringSettings,
  forceDark = false,
}: MatchupFeedProps) {
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

  const cardBg = forceDark ? "bg-[#17171a]" : "bg-[#f2f2f2] dark:bg-[#1a1a1a]";
  const mutedText = forceDark ? "text-gray-400" : "text-gray-500 dark:text-gray-400";
  const bodyText = forceDark ? "text-gray-300" : "text-gray-600 dark:text-gray-300";
  const headlineText = forceDark ? "text-white" : "text-black dark:text-white";

  if (loading) {
    return (
      <View className="items-center py-6">
        <ActivityIndicator color="#af1222" />
        <Text className={`mt-2 text-xs ${mutedText}`}>Loading scoring plays...</Text>
      </View>
    );
  }

  if (plays.length === 0) {
    return (
      <View className="py-6">
        <Text className={`text-center text-xs ${mutedText}`}>
          No scoring plays yet from either team's starters.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2.5">
      <View className="items-end">
        <BigPlayToast play={latestPlay} />
      </View>
      {plays.map((play: FeedPlay) => {
        const isPositive = (play.pointsDelta ?? 0) >= 0;
        return (
          <MotiView
            key={play.id}
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 300 }}
            className={`flex-row rounded-2xl overflow-hidden ${cardBg}`}
          >
            {/* Team-colored accent bar, and points color, at a glance */}
            <View
              style={{
                backgroundColor: play.pointsDelta !== null
                  ? isPositive
                    ? "#22c55e"
                    : "#ef4444"
                  : FANTASY_TEAM_COLOR[play.player.fantasyTeam],
              }}
              className="w-[4px]"
            />
            <View className="flex-1 p-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className={`text-[10px] font-semibold ${mutedText}`}>
                  {play.awayTeam} {play.awayScore}-{play.homeScore} {play.homeTeam}
                </Text>
                <Text className={`text-[10px] ${mutedText}`}>
                  Q{play.period} {play.clock}
                </Text>
              </View>

              <View className="flex-row items-center gap-2.5">
                <Image
                  source={{
                    uri: `https://sleepercdn.com/content/nfl/players/thumb/${play.player.sleeperId}.jpg`,
                  }}
                  className="w-11 h-11 rounded-full bg-slate-300"
                />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between">
                    <Text className={`font-bold text-[13px] ${headlineText}`} numberOfLines={1}>
                      {play.playType}
                    </Text>
                    {play.pointsDelta !== null && (
                      <Text
                        className={`text-[15px] font-extrabold ${isPositive ? "text-green-500" : "text-red-500"}`}
                      >
                        {isPositive ? "+" : ""}
                        {play.pointsDelta.toFixed(1)}
                      </Text>
                    )}
                  </View>
                  <View className="flex-row items-center gap-1.5 mt-0.5">
                    <Text className={`text-[12px] font-semibold ${headlineText}`} numberOfLines={1}>
                      {play.player.fn} {play.player.ln}
                    </Text>
                    <Text className={`text-[10px] ${mutedText}`}>
                      {play.player.pos} · {play.player.team}
                    </Text>
                  </View>
                  <View
                    className="self-start px-1.5 py-0.5 rounded-full mt-1"
                    style={{ backgroundColor: FANTASY_TEAM_COLOR[play.player.fantasyTeam] }}
                  >
                    <Text className="text-[9px] font-bold text-white">{teamName(play.player.fantasyTeam)}</Text>
                  </View>
                </View>
              </View>

              <Text className={`text-[11px] mt-2 ${bodyText}`}>{play.text}</Text>
            </View>
          </MotiView>
        );
      })}
    </View>
  );
}
