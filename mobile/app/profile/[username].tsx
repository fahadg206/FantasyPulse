import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfileByUsername, ensureAvatarSynced, UserProfile } from "../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../lib/fantasyProfile";
import { followUser, unfollowUser, isFollowing, getFollowingUids, getFollowerUids } from "../../lib/follows";
import ProfileActivity from "../../components/ProfileActivity";
import Avatar from "../../components/Avatar";

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
    getUserProfileByUsername(username)
      .then((p) => (p ? ensureAvatarSynced(p) : null))
      .then(setProfile)
      .catch(() => setProfile(null));
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
          <Avatar uid={profile.uid} url={profile.avatar} name={profile.displayName} size={80} />
          <Text className="text-white text-[20px] font-bold mt-2">{profile.displayName}</Text>
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
          <ProfileActivity sleeperUserId={profile.sleeperUserId} stats={stats} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
