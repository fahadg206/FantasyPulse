import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly, getUserProfile, getUserProfileByUsername, UserProfile } from "../../lib/socialAuth";
import { getFollowingUids, getFollowerUids, followUser, unfollowUser, isFollowing } from "../../lib/follows";
import Avatar from "../../components/Avatar";

// The list behind tapping "Following" or "Followers" on any profile -
// resolves whichever list was asked for to real profiles (the uid lists
// in follows.ts don't carry display info of their own) and lets you follow
// or unfollow straight from the row, the same as Twitter's own list does.
export default function Connections() {
  const { username, type } = useLocalSearchParams<{ username: string; type: string }>();
  const router = useRouter();
  const isFollowers = type === "followers";

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<UserProfile[] | null>(null);
  const [followState, setFollowState] = useState<Record<string, boolean>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => onAuthChange(setAuthUser), []);

  useEffect(() => {
    if (!username || !type) return;
    let cancelled = false;

    (async () => {
      try {
        const target = await getUserProfileByUsername(username);
        if (!target) {
          if (!cancelled) setProfiles([]);
          return;
        }
        const uids = isFollowers ? await getFollowerUids(target.uid) : await getFollowingUids(target.uid);
        const results = await Promise.all(uids.map((uid) => getUserProfile(uid).catch(() => null)));
        const found = results.filter((p): p is UserProfile => !!p);
        if (cancelled) return;
        setProfiles(found);

        if (authUser && !isReadOnly(authUser)) {
          const entries = await Promise.all(
            found.map(async (p) => [p.uid, await isFollowing(authUser.uid, p.uid)] as const)
          );
          if (!cancelled) setFollowState(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error("Error loading connections:", error);
        if (!cancelled) setProfiles([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [username, type, authUser, isFollowers]);

  const toggleFollow = async (targetUid: string) => {
    if (!authUser || isReadOnly(authUser) || authUser.uid === targetUid) return;
    setBusyUid(targetUid);
    const next = !followState[targetUid];
    setFollowState((s) => ({ ...s, [targetUid]: next }));
    try {
      if (next) await followUser(authUser.uid, targetUid);
      else await unfollowUser(authUser.uid, targetUid);
    } catch (error) {
      console.error("Error toggling follow:", error);
      setFollowState((s) => ({ ...s, [targetUid]: !next }));
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 pt-3 pb-3 border-b border-white/10">
        <Pressable onPress={() => router.back()} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">{isFollowers ? "Followers" : "Following"}</Text>
      </View>

      {profiles === null ? (
        <View className="items-center py-10">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : profiles.length === 0 ? (
        <View className="items-center py-10 px-6">
          <Text className="text-gray-500 text-[13px] text-center">
            {isFollowers ? "No followers yet." : "Not following anyone yet."}
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {profiles.map((p) => {
            const isSelf = authUser && !isReadOnly(authUser) && authUser.uid === p.uid;
            return (
              <Pressable
                key={p.uid}
                onPress={() => router.push(`/profile/${p.username}`)}
                className="flex-row items-center px-4 py-3 border-b border-white/10"
              >
                <Avatar uid={p.uid} url={p.avatar} name={p.displayName} size={44} />
                <View className="ml-3 flex-1 mr-2">
                  <Text numberOfLines={1} className="text-white font-bold text-[14px]">
                    {p.displayName}
                  </Text>
                  <Text className="text-gray-500 text-[12px]">@{p.username}</Text>
                  {p.bio && (
                    <Text numberOfLines={1} className="text-gray-400 text-[12px] mt-0.5">
                      {p.bio}
                    </Text>
                  )}
                </View>
                {!isSelf && authUser && !isReadOnly(authUser) && (
                  <Pressable
                    onPress={() => toggleFollow(p.uid)}
                    disabled={busyUid === p.uid}
                    className={`px-4 py-1.5 rounded-full ${followState[p.uid] ? "bg-transparent border border-white/20" : "bg-brand"}`}
                  >
                    {busyUid === p.uid ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text className="text-white font-bold text-[12px]">
                        {followState[p.uid] ? "Following" : "Follow"}
                      </Text>
                    )}
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
