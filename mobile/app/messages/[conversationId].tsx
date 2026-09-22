import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore/lite";
import { db } from "../../lib/firebase";
import { onAuthChange, isReadOnly } from "../../lib/socialAuth";
import { getMessages, sendMessage, markConversationRead, otherParticipant, Conversation, Message } from "../../lib/messages";
import { formatTwitterTimestamp } from "../../lib/formatTime";
import Avatar from "../../components/Avatar";

// One conversation's message thread - bubbles, sender's own on the right
// in brand color, the other person's on the left, same visual language as
// X's DMs. Polls every few seconds while open rather than a realtime
// listener - this app's Firestore access is the /lite (REST) SDK
// throughout, chosen for its simplicity over the full SDK's realtime
// listeners, so a short poll is the same tradeoff every other "live-ish"
// screen here already makes (the matchup feed, big-play toasts).
const POLL_INTERVAL_MS = 4000;

export default function ConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const listRef = useRef<FlatList>(null);

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => onAuthChange(setAuthUser), []);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      const [convoSnap, msgs] = await Promise.all([
        getDoc(doc(db, "conversations", conversationId)),
        getMessages(conversationId),
      ]);
      if (convoSnap.exists()) {
        setConversation({ id: convoSnap.id, ...(convoSnap.data() as Omit<Conversation, "id">) });
      }
      setMessages(msgs);
    } catch (error) {
      console.error("Error loading conversation:", error);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (authUser && !isReadOnly(authUser) && conversationId) {
      markConversationRead(conversationId, authUser.uid).catch(console.error);
    }
  }, [authUser, conversationId, messages.length]);

  const send = async () => {
    if (!authUser || !conversation || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      const message = await sendMessage(conversation, authUser.uid, text);
      setMessages((prev) => [...prev, message]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (error) {
      console.error("Error sending message:", error);
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const other = authUser && conversation ? conversation.participantProfiles[otherParticipant(conversation, authUser.uid) ?? ""] : undefined;

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <Pressable onPress={() => router.back()} hitSlop={10} className="mr-3">
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        {other && <Avatar url={other.avatar} name={other.displayName} size={30} />}
        <View className="ml-2.5">
          <Text className="text-white text-[15px] font-bold">{other?.displayName ?? "Message"}</Text>
          {other?.username && <Text className="text-gray-500 text-[12px]">@{other.username}</Text>}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1" keyboardVerticalOffset={90}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4 py-3"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View className="items-center py-10">
                <Text className="text-gray-500 text-[13px] text-center">Say hello 👋</Text>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.senderUid === authUser?.uid;
              return (
                <View className={`flex-row mb-2.5 ${mine ? "justify-end" : "justify-start"}`}>
                  <View
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${mine ? "bg-brand rounded-br-md" : "bg-white/10 rounded-bl-md"}`}
                  >
                    <Text className="text-white text-[14px] leading-[19px]">{item.text}</Text>
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              messages.length > 0 ? (
                <Text className="text-gray-600 text-[11px] text-center mt-1">
                  {formatTwitterTimestamp(messages[messages.length - 1].createdAtMs)}
                </Text>
              ) : null
            }
          />

          <View className="flex-row items-end gap-2 px-3 py-2.5 border-t border-white/10">
            <View className="flex-1 bg-white/10 rounded-full px-4 py-2.5 max-h-[120px]">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Start a message..."
                placeholderTextColor="#6b7280"
                multiline
                className="text-white text-[14px]"
              />
            </View>
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              className={`w-9 h-9 rounded-full items-center justify-center ${draft.trim() ? "bg-brand" : "bg-white/10"}`}
            >
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="arrow-up" size={17} color="#fff" />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
