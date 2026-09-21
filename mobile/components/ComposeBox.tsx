import { useState } from "react";
import { View, Text, TextInput, Pressable, Image, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { UserProfile } from "../lib/socialAuth";
import { pickImage, uploadImageAsync } from "../lib/mediaUpload";
import Avatar from "./Avatar";

const MAX_POST_LENGTH = 280;

interface ComposeBoxProps {
  profile: UserProfile;
  placeholder: string;
  compact?: boolean;
  onSubmit: (text: string, imageUrl?: string) => Promise<void>;
}

// Shared by the Feed's top-level composer and every CommentsSection - text
// plus an optional attached image, uploaded to this user's own folder in
// Storage right before posting so a cancelled/abandoned draft never uploads
// anything.
export default function ComposeBox({ profile, placeholder, compact, onSubmit }: ComposeBoxProps) {
  const [text, setText] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!text.trim() && !imageUri) return;
    setPosting(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageUri) {
        imageUrl = await uploadImageAsync(imageUri, `postImages/${profile.uid}/${Date.now()}.jpg`);
      }
      await onSubmit(text, imageUrl);
      setText("");
      setImageUri(null);
    } catch (e: any) {
      console.error("Error posting:", e);
      setError(e.message || "Something went wrong posting that.");
    } finally {
      setPosting(false);
    }
  };

  const canSubmit = (!!text.trim() || !!imageUri) && !posting;

  return (
    <View className={compact ? "px-4 py-3" : "flex-row px-4 py-3 border-b border-white/10"}>
      {!compact && (
        <View className="mr-3">
          <Avatar uid={profile.uid} url={profile.avatar} name={profile.displayName} />
        </View>
      )}
      <View className="flex-1">
        <View className={compact ? "flex-row items-center gap-2" : undefined}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor="#6b7280"
            multiline={!compact}
            maxLength={MAX_POST_LENGTH}
            className={
              compact
                ? "flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-white text-[13px]"
                : "text-white text-[15px] min-h-[40px]"
            }
          />
          {compact && (
            <>
              <Pressable onPress={attachImage} hitSlop={8} className="w-9 h-9 items-center justify-center">
                <Feather name="image" size={18} color="#9ca3af" />
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                className={`w-9 h-9 rounded-full items-center justify-center ${canSubmit ? "bg-brand" : "bg-brand/30"}`}
              >
                {posting ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="send" size={15} color="#fff" />}
              </Pressable>
            </>
          )}
        </View>

        {imageUri && (
          <View className="mt-2 self-start relative">
            <Image source={{ uri: imageUri }} className="w-[120px] h-[80px] rounded-xl bg-white/5" resizeMode="cover" />
            <Pressable
              onPress={() => setImageUri(null)}
              hitSlop={6}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black items-center justify-center border border-white/20"
            >
              <Feather name="x" size={12} color="#fff" />
            </Pressable>
          </View>
        )}

        {error && <Text className="text-red-400 text-[11px] mt-1.5">{error}</Text>}

        {!compact && (
          <View className="flex-row items-center justify-between mt-2">
            <View className="flex-row items-center gap-4">
              <Pressable onPress={attachImage} hitSlop={8}>
                <Feather name="image" size={19} color="#af1222" />
              </Pressable>
              <Text className="text-gray-600 text-[11px]">{text.length}/{MAX_POST_LENGTH}</Text>
            </View>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              className={`px-4 py-1.5 rounded-full ${canSubmit ? "bg-brand" : "bg-brand/30"}`}
            >
              {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-bold text-[13px]">Post</Text>}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
