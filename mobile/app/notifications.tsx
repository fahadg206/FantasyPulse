import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly } from "../lib/socialAuth";
import { getNotifications, markAllNotificationsRead, AppNotification, NotificationType } from "../lib/notifications";
import { formatTwitterTimestamp } from "../lib/formatTime";
import Avatar from "../components/Avatar";

const TYPE_ICON: Record<NotificationType, keyof typeof Feather.glyphMap> = {
  reply: "message-circle",
  like: "heart",
  repost: "repeat",
  follow: "user-plus",
};
const TYPE_COLOR: Record<NotificationType, string> = {
  reply: "#3b82f6",
  like: "#f91880",
  repost: "#00ba7c",
  follow: "#af1222",
};

function verb(type: NotificationType): string {
  switch (type) {
    case "reply":
      return "replied to your post";
    case "like":
      return "liked your post";
    case "repost":
      return "reposted your post";
    case "follow":
      return "followed you";
  }
}

// The in-app notification center - a reply, a like, a repost, a new
// follower - written the instant the triggering action happens (see
// lib/notifications.ts for why this is the real deliverable instead of OS
// push, which this repo has no way to actually send yet).
export default function Notifications() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => onAuthChange(setAuthUser), []);

  const load = useCallback(async () => {
    if (!authUser || isReadOnly(authUser)) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const result = await getNotifications(authUser.uid);
      setItems(result);
      // Marking read happens after the list is already on screen, not
      // before - so whatever was unread when this screen opened still
      // renders with its unread treatment for this one viewing, the same
      // courtesy X's own notification tab gives you.
      markAllNotificationsRead(authUser.uid).catch(console.error);
    } catch (error) {
      console.error("Error loading notifications:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authUser]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const goTo = (n: AppNotification) => {
    if (n.type === "follow") {
      router.push(`/profile/${n.actorUsername}`);
    } else if (n.postId) {
      router.push(`/post/${n.postId}`);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.back()} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">Notifications</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : !authUser || isReadOnly(authUser) ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-[13px] text-center mb-3">Sign in to see your notifications.</Text>
          <Pressable onPress={() => router.push("/profile")}>
            <Text className="text-brand text-[13px] font-semibold">Sign In</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#af1222" />}
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <Text className="text-gray-500 text-[13px] text-center">Nothing here yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => goTo(item)}
              className={`flex-row items-start gap-3 px-4 py-3.5 border-b border-white/10 ${!item.read ? "bg-brand/5" : ""}`}
            >
              <View className="w-6 items-center pt-0.5">
                <Feather name={TYPE_ICON[item.type]} size={18} color={TYPE_COLOR[item.type]} />
              </View>
              <Avatar url={item.actorAvatar} name={item.actorDisplayName} size={36} />
              <View className="flex-1">
                <Text className="text-[14px] leading-[19px]">
                  <Text className="text-white font-bold">{item.actorDisplayName}</Text>
                  <Text className="text-gray-300"> {verb(item.type)}</Text>
                </Text>
                {!!item.postTextPreview && (
                  <Text numberOfLines={1} className="text-gray-500 text-[13px] mt-0.5">
                    {item.postTextPreview}
                  </Text>
                )}
                <Text className="text-gray-600 text-[11px] mt-1">{formatTwitterTimestamp(item.createdAtMs)}</Text>
              </View>
              {!item.read && <View className="w-2 h-2 rounded-full bg-brand mt-1.5" />}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
