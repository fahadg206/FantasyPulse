import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { getFeedPostsForLeague, Post } from "../lib/posts";
import PostCard from "./PostCard";

// What used to be the AI-generated headlines carousel at the top of the
// dashboard is now the real public Feed - Boogie's trade/score posts and
// whatever real managers have actually posted, front and center the
// moment anyone opens the league. A lightweight, read-only preview (no
// like/repost here, and no per-post interaction-state fetch) that hands
// off to the real Feed screen for anything more than a glance.
//
// Scoped to this specific league - someone opening one league's dashboard
// shouldn't see another league's Boogie announcements or trade posts
// mixed in here, any more than the full Feed screen should.
export default function FeedPreview({ leagueID }: { leagueID: string }) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    getFeedPostsForLeague(leagueID, 4)
      .then((r) => !cancelled && setPosts(r))
      .catch((error) => {
        console.error("Error loading feed preview:", error);
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const goToFeed = () => router.push({ pathname: "/feed", params: { leagueID } });

  return (
    <View>
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-[13px] font-bold tracking-wider text-gray-500">FEED</Text>
        <Pressable onPress={goToFeed} className="flex-row items-center gap-1" hitSlop={6}>
          <Text className="text-brand text-[12px] font-semibold">See All</Text>
          <Feather name="chevron-right" size={12} color="#af1222" />
        </Pressable>
      </View>

      {posts === null ? (
        <ActivityIndicator color="#af1222" className="py-6" />
      ) : posts.length === 0 ? (
        <Pressable onPress={goToFeed} className="px-4">
          <Text className="text-gray-500 text-[12px]">Nothing here yet - be the first to post.</Text>
        </Pressable>
      ) : (
        <View className="border-y border-white/10 bg-[#0c0c0e]">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} liked={false} reposted={false} />
          ))}
        </View>
      )}
    </View>
  );
}
