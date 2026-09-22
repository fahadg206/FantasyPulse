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
  /** smaller avatar, tighter padding, no divider above - for compose rows embedded mid-page (CommentsSection, a thread's reply bar) rather than a screen's own top-level composer */
  compact?: boolean;
  /** "Post" for a standalone post, "Reply" when replying to something */
  submitLabel?: string;
  autoFocus?: boolean;
  onSubmit: (text: string, imageUrl?: string) => Promise<void>;
}

// One Twitter-style compose row - avatar, an unstyled (no pill/bubble)
// growing text field, an attach-image button, and a pill submit button -
// shared by the Feed's top-level composer, every CommentsSection, the
// reply modal, and a post thread's own reply bar, so a reply never looks
// different depending on where it was written from. Uploads any attached
// image to this user's own folder in Storage right before posting, so a
// cancelled/abandoned draft never uploads anything.
export default function ComposeBox({ profile, placeholder, compact, submitLabel = "Post", autoFocus, onSubmit }: ComposeBoxProps) {
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
    <View className={`flex-row px-4 ${compact ? "py-2.5" : "py-3 border-b border-white/10"}`}>
      <Avatar uid={profile.uid} url={profile.avatar} name={profile.displayName} size={compact ? 34 : 42} />
      <View className="flex-1 ml-3">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor="#6b7280"
          multiline
          autoFocus={autoFocus}
          maxLength={MAX_POST_LENGTH}
          className={`text-white ${compact ? "text-[14px] min-h-[32px]" : "text-[15px] min-h-[40px]"}`}
        />

        {imageUri && (
          <View className="mt-2 self-start relative">
            <Image source={{ uri: imageUri }} className="w-[140px] h-[90px] rounded-xl bg-white/5" resizeMode="cover" />
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

        <View className="flex-row items-center justify-between mt-2">
          <Pressable onPress={attachImage} hitSlop={8}>
            <Feather name="image" size={compact ? 17 : 19} color="#af1222" />
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            className={`px-4 py-1.5 rounded-full ${canSubmit ? "bg-brand" : "bg-brand/30"}`}
          >
            {posting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-bold text-[13px]">{submitLabel}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
