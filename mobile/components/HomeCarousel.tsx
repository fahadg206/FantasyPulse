import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { backend, sleeper } from "../lib/api";
import getMatchupData from "../lib/getMatchupData";
import { generateHeadlines } from "../lib/generateHeadlines";

const logo = require("../assets/images/Transparent.png");

interface HeadlineItem {
  id?: number;
  url?: string;
  category?: string;
  title?: string;
  description?: string | number;
  scorerStyle?: boolean;
  avatarSource?: any;
}

const DEFAULT_HEADLINES: HeadlineItem[] = [
  {
    id: 10,
    category: "News",
    title: "League Buzz is warming up",
    description: "Check back once this week's matchups have data to work with.",
  },
];

// Rotates across cards so the carousel doesn't read as one flat block of
// identical dark cards.
const GRADIENTS: [string, string][] = [
  ["#3a0d14", "#0c0c0e"],
  ["#0d2438", "#0c0c0e"],
  ["#2e2306", "#0c0c0e"],
];

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  News: "newspaper",
  "Question of the Week": "help-circle",
  "Nail-Biter": "flash",
  Blowout: "flame",
  "Stud of the Week": "star",
  "Matchup to Watch": "eye",
  "On Fire": "flame",
};

// Gives the LLM a limited window to answer before falling back - gpt-4o-mini
// normally responds in a few seconds, but this guarantees the carousel
// never sits waiting on a slow/stuck network call.
function withClientTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Client timeout")), ms)),
  ]);
}

export default function HomeCarousel({ leagueID }: { leagueID: string }) {
  const [headlines, setHeadlines] = useState<HeadlineItem[]>(DEFAULT_HEADLINES);
  const [topScorer, setTopScorer] = useState<{ name: string; avatar: any; points: number } | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ data: nflState }, playersData] = await Promise.all([
          sleeper.getNflState(),
          backend.fetchPlayers(leagueID),
        ]);
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;

        const [{ matchupMap, updatedScheduleData }, llmHeadlines] = await Promise.all([
          getMatchupData(leagueID, week, playersData),
          withClientTimeout(backend.fetchHeadlines(leagueID), 10000).catch((error) => {
            // Expected and already handled by the local-headlines fallback
            // below - console.error would pop Expo's red LogBox screen for
            // a case that isn't actually broken, so this stays at log level.
            console.log("Headlines didn't respond in time, falling back to generated headlines:", error);
            return null;
          }),
        ]);
        if (cancelled) return;

        // Prefer the LLM's creative writing when it answers in time; fall
        // back to the reliable, data-driven generator (same real stats,
        // just templated instead of written) if it's slow or fails.
        if (llmHeadlines && Array.isArray(llmHeadlines) && llmHeadlines.length > 0) {
          setHeadlines(llmHeadlines);
        } else {
          const generated = generateHeadlines(matchupMap, updatedScheduleData, week, playersData);
          if (generated.length > 0) setHeadlines(generated as HeadlineItem[]);
        }

        const users = Object.values(updatedScheduleData);
        const sorted = [...users].sort(
          (a, b) => parseFloat(b.team_points || "0") - parseFloat(a.team_points || "0")
        );
        const top = sorted[0];
        if (top && parseFloat(top.team_points || "0") > 0) {
          setTopScorer({ name: top.name, avatar: top.avatar, points: parseFloat(top.team_points || "0") });
        }
      } catch (error) {
        console.error("Error loading league buzz:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const cards: HeadlineItem[] = topScorer
    ? [
        {
          id: -1,
          category: "Top Scorer of the Week",
          title: topScorer.name,
          description: topScorer.points,
          scorerStyle: true,
          avatarSource: topScorer.avatar,
        },
        ...headlines,
      ]
    : headlines;

  return (
    <View className="w-full">
      <Text className="px-4 mb-3 text-[17px] font-bold text-white">
        League Buzz <Text className="text-gray-500 font-normal">: Catch Up on All the Action</Text>
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 gap-3">
        {cards.map((item, index) => {
          const badgeSource = item.avatarSource ?? (item.url ? { uri: item.url } : logo);
          const icon = item.category ? CATEGORY_ICON[item.category] : undefined;
          const gradient = GRADIENTS[index % GRADIENTS.length];

          return (
            <Pressable key={item.id} className="rounded-2xl overflow-hidden" style={{ width: 250 }}>
              {/* No numberOfLines cap on title/description and no fixed
                  card height - the whole headline excerpt should always be
                  readable instead of getting clipped, so the card grows to
                  fit its own content. */}
              <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} className="p-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <View
                    className={`items-center justify-center overflow-hidden ${
                      item.scorerStyle ? "w-[30px] h-[30px] rounded-full border border-brand" : "w-[26px] h-[26px] rounded-lg bg-white/10"
                    }`}
                  >
                    {item.scorerStyle || item.url ? (
                      <Image source={badgeSource} className="w-full h-full" resizeMode="cover" />
                    ) : icon ? (
                      <Ionicons name={icon} size={13} color="#e2465a" />
                    ) : (
                      <Image source={logo} className="w-[16px] h-[16px]" resizeMode="contain" />
                    )}
                  </View>
                  <Text numberOfLines={1} className="flex-1 text-[#e45263] text-[9px] font-bold uppercase tracking-wide">
                    {item.category}
                  </Text>
                </View>

                <Text className="text-white text-[15px] font-bold leading-[20px] mb-1.5">{item.title}</Text>

                {typeof item.description === "number" ? (
                  <Text className="text-white text-[22px] font-bold">{item.description.toFixed(1)} pts</Text>
                ) : (
                  <Text className="text-gray-400 text-[12px] leading-[18px]">{item.description}</Text>
                )}
              </LinearGradient>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
