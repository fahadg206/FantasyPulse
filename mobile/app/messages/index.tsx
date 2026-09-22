import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { onAuthChange, isReadOnly } from "../../lib/socialAuth";
import { getConversations, otherParticipant, Conversation } from "../../lib/messages";
import { formatTwitterTimestamp } from "../../lib/formatTime";
import Avatar from "../../components/Avatar";

// Direct messages, X-style: a flat list of one-on-one conversations, most
// recently active first, read/unread distinguished by weight and a dot -
// no group chats, no request/accept split, same scope as the rest of
// this app's social features.
export default function Messages() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthChange(setAuthUser), []);

  const load = useCallback(async () => {
    if (!authUser || isReadOnly(authUser)) {
      setConversations([]);
      setLoading(false);
      return;
    }
    try {
      const result = await getConversations(authUser.uid);
      setConversations(result);
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.back()} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <Text className="text-white text-[17px] font-bold">Messages</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : !authUser || isReadOnly(authUser) ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-[13px] text-center mb-3">Sign in to send and receive messages.</Text>
          <Pressable onPress={() => router.push("/profile")}>
            <Text className="text-brand text-[13px] font-semibold">Sign In</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#af1222" />}
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <Feather name="mail" size={28} color="#3f3f46" />
              <Text className="text-gray-500 text-[13px] text-center mt-3">
                No messages yet - message a manager from their profile to start a conversation.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const otherUid = otherParticipant(item, authUser.uid);
            const other = otherUid ? item.participantProfiles[otherUid] : undefined;
            const unread = item.unreadBy.includes(authUser.uid);
            if (!other) return null;
            return (
              <Pressable
                onPress={() => router.push({ pathname: "/messages/[conversationId]", params: { conversationId: item.id } } as any)}
                className="flex-row items-center gap-3 px-4 py-3.5 border-b border-white/10"
              >
                <Avatar url={other.avatar} name={other.displayName} size={48} />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between">
                    <Text numberOfLines={1} className={`text-[14px] flex-1 mr-2 ${unread ? "text-white font-bold" : "text-gray-300 font-semibold"}`}>
                      {other.displayName}
                    </Text>
                    <Text className="text-gray-600 text-[11px]">{formatTwitterTimestamp(item.lastMessageAtMs)}</Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    className={`text-[13px] mt-0.5 ${unread ? "text-white font-semibold" : "text-gray-500"}`}
                  >
                    {item.lastMessageSenderUid === authUser.uid ? "You: " : ""}
                    {item.lastMessageText || "Say hello 👋"}
                  </Text>
                </View>
                {unread && <View className="w-2.5 h-2.5 rounded-full bg-brand" />}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
