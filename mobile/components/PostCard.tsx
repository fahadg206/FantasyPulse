import { useState } from "react";
import { View, Text, Pressable, Image, Share, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { Post } from "../lib/posts";
import { toggleLike, toggleRepost, deletePost, BOOGIE_UID, BOOGIE_USERNAME } from "../lib/posts";
import { formatTwitterTimestamp, formatAbsoluteTimestamp } from "../lib/formatTime";
import Avatar from "./Avatar";
import ReplyModal from "./ReplyModal";

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
  onPressTarget?: () => void;
  /** called after a successful delete, so the caller can drop this post from its own list */
  onDeleted?: () => void;
  /** called after a successful reply - most callers don't need this (the card's own reply count already updates itself), only a screen that's also showing a live list of this post's replies (the thread screen) needs to splice the new one in */
  onReplied?: (reply: Post) => void;
  /** suppresses tap-to-expand - for the root post on its own thread screen, where tapping it would just re-open the screen it's already on */
  disableExpand?: boolean;
  /** the larger "detail view" layout real Twitter shows for the post a thread screen is actually about - bigger avatar and text, the timestamp on its own full line, a full-width icon row - instead of the normal compact feed row. Implies disableExpand (nothing to expand into, it's already the expanded view). */
  expanded?: boolean;
}

export default function PostCard({
  post,
  currentUid,
  liked: initialLiked,
  reposted: initialReposted,
  onPressTarget,
  onDeleted,
  onReplied,
  disableExpand,
  expanded,
}: PostCardProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(initialReposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [replyCount, setReplyCount] = useState(post.replyCount);
  const [deleting, setDeleting] = useState(false);
  const [replyModalOpen, setReplyModalOpen] = useState(false);

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

  // Boogie's profile is tappable too now - it's just scoped to only what
  // he's actually posted, handled by app/profile/[username].tsx
  // special-casing his username rather than looking up a real account.
  // Always routes to the current BOOGIE_USERNAME constant rather than
  // whatever's stored on this specific post doc - ensureSystemPost only
  // ever writes a post once, so any post created before his handle
  // changed to 123Cancun still has the old username baked in, and that's
  // exactly what was producing "No manager found with that username."
  const authorUsername = isBoogie ? BOOGIE_USERNAME : post.authorUsername;
  const goToProfile = () => router.push(`/profile/${authorUsername}`);
  // Tapping the post itself (not its avatar/name, not the target chip, not
  // an action button - RN routes a tap to whichever Pressable is nested
  // deepest under it) opens its thread, same as tapping a tweet does -
  // separate from the reply icon's own onPressReply, which some callers
  // wire to the same destination and others (e.g. a reply already on its
  // own thread) leave unset entirely.
  const expandPost = () => router.push(`/post/${post.id}`);

  if (deleting) return null;

  const replyModal = canInteract && currentUid && (
    <ReplyModal
      visible={replyModalOpen}
      onClose={() => setReplyModalOpen(false)}
      post={post}
      currentUid={currentUid}
      onReplied={(reply) => {
        setReplyCount((c) => c + 1);
        onReplied?.(reply);
      }}
    />
  );

  // The larger "detail view" real Twitter shows at the top of a thread -
  // avatar/name/handle as their own header line (not squeezed beside the
  // text), the post text itself in a noticeably bigger size, the full
  // timestamp+date on its own line (no view count - this app doesn't
  // track one, so it's left out rather than faked), then a full-width,
  // evenly spaced icon row.
  if (expanded) {
    return (
      <View className="px-4 pt-3 pb-1">
        <View className="flex-row items-center justify-between mb-3">
          <Pressable onPress={goToProfile} disabled={isBoogie} className="flex-row items-center flex-1 mr-2">
            <Avatar uid={post.authorUid} url={post.authorAvatar} name={post.authorDisplayName} size={52} />
            <View className="ml-3 flex-1">
              <View className="flex-row items-center gap-1">
                <Text numberOfLines={1} className="text-white font-bold text-[16px]">
                  {post.authorDisplayName}
                </Text>
                {isBoogie && <Feather name="check-circle" size={14} color="#af1222" />}
              </View>
              <Text className="text-gray-500 text-[14px]">@{authorUsername}</Text>
            </View>
          </Pressable>
          {isOwnPost && (
            <Pressable onPress={onDelete} hitSlop={8}>
              <Feather name="trash-2" size={16} color="#6b7280" />
            </Pressable>
          )}
        </View>

        {!!post.text && <Text className="text-white text-[20px] leading-[26px] mb-3">{post.text}</Text>}

        {post.matchupCard && <MatchupCardView card={post.matchupCard} />}

        {post.imageUrl && (
          <Image
            source={{ uri: post.imageUrl }}
            className="w-full rounded-2xl mb-3 bg-white/5"
            style={{ aspectRatio: 16 / 9 }}
            resizeMode="cover"
          />
        )}

        {post.targetLabel && (
          <Pressable
            onPress={onPressTarget}
            className="flex-row items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg bg-white/5 self-start"
          >
            <Feather
              name={post.targetType === "trade" ? "repeat" : post.targetType === "waiver" ? "trending-up" : "activity"}
              size={11}
              color="#9ca3af"
            />
            <Text className="text-gray-400 text-[11px]">{post.targetLabel}</Text>
          </Pressable>
        )}

        <Text className="text-gray-500 text-[14px] pb-3 border-b border-white/10">
          {formatAbsoluteTimestamp(post.createdAtMs)}
        </Text>

        <View className="flex-row items-center justify-between py-3 border-b border-white/10">
          <Pressable
            onPress={() => (canInteract ? setReplyModalOpen(true) : router.push("/profile"))}
            className="flex-row items-center gap-2"
            hitSlop={8}
          >
            <Feather name="message-circle" size={20} color="#9ca3af" />
            {replyCount > 0 && <Text className="text-gray-500 text-[13px]">{replyCount}</Text>}
          </Pressable>

          <Pressable onPress={onRepost} disabled={!canInteract} className="flex-row items-center gap-2" hitSlop={8}>
            <Feather name="repeat" size={20} color={reposted ? "#00ba7c" : "#9ca3af"} />
            {repostCount > 0 && (
              <Text style={{ color: reposted ? "#00ba7c" : "#6b7280" }} className="text-[13px]">
                {repostCount}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={onLike} disabled={!canInteract} className="flex-row items-center gap-2" hitSlop={8}>
            <Feather name="heart" size={20} color={liked ? "#f91880" : "#9ca3af"} />
            {likeCount > 0 && (
              <Text style={{ color: liked ? "#f91880" : "#6b7280" }} className="text-[13px]">
                {likeCount}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={onShare} hitSlop={8}>
            <Feather name="share" size={20} color="#9ca3af" />
          </Pressable>
        </View>

        {replyModal}
      </View>
    );
  }

  return (
    <Pressable
      onPress={disableExpand ? undefined : expandPost}
      disabled={disableExpand}
      className="flex-row px-4 py-3 border-b border-white/10"
    >
      <Pressable onPress={goToProfile} hitSlop={4} className="mr-3">
        <Avatar uid={post.authorUid} url={post.authorAvatar} name={post.authorDisplayName} />
      </Pressable>

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-wrap flex-1 mr-2">
            <Pressable onPress={goToProfile}>
              <View className="flex-row items-center gap-1">
                <Text className="text-white font-bold text-[14px]">{post.authorDisplayName}</Text>
                {isBoogie && <Feather name="check-circle" size={13} color="#af1222" />}
              </View>
            </Pressable>
            <Text className="text-gray-500 text-[13px] ml-1">
              @{authorUsername} · {formatTwitterTimestamp(post.createdAtMs)}
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
          <Pressable
            onPress={() => (canInteract ? setReplyModalOpen(true) : router.push("/profile"))}
            className="flex-row items-center gap-1.5"
            hitSlop={8}
          >
            <Feather name="message-circle" size={16} color="#9ca3af" />
            {replyCount > 0 && <Text className="text-gray-500 text-[12px]">{replyCount}</Text>}
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

      {replyModal}
    </Pressable>
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
