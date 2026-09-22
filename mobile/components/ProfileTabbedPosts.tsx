import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  getPostsByAuthor,
  getPostsRepostedByUser,
  getPostsLikedByUser,
  isPostLiked,
  isPostReposted,
  Post,
} from "../lib/posts";
import PostCard from "./PostCard";

type ProfileTab = "posts" | "reposts" | "likes";

const PROFILE_TAB_LABEL: Record<ProfileTab, string> = { posts: "Posts", reposts: "Reposts", likes: "Likes" };
const PROFILE_TAB_EMPTY: Record<ProfileTab, string> = {
  posts: "Nothing posted yet.",
  reposts: "Nothing reposted yet.",
  likes: "Nothing liked yet.",
};

// X-style Posts / Reposts / Likes tabs on a profile - self-contained (owns
// its own tab state and refetches on tab change) so it drops onto any
// profile the same way. Used on both a real manager's own profile
// (app/profile/index.tsx) and their public one (app/profile/[username].tsx)
// - not on Boogie's profile, which only ever needed the one "Posts" list
// since he's a staff-writer persona rather than someone who likes/reposts
// other managers' posts.
export default function ProfileTabbedPosts({ profileUid, currentUid }: { profileUid: string; currentUid?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<ProfileTab>("posts");
  const [posts, setPosts] = useState<Post[]>([]);
  const [interactionState, setInteractionState] = useState<Record<string, { liked: boolean; reposted: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher =
      tab === "posts" ? getPostsByAuthor : tab === "reposts" ? getPostsRepostedByUser : getPostsLikedByUser;

    fetcher(profileUid)
      .then(async (result) => {
        if (cancelled) return;
        setPosts(result);
        if (currentUid) {
          const entries = await Promise.all(
            result.map(async (p) => {
              const [liked, reposted] = await Promise.all([
                isPostLiked(p.id, currentUid),
                isPostReposted(p.id, currentUid),
              ]);
              return [p.id, { liked, reposted }] as const;
            })
          );
          if (!cancelled) setInteractionState(Object.fromEntries(entries));
        } else {
          setInteractionState({});
        }
      })
      .catch((error) => console.error(`Error loading ${tab}:`, error))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [tab, profileUid, currentUid]);

  return (
    <View className="mt-2">
      <View className="flex-row border-b border-white/10">
        {(["posts", "reposts", "likes"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} className="flex-1 items-center pt-3 pb-2.5">
            <Text className={`text-[14px] font-bold ${tab === t ? "text-white" : "text-gray-500"}`}>
              {PROFILE_TAB_LABEL[t]}
            </Text>
            {tab === t && <View className="mt-2.5 h-[3px] w-[36px] rounded-full bg-brand" />}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#af1222" className="py-8" />
      ) : posts.length === 0 ? (
        <Text className="text-gray-500 text-[13px] text-center py-8">{PROFILE_TAB_EMPTY[tab]}</Text>
      ) : (
        <View className="border-b border-white/10">
          {posts.map((post) => (
            <View key={post.id}>
              {tab === "reposts" && (
                <View className="flex-row items-center gap-1.5 px-4 pt-2.5">
                  <Feather name="repeat" size={12} color="#6b7280" />
                  <Text className="text-gray-500 text-[11px] font-semibold">Reposted</Text>
                </View>
              )}
              <PostCard
                post={post}
                currentUid={currentUid}
                liked={interactionState[post.id]?.liked ?? false}
                reposted={interactionState[post.id]?.reposted ?? false}
                onDeleted={
                  tab === "posts" ? () => setPosts((prev) => prev.filter((p) => p.id !== post.id)) : undefined
                }
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
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
