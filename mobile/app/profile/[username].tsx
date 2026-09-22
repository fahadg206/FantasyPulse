import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfileByUsername, ensureAvatarSynced, UserProfile } from "../../lib/socialAuth";
import { getFantasyProfileStats, FantasyProfileStats } from "../../lib/fantasyProfile";
import { followUser, unfollowUser, isFollowing, getFollowingUids, getFollowerUids } from "../../lib/follows";
import { getPostsByAuthor, isPostLiked, isPostReposted, BOOGIE_UID, BOOGIE_USERNAME, Post } from "../../lib/posts";
import ProfileActivity from "../../components/ProfileActivity";
import Avatar from "../../components/Avatar";
import PostCard from "../../components/PostCard";

const CURRENT_SEASON = "2026";

// Boogie isn't a real Firebase account - there's no profiles/{uid} doc to
// look up - so his profile is handled entirely separately from the real
// lookup flow below, showing only what he's actually posted himself
// (trades and final scores, per ensureSystemPost's scope) rather than any
// Fantasy Profile stats a real manager's page would have.
function BoogieProfile() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUid, setCurrentUid] = useState<string | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setCurrentUid(undefined);
      return;
    }
    setCurrentUid(authUser.uid);
  }, [authUser]);

  useEffect(() => {
    let cancelled = false;
    getPostsByAuthor(BOOGIE_UID)
      .then(async (result) => {
        if (cancelled) return;
        setPosts(result);
        if (currentUid) {
          const entries = await Promise.all(
            result.map(async (p) => {
              const [liked, reposted] = await Promise.all([isPostLiked(p.id, currentUid), isPostReposted(p.id, currentUid)]);
              return [p.id, { liked, reposted }] as const;
            })
          );
          if (!cancelled) setInteractionState(Object.fromEntries(entries));
        }
      })
      .catch((error) => console.error("Error loading Boogie's posts:", error))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentUid]);

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 pt-3 pb-1">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
      </View>
      <View className="items-center px-5 pt-4 pb-6">
        <Avatar uid={BOOGIE_UID} name="Boogie The Writer" size={80} />
        <View className="flex-row items-center gap-1.5 mt-2">
          <Text className="text-white text-[20px] font-bold">Boogie The Writer</Text>
          <Feather name="check-circle" size={15} color="#af1222" />
        </View>
        <Text className="text-gray-500 text-[13px]">@{BOOGIE_USERNAME}</Text>
        <Text className="text-gray-300 text-[13px] mt-2 text-center px-6">
          Fantasy Pulse Senior Staff Writer, covering every trade and final score across the league.
        </Text>
      </View>

      {loading ? (
        <View className="items-center py-10">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : posts.length === 0 ? (
        <View className="items-center py-10 px-6">
          <Text className="text-gray-500 text-[13px] text-center">Nothing posted yet.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUid={currentUid}
              liked={interactionState[post.id]?.liked ?? false}
              reposted={interactionState[post.id]?.reposted ?? false}
              onPressReply={() => router.push(`/post/${post.id}`)}
              onPressTarget={() => {
                if (post.targetType === "matchup" && post.targetId && post.leagueId) {
                  const [week, matchupID] = post.targetId.split(":");
                  router.push({
                    pathname: "/league/[leagueID]/matchup",
                    params: { leagueID: post.leagueId, week, matchupID },
                  } as any);
                } else if ((post.targetType === "trade" || post.targetType === "waiver") && post.leagueId) {
                  router.push({ pathname: "/league/[leagueID]/trades", params: { leagueID: post.leagueId } } as any);
                }
              }}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

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

  if (username === BOOGIE_USERNAME) {
    return <BoogieProfile />;
  }

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
