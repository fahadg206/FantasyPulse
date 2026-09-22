import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, UserProfile } from "../lib/socialAuth";
import { getFeedPosts, createPost, isPostLiked, isPostReposted, Post } from "../lib/posts";
import PostCard from "../components/PostCard";
import ComposeBox from "../components/ComposeBox";

export default function Feed() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setProfile(null);
      return;
    }
    getUserProfile(authUser.uid).then(setProfile).catch(console.error);
  }, [authUser]);

  const loadFeed = useCallback(async () => {
    try {
      const feedPosts = await getFeedPosts(30);
      setPosts(feedPosts);

      if (authUser && !isReadOnly(authUser)) {
        const entries = await Promise.all(
          feedPosts.map(async (p) => {
            const [liked, reposted] = await Promise.all([
              isPostLiked(p.id, authUser.uid),
              isPostReposted(p.id, authUser.uid),
            ]);
            return [p.id, { liked, reposted }] as const;
          })
        );
        setInteractionState(Object.fromEntries(entries));
      } else {
        setInteractionState({});
      }
    } catch (error) {
      console.error("Error loading feed:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const onRefresh = () => {
    setRefreshing(true);
    loadFeed();
  };

  const submitPost = async (text: string, imageUrl?: string) => {
    if (!profile) return;
    const post = await createPost({
      authorUid: profile.uid,
      authorUsername: profile.username,
      authorDisplayName: profile.displayName,
      authorAvatar: profile.avatar,
      text,
      imageUrl,
    });
    setPosts((prev) => [post, ...prev]);
    setInteractionState((prev) => ({ ...prev, [post.id]: { liked: false, reposted: false } }));
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.push("/")} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">Feed</Text>
      </View>

      {profile ? (
        <ComposeBox profile={profile} placeholder="What's happening in your league?" onSubmit={submitPost} />
      ) : (
        <Pressable
          onPress={() => router.push("/profile")}
          className="flex-row items-center justify-center gap-2 px-4 py-3 border-b border-white/10"
        >
          <Feather name="lock" size={13} color="#6b7280" />
          <Text className="text-gray-500 text-[12px]">Sign in to post, like, and reply</Text>
        </Pressable>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#af1222" />}
          ListEmptyComponent={
            <View className="items-center py-12 px-6">
              <Text className="text-gray-500 text-[13px] text-center">
                Nothing here yet. Be the first to post, or comment on a matchup or trade.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <PostCard
              post={item}
              currentUid={profile?.uid}
              liked={interactionState[item.id]?.liked ?? false}
              reposted={interactionState[item.id]?.reposted ?? false}
              onPressTarget={() => {
                if (item.targetType === "matchup" && item.targetId && item.leagueId) {
                  const [week, matchupID] = item.targetId.split(":");
                  router.push({
                    pathname: "/league/[leagueID]/matchup",
                    params: { leagueID: item.leagueId, week, matchupID },
                  } as any);
                } else if ((item.targetType === "trade" || item.targetType === "waiver") && item.leagueId) {
                  router.push({ pathname: "/league/[leagueID]/trades", params: { leagueID: item.leagueId } } as any);
                }
              }}
              onPressReply={() => router.push(`/post/${item.id}`)}
              onDeleted={() => setPosts((prev) => prev.filter((p) => p.id !== item.id))}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
