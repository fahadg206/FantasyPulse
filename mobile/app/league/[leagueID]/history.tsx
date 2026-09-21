import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getLeagueHistory, SeasonHistory } from "../../../lib/getLeagueHistory";
import PlayoffBracket from "../../../components/PlayoffBracket";

const helmet = require("../../../assets/images/helmet2.png");

const FINISH_MEDAL: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  champion: { icon: "trophy", color: "#eab308" },
  runnerUp: { icon: "medal", color: "#cbd5e1" },
  thirdPlace: { icon: "medal", color: "#d08a4f" },
};

function SeasonCard({ season }: { season: SeasonHistory }) {
  return (
    <View className="bg-[#141416] border border-white/10 rounded-2xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-white font-bold text-[15px]">{season.season} Season</Text>
        <Text numberOfLines={1} className="text-gray-500 text-[11px] max-w-[140px]">
          {season.leagueName}
        </Text>
      </View>
      <View className="flex-row justify-around">
        {(["champion", "runnerUp", "thirdPlace"] as const).map((key) => {
          const team = season[key];
          if (!team) return null;
          const medal = FINISH_MEDAL[key];
          return (
            <View key={key} className="items-center flex-1">
              <View className="relative">
                <Image
                  source={team.avatar ? { uri: team.avatar } : helmet}
                  style={{ borderColor: medal.color }}
                  className="w-[44px] h-[44px] rounded-full border-2"
                />
                <View
                  style={{ backgroundColor: medal.color }}
                  className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full items-center justify-center border-2 border-[#141416]"
                >
                  <Ionicons name={medal.icon} size={9} color="#0c0c0e" />
                </View>
              </View>
              <Text numberOfLines={1} className="text-white text-[11px] font-semibold mt-1.5 max-w-[90px] text-center">
                {team.name}
              </Text>
              <Text className="text-gray-500 text-[9px] font-bold tracking-wide">
                {key === "champion" ? "CHAMPION" : key === "runnerUp" ? "RUNNER-UP" : "3RD PLACE"}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function LeagueHistoryScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [history, setHistory] = useState<SeasonHistory[] | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    getLeagueHistory(leagueID)
      .then((result) => {
        if (!cancelled) setHistory(result);
      })
      .catch((error) => {
        console.error("Error loading league history:", error);
        if (!cancelled) setHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4">
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">LEAGUE HISTORY</Text>
      <Text className="text-white text-[20px] font-bold mb-5">Champions &amp; Records</Text>

      <Text className="text-[13px] font-bold tracking-wider text-gray-500 mb-3">CURRENT PLAYOFF BRACKET</Text>
      <View className="bg-[#0c0c0e] -mx-4 px-4 mb-6">
        <PlayoffBracket leagueID={leagueID} />
      </View>

      <Text className="text-[13px] font-bold tracking-wider text-gray-500 mb-3">CHAMPIONS TIMELINE</Text>
      {history === null ? (
        <ActivityIndicator color="#af1222" className="mt-4" />
      ) : history.length === 0 ? (
        <Text className="text-gray-500 text-[13px]">
          No completed seasons with a finished playoff bracket yet.
        </Text>
      ) : (
        history.map((season) => <SeasonCard key={season.season} season={season} />)
      )}
    </ScrollView>
  );
}
