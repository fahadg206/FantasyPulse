import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { sleeper } from "../lib/api";
import { storage, StorageKeys } from "../lib/storage";

const helmet = require("../assets/images/helmet2.png");

interface League {
  league_id: string;
  name: string;
  avatar?: string;
  status: string;
}

type Props = {
  username: string;
  usernameSubmitted: boolean;
  selectedSeason: string;
  usernameCleared: boolean;
};

export default function SelectLeague({
  username,
  usernameSubmitted,
  selectedSeason,
  usernameCleared,
}: Props) {
  const [leagueData, setLeagueData] = useState<League[]>([]);
  const [userFound, setUserFound] = useState(true);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (usernameCleared) setUserFound(true);
  }, [usernameCleared]);

  useEffect(() => {
    if (!usernameSubmitted || !username) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const userRes = await sleeper.getUser(username);
        const userId = userRes.data?.user_id;
        if (!userId) {
          if (!cancelled) setUserFound(false);
          return;
        }
        const leaguesRes = await sleeper.getUserLeagues(userId, selectedSeason);
        const leagues: League[] = leaguesRes.data;
        if (!cancelled) {
          if (!leagues || leagues.length === 0) {
            setUserFound(false);
            setLeagueData([]);
          } else {
            setUserFound(true);
            setLeagueData(leagues);
          }
        }
      } catch {
        if (!cancelled) setUserFound(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [username, usernameSubmitted, selectedSeason]);

  const selectLeague = async (league: { league_id: string; name: string; status?: string }) => {
    await storage.setItem(StorageKeys.selectedLeagueID, league.league_id);
    await storage.setItem(StorageKeys.selectedLeagueName, league.name);
    if (league.status) await storage.setItem(StorageKeys.leagueStatus, league.status);
    router.push(`/league/${league.league_id}`);
  };

  return (
    <View className="items-center w-full">
      {loading && <ActivityIndicator color="#af1222" className="mt-3" />}

      {usernameSubmitted && !usernameCleared && leagueData.length > 0 && (
        <View className="w-full gap-2 mt-4">
          {leagueData.map((league) => (
            <Pressable
              key={league.league_id}
              onPress={() => selectLeague(league)}
              className="flex-row items-center gap-3 bg-[#1c1c1e] border border-white/10 rounded-xl px-3 py-3 min-h-[56px]"
            >
              <Image
                source={
                  league.avatar
                    ? { uri: `https://sleepercdn.com/avatars/thumbs/${league.avatar}` }
                    : helmet
                }
                className="w-[36px] h-[36px] rounded-full"
              />
              <Text numberOfLines={1} className="flex-1 text-[15px] font-bold text-white">
                {league.name}
              </Text>
              <Text className="text-[12px] text-brand font-semibold">Select →</Text>
            </Pressable>
          ))}
        </View>
      )}

      {usernameSubmitted && !usernameCleared && !loading && leagueData.length === 0 && !userFound && (
        <Text className="mt-3 text-gray-300">Invalid username</Text>
      )}

      {(!usernameSubmitted || usernameCleared) && (
        <View className="items-center mt-1">
          <Text className="italic text-[13px] text-gray-500 mb-2">
            Don&apos;t have a Sleeper account?
          </Text>
          <Pressable
            onPress={() =>
              selectLeague({
                league_id: "982124415926300672",
                name: "Dynasty League",
              })
            }
            hitSlop={4}
            className="border-2 border-brand rounded-lg px-4 py-2.5 min-h-[44px] items-center justify-center"
          >
            <Text className="text-[13px] text-brand font-semibold">Try the Demo</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
