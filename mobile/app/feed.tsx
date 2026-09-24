import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, UserProfile } from "../lib/socialAuth";
import { getFeedPostsForLeague, createPost, isPostLiked, isPostReposted, Post } from "../lib/posts";
import { getPostTargetRoute } from "../lib/postNavigation";
import { storage, StorageKeys } from "../lib/storage";
import PostCard from "../components/PostCard";
import ComposeBox from "../components/ComposeBox";

// League-scoped, like the dashboard's FeedPreview it's reached from -
// someone following one league's updates shouldn't see another league's
// Boogie announcements or trade posts mixed in.
export default function Feed() {
  const router = useRouter();
  const { leagueID: leagueIDParam } = useLocalSearchParams<{ leagueID: string }>();
  // Falls back to whichever league was last selected (SelectLeague.tsx)
  // if this screen is ever reached with no route param at all - a stale
  // nav history entry from before this screen carried a leagueID, a deep
  // link, or a background/foreground cycle that restored old state - so
  // it degrades to "your last league" instead of a dead end.
  const [fallbackLeagueID, setFallbackLeagueID] = useState<string | null>(null);
  const [fallbackChecked, setFallbackChecked] = useState(false);
  const leagueID = leagueIDParam || fallbackLeagueID || undefined;

  useEffect(() => {
    if (leagueIDParam) {
      setFallbackChecked(true);
      return;
    }
    storage
      .getItem(StorageKeys.selectedLeagueID)
      .then((id) => setFallbackLeagueID(id))
      .catch(() => setFallbackLeagueID(null))
      .finally(() => setFallbackChecked(true));
  }, [leagueIDParam]);

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

  // authUser starts null and flips to the real signed-in user once Firebase
  // resolves the persisted session, which re-triggers this via the
  // useEffect below - but that means two loads can be in flight at once
  // (the initial null-user one and the real-user one), and whichever
  // finishes LAST wins regardless of which one is actually current. The
  // null-user load only awaits one call before writing empty interaction
  // state, while the real-user load has to additionally check every post's
  // like/repost status - slower, but not reliably slower, so the fast
  // "you're signed out" result could resolve after the correct one and
  // wipe it back to "nothing's liked". requestIdRef makes only the most
  // recently issued call's results ever get applied.
  const requestIdRef = useRef(0);

  const loadFeed = useCallback(async () => {
    if (!leagueID) {
      // Only give up and stop the spinner once the storage fallback has
      // actually had a chance to resolve - otherwise this fires on the
      // very first render (before that lookup finishes) and flashes the
      // "no league" state even when a fallback is about to show up.
      if (fallbackChecked) setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const feedPosts = await getFeedPostsForLeague(leagueID, 30);
      if (requestIdRef.current !== requestId) return;
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
        if (requestIdRef.current !== requestId) return;
        setInteractionState(Object.fromEntries(entries));
      } else {
        setInteractionState({});
      }
    } catch (error) {
      console.error("Error loading feed:", error);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, leagueID, fallbackChecked]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const onRefresh = () => {
    setRefreshing(true);
    loadFeed();
  };

  const submitPost = async (text: string, imageUrl?: string) => {
    if (!profile || !leagueID) return;
    const post = await createPost({
      authorUid: profile.uid,
      authorUsername: profile.username,
      authorDisplayName: profile.displayName,
      authorAvatar: profile.avatar,
      text,
      imageUrl,
      leagueId: leagueID,
    });
    setPosts((prev) => [post, ...prev]);
    setInteractionState((prev) => ({ ...prev, [post.id]: { liked: false, reposted: false } }));
  };

  if (!leagueID) {
    if (!fallbackChecked) {
      return (
        <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 bg-[#0c0c0e] items-center justify-center px-6">
        <Text className="text-gray-500 text-[13px] text-center">
          Open the Feed from inside a league to see its updates.
        </Text>
        <Pressable onPress={() => router.push("/")} className="mt-4">
          <Text className="text-brand text-[13px] font-semibold">Go to your leagues</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable
          onPress={() => router.push({ pathname: "/league/[leagueID]", params: { leagueID } } as any)}
          hitSlop={10}
          className="mr-3"
        >
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
                const route = getPostTargetRoute(item);
                if (route) router.push(route as any);
              }}
              onDeleted={() => setPosts((prev) => prev.filter((p) => p.id !== item.id))}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
