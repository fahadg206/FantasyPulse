import { useState } from "react";
import { View, Text, Pressable, Image, Share, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { Post } from "../lib/posts";
import { toggleLike, toggleRepost, deletePost, BOOGIE_UID } from "../lib/posts";
import { formatTwitterTimestamp } from "../lib/formatTime";
import Avatar from "./Avatar";

// Styled to match Twitter's own mobile feed row as closely as this app's
// data supports: flush full-width row (no rounded card, unlike the rest of
// this app), a thin divider below instead of a card background, avatar on
// the left, name/@handle/timestamp on one line, then text, an optional
// attached image or matchup scoreboard, then an evenly spaced reply/
// repost/like/share icon row.

interface PostCardProps {
  post: Post;
  currentUid?: string | null;
  liked: boolean;
  reposted: boolean;
  onPressReply?: () => void;
  onPressTarget?: () => void;
  /** called after a successful delete, so the caller can drop this post from its own list */
  onDeleted?: () => void;
}

export default function PostCard({
  post,
  currentUid,
  liked: initialLiked,
  reposted: initialReposted,
  onPressReply,
  onPressTarget,
  onDeleted,
}: PostCardProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(initialReposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [deleting, setDeleting] = useState(false);

  const canInteract = !!currentUid;
  const isOwnPost = !!currentUid && currentUid === post.authorUid;
  // Auto-announced posts (a trade, a waiver move, a final score) come from
  // Boogie The Writer, the same staff-writer persona used for Articles -
  // there's no real profile behind the byline, so it's shown as a
  // verified-style account instead of linking anywhere.
  const isBoogie = post.authorUid === BOOGIE_UID;

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

  const onDelete = () => {
    Alert.alert("Delete post?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deletePost(post.id);
            onDeleted?.();
          } catch (error) {
            console.error("Error deleting post:", error);
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const goToProfile = isBoogie ? undefined : () => router.push(`/profile/${post.authorUsername}`);

  if (deleting) return null;

  return (
    <View className="flex-row px-4 py-3 border-b border-white/10">
      <Pressable onPress={goToProfile} disabled={isBoogie} hitSlop={4} className="mr-3">
        <Avatar uid={post.authorUid} url={post.authorAvatar} name={post.authorDisplayName} />
      </Pressable>

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-wrap flex-1 mr-2">
            <Pressable onPress={goToProfile} disabled={isBoogie}>
              <View className="flex-row items-center gap-1">
                <Text className="text-white font-bold text-[14px]">{post.authorDisplayName}</Text>
                {isBoogie && <Feather name="check-circle" size={13} color="#af1222" />}
              </View>
            </Pressable>
            <Text className="text-gray-500 text-[13px] ml-1">
              @{post.authorUsername} · {formatTwitterTimestamp(post.createdAtMs)}
            </Text>
          </View>
          {isOwnPost && (
            <Pressable onPress={onDelete} hitSlop={8}>
              <Feather name="trash-2" size={14} color="#6b7280" />
            </Pressable>
          )}
        </View>

        {!!post.text && <Text className="text-white text-[15px] mt-0.5 leading-[20px]">{post.text}</Text>}

        {post.matchupCard && <MatchupCardView card={post.matchupCard} />}

        {post.imageUrl && (
          <Image
            source={{ uri: post.imageUrl }}
            className="w-full rounded-2xl mt-2.5 bg-white/5"
            style={{ aspectRatio: 16 / 9 }}
            resizeMode="cover"
          />
        )}

        {post.targetLabel && (
          <Pressable
            onPress={onPressTarget}
            className="flex-row items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-white/5 self-start"
          >
            <Feather
              name={post.targetType === "trade" ? "repeat" : post.targetType === "waiver" ? "trending-up" : "activity"}
              size={11}
              color="#9ca3af"
            />
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

// A compact "tweeted scoreboard" - the post-sized version of a matchup,
// styled like a sports score alert rather than a plain sentence.
function MatchupCardView({ card }: { card: Post["matchupCard"] }) {
  if (!card) return null;
  const team1Winning = card.team1Score > card.team2Score;
  const team2Winning = card.team2Score > card.team1Score;

  return (
    <View className="mt-2.5 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
      <View className="flex-row items-center justify-between px-3.5 pt-3">
        <Text className="text-[10px] font-bold tracking-widest text-brand">
          {card.isFinal ? "FINAL" : `WEEK ${card.week}`}
        </Text>
      </View>
      <View className="px-3.5 py-3 gap-2.5">
        <MatchupCardRow name={card.team1Name} score={card.team1Score} avatar={card.team1Avatar} winning={team1Winning} />
        <MatchupCardRow name={card.team2Name} score={card.team2Score} avatar={card.team2Avatar} winning={team2Winning} />
      </View>
    </View>
  );
}

function MatchupCardRow({
  name,
  score,
  avatar,
  winning,
}: {
  name: string;
  score: number;
  avatar?: string;
  winning: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2 flex-1 mr-2">
        <Avatar url={avatar} name={name} size={26} />
        <Text
          numberOfLines={1}
          className={`text-[13px] flex-1 ${winning ? "text-white font-bold" : "text-gray-400 font-semibold"}`}
        >
          {name}
        </Text>
      </View>
      <Text
        style={{ fontVariant: ["tabular-nums"] }}
        className={`text-[15px] ${winning ? "text-white font-extrabold" : "text-gray-400 font-bold"}`}
      >
        {score.toFixed(1)}
      </Text>
    </View>
  );
}
