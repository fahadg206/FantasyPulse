import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Image, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { storage, StorageKeys } from "../lib/storage";
import SelectLeague from "../components/SelectLeague";

const logo = require("../assets/images/Transparent.png");
const SEASONS = ["2026", "2025"];

export default function Home() {
  const [text, setText] = useState("");
  const [usernameSubmitted, setUsernameSubmitted] = useState(false);
  const [storedUsernames, setStoredUsernames] = useState<string[]>([]);
  const [cleared, setCleared] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(SEASONS[0]);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const existingLeagueID = await storage.getItem(StorageKeys.selectedLeagueID);
      if (existingLeagueID) {
        router.replace(`/league/${existingLeagueID}`);
        return;
      }
      const usernames = await storage.getJSON<string[]>(StorageKeys.usernames);
      if (usernames) setStoredUsernames(usernames);
    })();
  }, []);

  const onFormSubmit = async () => {
    setCleared(false);
    setUsernameSubmitted(true);
    const trimmed = text.trim().toLowerCase();
    if (trimmed && !storedUsernames.includes(trimmed)) {
      const next = [...storedUsernames, trimmed];
      setStoredUsernames(next);
      await storage.setJSON(StorageKeys.usernames, next);
    }
    await storage.setItem(StorageKeys.usernameSubmitted, JSON.stringify(true));
  };

  const onStorageCleared = async () => {
    await storage.clearLeagueSelection();
    await storage.removeItem(StorageKeys.usernames);
    setStoredUsernames([]);
    setText("");
    setUsernameSubmitted(false);
    setCleared(true);
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0c0c0e]">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow px-6 pb-10" keyboardShouldPersistTaps="handled">
          <View className="items-center pt-10 pb-8">
            <Image source={logo} className="w-[120px] h-[120px]" resizeMode="contain" />
            <Text className="text-white text-[26px] font-bold mt-2">FANTASY PULSE</Text>
            <Text className="text-gray-400 text-[13px] mt-1 text-center">
              Personalized content for your Sleeper league
            </Text>
          </View>

          <View className="bg-[#1c1c1e] rounded-2xl p-5">
            <Text className="text-[11px] font-bold tracking-wider text-gray-400 mb-2">SLEEPER USERNAME</Text>
            <View className="flex-row items-center bg-black/30 rounded-xl px-3 border border-white/10">
              <Feather name="search" size={16} color="#6b6b70" />
              <TextInput
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  if (usernameSubmitted) setUsernameSubmitted(false);
                }}
                placeholder="e.g. fahadg"
                placeholderTextColor="#6b6b70"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={onFormSubmit}
                className="flex-1 px-2.5 py-3 text-[15px] text-white"
              />
            </View>

            <Text className="text-[11px] font-bold tracking-wider text-gray-400 mt-4 mb-2">SEASON</Text>
            <View className="flex-row bg-black/30 rounded-xl border border-white/10 overflow-hidden self-start">
              {SEASONS.map((season) => (
                <Pressable
                  key={season}
                  onPress={() => {
                    setSelectedSeason(season);
                    setUsernameSubmitted(false);
                  }}
                  className={`px-5 py-2.5 min-h-[44px] items-center justify-center ${selectedSeason === season ? "bg-brand" : ""}`}
                >
                  <Text className={selectedSeason === season ? "text-white font-bold" : "text-gray-300"}>
                    {season}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={onFormSubmit}
              disabled={!text.trim()}
              className={`flex-row items-center justify-center gap-2 bg-brand rounded-xl py-3.5 mt-5 ${!text.trim() ? "opacity-40" : ""}`}
            >
              <Text className="text-white font-bold text-[15px]">Find My Leagues</Text>
              <Feather name="arrow-right" size={16} color="#ffffff" />
            </Pressable>

            {storedUsernames.length > 0 && (
              <Pressable onPress={onStorageCleared} hitSlop={6} className="self-center mt-3">
                <Text className="text-gray-500 text-[12px]">Clear saved usernames</Text>
              </Pressable>
            )}
          </View>

          {storedUsernames.length > 0 && (
            <View className="mt-5">
              <Text className="text-[11px] font-bold tracking-wider text-gray-500 mb-2">RECENT</Text>
              <View className="flex-row flex-wrap gap-2">
                {storedUsernames.map((u) => (
                  <Pressable
                    key={u}
                    onPress={() => {
                      setUsernameSubmitted(false);
                      setText(u);
                    }}
                    className="border border-white/15 rounded-full px-3 py-1.5"
                  >
                    <Text className="text-gray-300 text-[12px]">{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View className="mt-6">
            <SelectLeague
              usernameSubmitted={usernameSubmitted}
              username={text}
              selectedSeason={selectedSeason}
              usernameCleared={cleared}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
