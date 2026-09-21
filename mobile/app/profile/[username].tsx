import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfileByUsername, UserProfile } from "../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../lib/fantasyProfile";
import { followUser, unfollowUser, isFollowing, getFollowingUids, getFollowerUids } from "../../lib/follows";

const CURRENT_SEASON = "2026";

export default function PublicProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [stats, setStats] = useState<FantasyProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followCounts, setFollowCounts] = useState({ following: 0, followers: 0 });

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!username) return;
    getUserProfileByUsername(username).then(setProfile).catch(() => setProfile(null));
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    getFollowingUids(profile.uid).then((f) => setFollowCounts((c) => ({ ...c, following: f.length }))).catch(console.error);
    getFollowerUids(profile.uid).then((f) => setFollowCounts((c) => ({ ...c, followers: f.length }))).catch(console.error);
  }, [profile]);

  useEffect(() => {
    if (!profile || !authUser || isReadOnly(authUser)) return;
    isFollowing(authUser.uid, profile.uid).then(setFollowing).catch(console.error);
  }, [profile, authUser]);

  useEffect(() => {
    if (!profile?.sleeperUserId) return;
    setStatsLoading(true);
    getFantasyProfileStats(profile.sleeperUserId, CURRENT_SEASON)
      .then(setStats)
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  }, [profile?.sleeperUserId]);

  const toggleFollow = async () => {
    if (!authUser || isReadOnly(authUser) || !profile) return;
    setFollowBusy(true);
    try {
      if (following) {
        await unfollowUser(authUser.uid, profile.uid);
        setFollowing(false);
        setFollowCounts((c) => ({ ...c, followers: Math.max(0, c.followers - 1) }));
      } else {
        await followUser(authUser.uid, profile.uid);
        setFollowing(true);
        setFollowCounts((c) => ({ ...c, followers: c.followers + 1 }));
      }
    } catch (error) {
      console.error("Error toggling follow:", error);
    } finally {
      setFollowBusy(false);
    }
  };

  if (profile === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center">
        <ActivityIndicator color="#af1222" />
      </SafeAreaView>
    );
  }

  if (profile === null) {
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center px-6">
        <Text className="text-gray-400 text-center">No manager found with that username.</Text>
      </SafeAreaView>
    );
  }

  const canFollow = authUser && !isReadOnly(authUser) && authUser.uid !== profile.uid;

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 pt-3 pb-1">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerClassName="px-5 pt-4 pb-12" showsVerticalScrollIndicator={false}>
        <View className="items-center mb-6">
          <View className="w-[76px] h-[76px] rounded-full bg-brand/20 items-center justify-center mb-2">
            <Text className="text-brand text-[28px] font-bold">
              {profile.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text className="text-white text-[20px] font-bold">{profile.displayName}</Text>
          <Text className="text-gray-500 text-[13px]">@{profile.username}</Text>
          {profile.bio && <Text className="text-gray-300 text-[13px] mt-2 text-center px-6">{profile.bio}</Text>}

          <View className="flex-row gap-6 mt-4">
            <View className="items-center">
              <Text className="text-white font-bold text-[15px]">{followCounts.following}</Text>
              <Text className="text-gray-500 text-[11px]">Following</Text>
            </View>
            <View className="items-center">
              <Text className="text-white font-bold text-[15px]">{followCounts.followers}</Text>
              <Text className="text-gray-500 text-[11px]">Followers</Text>
            </View>
          </View>

          {canFollow && (
            <Pressable
              onPress={toggleFollow}
              disabled={followBusy}
              className={`mt-4 px-6 py-2.5 rounded-full ${following ? "bg-transparent border border-white/20" : "bg-brand"}`}
            >
              {followBusy ? (
                <ActivityIndicator color={following ? "#fff" : "#fff"} size="small" />
              ) : (
                <Text className={`font-bold text-[13px] ${following ? "text-white" : "text-white"}`}>
                  {following ? "Following" : "Follow"}
                </Text>
              )}
            </Pressable>
          )}
        </View>

        {!profile.sleeperUserId ? (
          <Text className="text-gray-500 text-[13px] text-center">
            This manager hasn't linked a Sleeper account yet.
          </Text>
        ) : statsLoading ? (
          <ActivityIndicator color="#af1222" className="mt-4" />
        ) : stats ? (
          <View>
            <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mb-4">
              <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2">
                {stats.season} SEASON - {stats.totals.leaguesCount} LEAGUES
              </Text>
              <View className="flex-row justify-between">
                <View className="items-center">
                  <Text className="text-white font-bold text-[16px]">
                    {stats.totals.wins}-{stats.totals.losses}
                  </Text>
                  <Text className="text-gray-500 text-[10px] mt-0.5">Record</Text>
                </View>
                <View className="items-center">
                  <Text className="text-white font-bold text-[16px]">{stats.totals.pointsFor.toFixed(0)}</Text>
                  <Text className="text-gray-500 text-[10px] mt-0.5">Points For</Text>
                </View>
              </View>
            </View>
            {stats.leagues.map((l) => (
              <View
                key={l.leagueId}
                className="flex-row items-center justify-between bg-[#141416] rounded-xl border border-white/10 px-4 py-3 mb-2"
              >
                <View className="flex-1 mr-2">
                  <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
                    {l.leagueName}
                  </Text>
                  <Text className="text-gray-500 text-[11px]">
                    Rank #{l.rank} of {l.totalTeams}
                  </Text>
                </View>
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
                  {l.wins}-{l.losses}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
