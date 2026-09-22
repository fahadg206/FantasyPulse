import { useEffect, useState } from "react";
import { View, Text, TextInput, Modal, Pressable, Image, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { getUserProfile, UserProfile } from "../lib/socialAuth";
import { createPost, Post } from "../lib/posts";
import { pickImage, uploadImageAsync } from "../lib/mediaUpload";
import Avatar from "./Avatar";

const MAX_POST_LENGTH = 280;

interface ReplyModalProps {
  visible: boolean;
  onClose: () => void;
  post: Post;
  currentUid: string;
  onReplied: (reply: Post) => void;
}

// Real Twitter's own reply flow: a full-screen compose sheet (not a
// half-height bottom sheet), X to close in the top-left, the "Reply"
// submit button in the top-right - so it doesn't build on ComposeBox's
// own bottom-row layout, which assumes the submit button lives next to
// the text field, not in a header. Fetches the replying user's own
// profile itself (PostCard only carries a bare uid, not the full profile
// createPost needs) rather than requiring every PostCard caller to thread
// one through just for this.
export default function ReplyModal({ visible, onClose, post, currentUid, onReplied }: ReplyModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [text, setText] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText("");
    setImageUri(null);
    setError(null);
    setProfileLoading(true);
    getUserProfile(currentUid)
      .then(setProfile)
      .catch((error) => console.error("Error loading profile for reply:", error))
      .finally(() => setProfileLoading(false));
  }, [visible, currentUid]);

  const attachImage = async () => {
    setError(null);
    try {
      const uri = await pickImage();
      if (uri) setImageUri(uri);
    } catch (e: any) {
      setError(e.message || "Couldn't open your photo library.");
    }
  };

  const submit = async () => {
    if (!profile || (!text.trim() && !imageUri)) return;
    setPosting(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageUri) {
        imageUrl = await uploadImageAsync(imageUri, `postImages/${profile.uid}/${Date.now()}.jpg`);
      }
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
    } catch (e: any) {
      console.error("Error posting reply:", e);
      setError(e.message || "Something went wrong posting that.");
    } finally {
      setPosting(false);
    }
  };

  const canSubmit = !!profile && (!!text.trim() || !!imageUri) && !posting;

  const onCancel = () => {
    if (!text.trim() && !imageUri) {
      onClose();
      return;
    }
    Alert.alert("Discard reply?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <SafeAreaView className="flex-1 bg-[#0c0c0e]">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <View className="flex-row items-center justify-between px-4 py-2 border-b border-white/10">
            <Pressable onPress={onCancel} hitSlop={10}>
              <Text className="text-white text-[16px]">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              className={`px-4 py-1.5 rounded-full ${canSubmit ? "bg-brand" : "bg-brand/30"}`}
            >
              {posting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-white font-bold text-[13px]">Post</Text>
              )}
            </Pressable>
          </View>

          <View className="flex-1 px-4 pt-4">
            {/* The post being replied to - a left rail (avatar + a connecting
                line down to the reply avatar below, like a real Twitter
                thread) with its name/handle/text and the "Replying to"
                line in the column beside it. */}
            <View className="flex-row">
              <View className="items-center" style={{ width: 36 }}>
                <Avatar uid={post.authorUid} url={post.authorAvatar} name={post.authorDisplayName} size={36} />
                <View className="flex-1 w-[2px] bg-white/15 mt-2 mb-1" />
              </View>
              <View className="flex-1 ml-3">
                <View className="flex-row items-center flex-wrap gap-1">
                  <Text className="text-gray-300 font-bold text-[13px]">{post.authorDisplayName}</Text>
                  <Text className="text-gray-500 text-[12px]">@{post.authorUsername}</Text>
                </View>
                {!!post.text && (
                  <Text numberOfLines={4} className="text-gray-400 text-[13px] mt-0.5">
                    {post.text}
                  </Text>
                )}
                <Text className="text-gray-600 text-[13px] mt-3 mb-3">
                  Replying to <Text className="text-brand">@{post.authorUsername}</Text>
                </Text>
              </View>
            </View>

            {/* Compose row - avatar + a large growing field, filling the rest of the screen */}
            <View className="flex-row flex-1">
              {profileLoading || !profile ? (
                <View className="py-8 items-center flex-1">
                  <ActivityIndicator color="#af1222" />
                </View>
              ) : (
                <>
                  <Avatar uid={profile.uid} url={profile.avatar} name={profile.displayName} size={36} />
                  <View className="flex-1 ml-3">
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      placeholder="Post your reply"
                      placeholderTextColor="#6b7280"
                      multiline
                      autoFocus
                      maxLength={MAX_POST_LENGTH}
                      className="text-white text-[17px]"
                      style={{ minHeight: 100 }}
                    />
                    {imageUri && (
                      <View className="mt-2 self-start relative">
                        <Image source={{ uri: imageUri }} className="w-[160px] h-[100px] rounded-xl bg-white/5" resizeMode="cover" />
                        <Pressable
                          onPress={() => setImageUri(null)}
                          hitSlop={6}
                          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black items-center justify-center border border-white/20"
                        >
                          <Feather name="x" size={12} color="#fff" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </>
              )}
            </View>

            {error && <Text className="text-red-400 text-[12px] mb-2">{error}</Text>}
          </View>

          <View className="flex-row items-center justify-between px-4 py-3 border-t border-white/10">
            <Pressable onPress={attachImage} hitSlop={8}>
              <Feather name="image" size={20} color="#af1222" />
            </Pressable>
            <Text className="text-gray-600 text-[11px]">
              {text.length}/{MAX_POST_LENGTH}
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
