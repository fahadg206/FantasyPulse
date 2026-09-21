import { useState } from "react";
import { View, Text, Pressable, Share } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { Post } from "../lib/posts";
import { toggleLike, toggleRepost, SYSTEM_AUTHOR_UID } from "../lib/posts";
import { formatTwitterTimestamp } from "../lib/formatTime";

// Styled to match Twitter's own mobile feed row as closely as this app's
// data supports: flush full-width row (no rounded card, unlike the rest of
// this app), a thin divider below instead of a card background, avatar on
// the left, name/@handle/timestamp on one line, then text, then an evenly
// spaced reply/repost/like/share icon row. No real photo uploads exist in
// this app yet, so avatars fall back to a colored initial circle, same as
// every other profile surface already does.

interface PostCardProps {
  post: Post;
  currentUid?: string | null;
  liked: boolean;
  reposted: boolean;
  onPressReply?: () => void;
  onPressTarget?: () => void;
}

export default function PostCard({
  post,
  currentUid,
  liked: initialLiked,
  reposted: initialReposted,
  onPressReply,
  onPressTarget,
}: PostCardProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(initialReposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);

  const canInteract = !!currentUid;
  // Auto-announced posts (a completed trade, a final score) come from the
  // app itself rather than a real user, so there's no profile to visit -
  // shown instead as a verified-style account, same idea as Twitter's
  // official accounts.
  const isSystem = post.authorUid === SYSTEM_AUTHOR_UID;

  const onLike = async () => {
    if (!canInteract || !currentUid) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    try {
      await toggleLike(post.id, currentUid);
    } catch (error) {
      console.error("Error toggling like:", error);
      setLiked(!nextLiked);
      setLikeCount((c) => c + (nextLiked ? -1 : 1));
    }
  };

  const onRepost = async () => {
    if (!canInteract || !currentUid) return;
    const nextReposted = !reposted;
    setReposted(nextReposted);
    setRepostCount((c) => c + (nextReposted ? 1 : -1));
    try {
      await toggleRepost(post.id, currentUid);
    } catch (error) {
      console.error("Error toggling repost:", error);
      setReposted(!nextReposted);
      setRepostCount((c) => c + (nextReposted ? -1 : 1));
    }
  };

  const onShare = () => {
    Share.share({ message: post.text }).catch(() => {});
  };

  return (
    <View className="flex-row px-4 py-3 border-b border-white/10">
      <Pressable
        onPress={isSystem ? undefined : () => router.push(`/profile/${post.authorUsername}`)}
        disabled={isSystem}
        hitSlop={4}
      >
        <View
          className={`w-[42px] h-[42px] rounded-full items-center justify-center mr-3 ${
            isSystem ? "bg-brand" : "bg-brand/20"
          }`}
        >
          {isSystem ? (
            <Feather name="activity" size={18} color="#fff" />
          ) : (
            <Text className="text-brand font-bold text-[16px]">
              {post.authorDisplayName.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
      </Pressable>

      <View className="flex-1">
        <View className="flex-row items-center flex-wrap">
          <Pressable onPress={isSystem ? undefined : () => router.push(`/profile/${post.authorUsername}`)} disabled={isSystem}>
            <View className="flex-row items-center gap-1">
              <Text className="text-white font-bold text-[14px]">{post.authorDisplayName}</Text>
              {isSystem && <Feather name="check-circle" size={13} color="#af1222" />}
            </View>
          </Pressable>
          <Text className="text-gray-500 text-[13px] ml-1">
            @{post.authorUsername} · {formatTwitterTimestamp(post.createdAtMs)}
          </Text>
        </View>

        <Text className="text-white text-[15px] mt-0.5 leading-[20px]">{post.text}</Text>

        {post.targetLabel && (
          <Pressable
            onPress={onPressTarget}
            className="flex-row items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-white/5 self-start"
          >
            <Feather name={post.targetType === "trade" ? "repeat" : "activity"} size={11} color="#9ca3af" />
            <Text className="text-gray-400 text-[11px]">{post.targetLabel}</Text>
          </Pressable>
        )}

        <View className="flex-row items-center justify-between mt-3 pr-8">
          <Pressable onPress={onPressReply} className="flex-row items-center gap-1.5" hitSlop={8}>
            <Feather name="message-circle" size={16} color="#9ca3af" />
            {post.replyCount > 0 && <Text className="text-gray-500 text-[12px]">{post.replyCount}</Text>}
          </Pressable>

          <Pressable onPress={onRepost} disabled={!canInteract} className="flex-row items-center gap-1.5" hitSlop={8}>
            <Feather name="repeat" size={16} color={reposted ? "#00ba7c" : "#9ca3af"} />
            {repostCount > 0 && (
              <Text style={{ color: reposted ? "#00ba7c" : "#6b7280" }} className="text-[12px]">
                {repostCount}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={onLike} disabled={!canInteract} className="flex-row items-center gap-1.5" hitSlop={8}>
            <Feather name="heart" size={16} color={liked ? "#f91880" : "#9ca3af"} />
            {likeCount > 0 && (
              <Text style={{ color: liked ? "#f91880" : "#6b7280" }} className="text-[12px]">
                {likeCount}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={onShare} hitSlop={8}>
            <Feather name="share" size={16} color="#9ca3af" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
