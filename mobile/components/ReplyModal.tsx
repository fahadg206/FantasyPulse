import { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getUserProfile, UserProfile } from "../lib/socialAuth";
import { createPost, Post } from "../lib/posts";
import Avatar from "./Avatar";
import ComposeBox from "./ComposeBox";

interface ReplyModalProps {
  visible: boolean;
  onClose: () => void;
  post: Post;
  currentUid: string;
  onReplied: (reply: Post) => void;
}

// The "tap the reply icon, a compose sheet slides up" flow real Twitter
// uses, instead of leaving the screen you're on - the original post shown
// muted up top for context, then the same ComposeBox row every other
// compose surface in this app uses. Fetches the replying user's own
// profile itself (PostCard only carries a bare uid, not the full profile
// createPost needs) rather than requiring every PostCard caller to thread
// one through just for this.
export default function ReplyModal({ visible, onClose, post, currentUid, onReplied }: ReplyModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setProfileLoading(true);
    getUserProfile(currentUid)
      .then(setProfile)
      .catch((error) => console.error("Error loading profile for reply:", error))
      .finally(() => setProfileLoading(false));
  }, [visible, currentUid]);

  const submit = async (text: string, imageUrl?: string) => {
    if (!profile) return;
    const reply = await createPost({
      authorUid: profile.uid,
      authorUsername: profile.username,
      authorDisplayName: profile.displayName,
      authorAvatar: profile.avatar,
      text,
      imageUrl,
      parentPostId: post.id,
    });
    onReplied(reply);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View className="bg-[#0c0c0e] rounded-t-3xl border-t border-white/10 pt-2 pb-8 max-h-[80%]">
            <View className="items-center py-1.5">
              <View className="w-9 h-1 rounded-full bg-white/20" />
            </View>

            <View className="flex-row items-center justify-between px-4 py-2">
              <Pressable onPress={onClose} hitSlop={10}>
                <Feather name="x" size={22} color="#fff" />
              </Pressable>
              <Text className="text-white font-bold text-[15px]">Reply</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* The post being replied to - compact and muted, for context only */}
            <View className="flex-row px-4 pt-2 pb-3">
              <Avatar uid={post.authorUid} url={post.authorAvatar} name={post.authorDisplayName} size={34} />
              <View className="flex-1 ml-3">
                <View className="flex-row items-center flex-wrap gap-1">
                  <Text className="text-gray-300 font-bold text-[13px]">{post.authorDisplayName}</Text>
                  <Text className="text-gray-500 text-[12px]">@{post.authorUsername}</Text>
                </View>
                {!!post.text && (
                  <Text numberOfLines={3} className="text-gray-400 text-[13px] mt-0.5">
                    {post.text}
                  </Text>
                )}
                <Text className="text-gray-600 text-[12px] mt-1.5">
                  Replying to <Text className="text-brand">@{post.authorUsername}</Text>
                </Text>
              </View>
            </View>

            {profileLoading || !profile ? (
              <View className="py-8 items-center">
                <ActivityIndicator color="#af1222" />
              </View>
            ) : (
              <ComposeBox profile={profile} placeholder="Post your reply" submitLabel="Reply" autoFocus onSubmit={submit} />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
