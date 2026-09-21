import { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Slot, useLocalSearchParams } from "expo-router";
import { sleeper } from "../../../lib/api";
import { storage, StorageKeys } from "../../../lib/storage";
import Scoreboard from "../../../components/Scoreboard";
import BottomTabBar from "../../../components/BottomTabBar";

const helmet = require("../../../assets/images/helmet2.png");

export default function LeagueLayout() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [leagueName, setLeagueName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    (async () => {
      const storedName = await storage.getItem(StorageKeys.selectedLeagueName);
      if (storedName) setLeagueName(storedName);
      try {
        const res = await sleeper.getLeague(leagueID);
        setAvatar(res.data?.avatar ?? null);
        if (!storedName && res.data?.name) setLeagueName(res.data.name);
      } catch (error) {
        console.error("Error fetching league info:", error);
      }
    })();
  }, [leagueID]);

  if (!leagueID) return null;

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]" edges={["top"]}>
      {/* Dark masthead so it reads as one cohesive unit with the
          scoreboard strip directly beneath it, instead of a mismatched
          light bar sitting on top of a dark one. */}
      <View className="items-center py-2.5 bg-[#0c0c0e] border-b border-white/10">
        <Image
          source={avatar ? { uri: `https://sleepercdn.com/avatars/thumbs/${avatar}` } : helmet}
          className="w-[40px] h-[40px] rounded-full mb-1 border border-white/10"
        />
        <Text className="text-[15px] font-bold text-white">{leagueName}</Text>
      </View>
      <Scoreboard leagueID={leagueID} />
      <View className="flex-1">
        <Slot />
      </View>
      <BottomTabBar leagueID={leagueID} />
    </SafeAreaView>
  );
}
