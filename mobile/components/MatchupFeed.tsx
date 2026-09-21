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

  if (loading) {
    return (
      <View className="items-center py-6">
        <ActivityIndicator color="#af1222" />
        <Text className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Loading scoring plays...
        </Text>
      </View>
    );
  }

  if (plays.length === 0) {
    return (
      <View className="py-6">
        <Text className="text-center text-xs text-gray-500 dark:text-gray-400">
          No scoring plays yet from either team's starters.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2 py-2">
      <View className="items-end">
        <BigPlayToast play={latestPlay} />
      </View>
      {plays.map((play: FeedPlay) => (
        <MotiView
          key={play.id}
          from={{ opacity: 0, translateY: -12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: 300 }}
          className="rounded-xl bg-[#f2f2f2] dark:bg-[#1a1a1a] p-3"
        >
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">
              {play.awayTeam} {play.awayScore}-{play.homeScore} {play.homeTeam}
            </Text>
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">
              Q{play.period} {play.clock}
            </Text>
          </View>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="font-bold text-sm text-black dark:text-white">
              {play.playType}
            </Text>
            {play.pointsDelta !== null && (
              <Text
                className={`text-sm font-bold ${
                  play.pointsDelta >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {play.pointsDelta >= 0 ? "+" : ""}
                {play.pointsDelta.toFixed(1)}
              </Text>
            )}
          </View>
          <View className="flex-row items-center gap-2 mb-1">
            <Image
              source={{
                uri: `https://sleepercdn.com/content/nfl/players/thumb/${play.player.sleeperId}.jpg`,
              }}
              className="w-8 h-8 rounded-full bg-slate-300"
            />
            <View>
              <Text className="text-xs font-medium text-black dark:text-white">
                {play.player.fn} {play.player.ln}{" "}
                <Text className="text-gray-500 dark:text-gray-400">
                  {play.player.pos} · {play.player.team}
                </Text>
              </Text>
              <Text
                className="text-[10px] font-semibold self-start px-1.5 rounded-full text-white mt-0.5 overflow-hidden"
                style={{ backgroundColor: FANTASY_TEAM_COLOR[play.player.fantasyTeam] }}
              >
                {teamName(play.player.fantasyTeam)}
              </Text>
            </View>
          </View>
          <Text className="text-xs text-gray-600 dark:text-gray-300">{play.text}</Text>
        </MotiView>
      ))}
    </View>
  );
}
