import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, UserProfile } from "../lib/socialAuth";
import { getPostsForTarget, createPost, isPostLiked, isPostReposted, Post } from "../lib/posts";
import PostCard from "./PostCard";

const MAX_POST_LENGTH = 280;

interface CommentsSectionProps {
  targetType: "matchup" | "trade";
  targetId: string;
  leagueId: string;
  targetLabel: string;
}

// Comments on a specific matchup or trade - built on the same posts.ts
// model as the public Feed, so every comment here also shows up there,
// tagged with what it's about (the same way replying to something on
// Twitter still posts to the timeline).
export default function CommentsSection({ targetType, targetId, leagueId, targetLabel }: CommentsSectionProps) {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [comments, setComments] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!authUser || isReadOnly(authUser)) {
      setProfile(null);
      return;
    }
    getUserProfile(authUser.uid).then(setProfile).catch(console.error);
  }, [authUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await getPostsForTarget(targetType, targetId);
        if (cancelled) return;
        setComments(results);
        if (authUser && !isReadOnly(authUser)) {
          const entries = await Promise.all(
            results.map(async (p) => {
              const [liked, reposted] = await Promise.all([
                isPostLiked(p.id, authUser.uid),
                isPostReposted(p.id, authUser.uid),
              ]);
              return [p.id, { liked, reposted }] as const;
            })
          );
          if (!cancelled) setInteractionState(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error("Error loading comments:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, authUser]);

  const submit = async () => {
    if (!profile || !text.trim()) return;
    setPosting(true);
    try {
      const post = await createPost({
        authorUid: profile.uid,
        authorUsername: profile.username,
        authorDisplayName: profile.displayName,
        text,
        leagueId,
        targetType,
        targetId,
        targetLabel,
      });
      setComments((prev) => [...prev, post]);
      setInteractionState((prev) => ({ ...prev, [post.id]: { liked: false, reposted: false } }));
      setText("");
    } catch (error) {
      console.error("Error posting comment:", error);
    } finally {
      setPosting(false);
    }
  };

  return (
    <View className="mt-2">
      <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2 px-4">
        COMMENTS {comments.length > 0 ? `(${comments.length})` : ""}
      </Text>

      {loading ? (
        <ActivityIndicator color="#af1222" className="py-4" />
      ) : comments.length === 0 ? (
        <Text className="text-gray-600 text-[12px] px-4 pb-3">No comments yet.</Text>
      ) : (
        <View className="border-y border-white/10">
          {comments.map((c) => (
            <PostCard
              key={c.id}
              post={c}
              currentUid={profile?.uid}
              liked={interactionState[c.id]?.liked ?? false}
              reposted={interactionState[c.id]?.reposted ?? false}
            />
          ))}
        </View>
      )}

      {profile ? (
        <View className="flex-row items-center gap-2 px-4 py-3">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Add a comment..."
            placeholderTextColor="#6b7280"
            maxLength={MAX_POST_LENGTH}
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-white text-[13px]"
          />
          <Pressable
            onPress={submit}
            disabled={posting || !text.trim()}
            className={`w-9 h-9 rounded-full items-center justify-center ${text.trim() ? "bg-brand" : "bg-brand/30"}`}
          >
            {posting ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="send" size={15} color="#fff" />}
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => router.push("/profile")}
          className="flex-row items-center justify-center gap-2 px-4 py-3"
        >
          <Feather name="lock" size={12} color="#6b7280" />
          <Text className="text-gray-500 text-[12px]">Sign in to comment</Text>
        </Pressable>
      )}
    </View>
  );
}
