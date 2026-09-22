import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, UserProfile } from "../../lib/socialAuth";
import { getPost, getReplies, createPost, isPostLiked, isPostReposted, Post } from "../../lib/posts";
import PostCard from "../../components/PostCard";
import ComposeBox from "../../components/ComposeBox";

// A single post's own thread - what it's replying to isn't shown (posts
// don't chain further than one level up in this app), just the post itself
// and its replies, with a reply composer at the bottom. Reachable by
// tapping the reply icon on any post, in the Feed or in a CommentsSection.
export default function PostThread() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [replies, setReplies] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setProfile(null);
      return;
    }
    getUserProfile(authUser.uid).then(setProfile).catch(console.error);
  }, [authUser]);

  const load = useCallback(async () => {
    if (!postId) return;
    try {
      const [foundPost, foundReplies] = await Promise.all([getPost(postId), getReplies(postId)]);
      setPost(foundPost);
      setReplies(foundReplies);

      if (authUser && !isReadOnly(authUser)) {
        const all = foundPost ? [foundPost, ...foundReplies] : foundReplies;
        const entries = await Promise.all(
          all.map(async (p) => {
            const [liked, reposted] = await Promise.all([
              isPostLiked(p.id, authUser.uid),
              isPostReposted(p.id, authUser.uid),
            ]);
            return [p.id, { liked, reposted }] as const;
          })
        );
        setInteractionState(Object.fromEntries(entries));
      }
    } catch (error) {
      console.error("Error loading post thread:", error);
      setPost(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, authUser]);

  useEffect(() => {
    load();
  }, [load]);

  const submitReply = async (text: string, imageUrl?: string) => {
    if (!profile || !post) return;
    const reply = await createPost({
      authorUid: profile.uid,
      authorUsername: profile.username,
      authorDisplayName: profile.displayName,
      authorAvatar: profile.avatar,
      text,
      imageUrl,
      parentPostId: post.id,
    });
    setReplies((prev) => [...prev, reply]);
    setInteractionState((prev) => ({ ...prev, [reply.id]: { liked: false, reposted: false } }));
    setPost((p) => (p ? { ...p, replyCount: p.replyCount + 1 } : p));
  };

  if (!postId) return null;

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center gap-3 px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">Post</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : !post ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-[13px] text-center">This post is no longer available.</Text>
        </View>
      ) : (
        <FlatList
          data={replies}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              <PostCard
                post={post}
                currentUid={profile?.uid}
                liked={interactionState[post.id]?.liked ?? false}
                reposted={interactionState[post.id]?.reposted ?? false}
                onDeleted={() => router.back()}
              />
              <View className="px-4 py-2.5 border-b border-white/10">
                <Text className="text-[10px] font-bold tracking-widest text-gray-500">
                  REPLIES {replies.length > 0 ? `(${replies.length})` : ""}
                </Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View className="items-center py-10 px-6">
              <Text className="text-gray-500 text-[13px] text-center">No replies yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <PostCard
              post={item}
              currentUid={profile?.uid}
              liked={interactionState[item.id]?.liked ?? false}
              reposted={interactionState[item.id]?.reposted ?? false}
              onPressReply={() => router.push(`/post/${item.id}`)}
              onDeleted={() => setReplies((prev) => prev.filter((r) => r.id !== item.id))}
            />
          )}
        />
      )}

      {profile ? (
        <ComposeBox profile={profile} placeholder="Post your reply" compact onSubmit={submitReply} />
      ) : (
        <Pressable
          onPress={() => router.push("/profile")}
          className="flex-row items-center justify-center gap-2 px-4 py-3 border-t border-white/10"
        >
          <Feather name="lock" size={12} color="#6b7280" />
          <Text className="text-gray-500 text-[12px]">Sign in to reply</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
