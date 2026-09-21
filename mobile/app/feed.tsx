import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, UserProfile } from "../lib/socialAuth";
import { getFeedPosts, createPost, isPostLiked, isPostReposted, Post } from "../lib/posts";
import PostCard from "../components/PostCard";

const MAX_POST_LENGTH = 280;

export default function Feed() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);

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

  const submitPost = async () => {
    if (!profile || !composeText.trim()) return;
    setPosting(true);
    try {
      const post = await createPost({
        authorUid: profile.uid,
        authorUsername: profile.username,
        authorDisplayName: profile.displayName,
        text: composeText,
      });
      setPosts((prev) => [post, ...prev]);
      setInteractionState((prev) => ({ ...prev, [post.id]: { liked: false, reposted: false } }));
      setComposeText("");
    } catch (error: any) {
      console.error("Error creating post:", error);
    } finally {
      setPosting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center justify-center px-4 py-3 border-b border-white/10">
        <Text className="text-white text-[17px] font-bold">Feed</Text>
      </View>

      {profile ? (
        <View className="flex-row px-4 py-3 border-b border-white/10">
          <View className="w-[42px] h-[42px] rounded-full bg-brand/20 items-center justify-center mr-3">
            <Text className="text-brand font-bold text-[16px]">
              {profile.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <TextInput
              value={composeText}
              onChangeText={setComposeText}
              placeholder="What's happening in your league?"
              placeholderTextColor="#6b7280"
              multiline
              maxLength={MAX_POST_LENGTH}
              className="text-white text-[15px] min-h-[40px]"
            />
            <View className="flex-row items-center justify-between mt-2">
              <Text className="text-gray-600 text-[11px]">
                {composeText.length}/{MAX_POST_LENGTH}
              </Text>
              <Pressable
                onPress={submitPost}
                disabled={posting || !composeText.trim()}
                className={`px-4 py-1.5 rounded-full ${composeText.trim() ? "bg-brand" : "bg-brand/30"}`}
              >
                {posting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text className="text-white font-bold text-[13px]">Post</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
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
                }
              }}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
