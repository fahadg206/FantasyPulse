import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import { getUserProfileBySleeperId } from "../../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../../lib/fantasyProfile";
import ProfileActivity from "../../../components/ProfileActivity";
import { getManualTitles } from "../../../lib/manualTitles";

const helmet = require("../../../assets/images/helmet2.png");
const CURRENT_SEASON = "2026";

// Every manager in every league has a Sleeper user id whether or not
// they've ever signed up for this app - clicking a team name/avatar
// anywhere in the app (Schedule, a matchup, Standings, Trades, Power
// Rankings, League Managers, Trade Calculator...) lands here rather than
// on a username route that might not exist yet. Two things can happen:
//   - this Sleeper id turns out to already be linked to a real Fantasy
//     Pulse account (getUserProfileBySleeperId) - immediately redirected
//     to that account's full profile (posts, follow, DM, everything).
//   - it isn't - real Sleeper-derived stats are still shown (the exact
//     same ProfileActivity used everywhere else), just without any of
//     the account-gated social features, since there's no account to
//     attach a follow/comment/DM to. An account only ever exists to
//     unlock those - it was never a requirement for having a profile at
//     all, which is the whole point of this screen existing.
export default function ManagerProfileBySleeperId() {
  const { sleeperUserId } = useLocalSearchParams<{ sleeperUserId: string }>();
  const router = useRouter();

  const [checkingAccount, setCheckingAccount] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [sleeperUser, setSleeperUser] = useState<{ display_name?: string; avatar?: string } | null>(null);
  const [stats, setStats] = useState<FantasyProfileStats | null>(null);

  useEffect(() => {
    if (!sleeperUserId) return;
    let cancelled = false;
    getUserProfileBySleeperId(sleeperUserId)
      .then((profile) => {
        if (cancelled) return;
        if (profile) {
          setRedirecting(true);
          router.replace(`/profile/${profile.username}`);
        } else {
          setCheckingAccount(false);
        }
      })
      .catch((error) => {
        console.error("Error checking for a linked account:", error);
        if (!cancelled) setCheckingAccount(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sleeperUserId]);

  useEffect(() => {
    if (!sleeperUserId) return;
    // Sleeper's own /user/{id} endpoint accepts a raw user id the same
    // way it accepts a username - real display name + avatar straight
    // from the source, not anything cached/stale from a league roster.
    sleeper
      .getUser(sleeperUserId)
      .then(({ data }) => setSleeperUser(data))
      .catch((error) => console.error("Error fetching Sleeper user:", error));
  }, [sleeperUserId]);

  useEffect(() => {
    if (!sleeperUserId) return;
    getFantasyProfileStats(sleeperUserId, CURRENT_SEASON)
      .then(setStats)
      .catch((error) => console.error("Error loading manager's Sleeper stats:", error));
  }, [sleeperUserId]);

  if (!sleeperUserId || checkingAccount || redirecting) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center">
        <ActivityIndicator color="#af1222" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 pt-3 pb-1">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push("/"))} hitSlop={10}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerClassName="px-5 pt-4 pb-12" showsVerticalScrollIndicator={false}>
        <View className="items-center mb-4">
          <Image
            source={sleeperUser?.avatar ? { uri: `https://sleepercdn.com/avatars/thumbs/${sleeperUser.avatar}` } : helmet}
            className="w-[80px] h-[80px] rounded-full bg-white/10"
          />
          <Text className="text-white text-[20px] font-bold mt-2">{sleeperUser?.display_name ?? "Manager"}</Text>

          <View className="flex-row items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 mt-3">
            <Feather name="info" size={11} color="#9ca3af" />
            <Text className="text-gray-400 text-[11px]">Hasn&apos;t joined Fantasy Pulse - stats from Sleeper</Text>
          </View>
        </View>

        <ProfileActivity
          sleeperUserId={sleeperUserId}
          season={CURRENT_SEASON}
          stats={stats}
          extraTitles={getManualTitles(sleeperUserId)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
