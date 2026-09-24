import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { MotiView } from "moti";
import Svg, { Path } from "react-native-svg";
import { sleeper } from "../../../lib/api";
import getMatchupData from "../../../lib/getMatchupData";
import { storage, StorageKeys } from "../../../lib/storage";
import ArticleCarousel from "../../../components/ArticleCarousel";
import FeedPreview from "../../../components/FeedPreview";
import HomePoll from "../../../components/HomePoll";
import TransactionsTicker from "../../../components/TransactionsTicker";
import TrendingPlayers from "../../../components/TrendingPlayers";
import { announceLeagueTransactions } from "../../../lib/announceTransactions";

const helmet = require("../../../assets/images/helmet2.png");

type QuickLink = { label: string; icon: keyof typeof Ionicons.glyphMap | keyof typeof Feather.glyphMap; family: "ion" | "feather"; path: string };

type PulseStats = {
  topScorer?: { name: string; avatar: any; points: number };
  closest?: { a: string; b: string; diff: number };
  week?: number;
  teamCount?: number;
};

// A signature EKG-style line tying the visual language back to the "Pulse"
// name - two identical blips over a flat baseline, with a slow ambient
// opacity pulse rather than anything that competes with the content below.
function PulseLine() {
  return (
    <MotiView
      from={{ opacity: 0.45 }}
      animate={{ opacity: 1 }}
      transition={{ type: "timing", duration: 1100, loop: true, repeatReverse: true }}
    >
      <Svg width="100%" height={26} viewBox="0 0 300 40" preserveAspectRatio="none">
        <Path
          d="M0,20 H40 L50,4 L60,36 L70,20 H140 L150,4 L160,36 L170,20 H300"
          stroke="#e2465a"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </MotiView>
  );
}

function PulseCard({
  icon,
  label,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="w-[210px] bg-[#141416] border border-white/10 rounded-2xl p-3.5 mr-3">
      <View className="flex-row items-center gap-1.5 mb-2.5">
        <Ionicons name={icon} size={13} color="#e2465a" />
        <Text className="text-[10px] font-bold tracking-wider text-gray-400">{label}</Text>
      </View>
      {children}
    </View>
  );
}

export default function Dashboard() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const [leagueName, setLeagueName] = useState("");
  const [leagueAvatar, setLeagueAvatar] = useState<string | null>(null);
  const [pulse, setPulse] = useState<PulseStats>({});

  useEffect(() => {
    if (!leagueID) return;
    setLeagueName("");
    (async () => {
      // The cached name/id pair is only a fast paint for whichever league
      // the user most recently picked from Select League - it's stale (or
      // outright wrong) the moment you're viewing a different leagueID,
      // like jumping into another manager's league from their profile, so
      // it's only trusted when the cached id actually matches this one.
      const [storedId, storedName] = await Promise.all([
        storage.getItem(StorageKeys.selectedLeagueID),
        storage.getItem(StorageKeys.selectedLeagueName),
      ]);
      if (storedId === leagueID && storedName) setLeagueName(storedName);
      try {
        const { data } = await sleeper.getLeague(leagueID);
        setLeagueAvatar(data?.avatar ?? null);
        if (data?.name) setLeagueName(data.name);
      } catch (error) {
        console.error("Error fetching league info:", error);
      }
    })();
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: nflState } = await sleeper.getNflState();
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const { matchupMap, updatedScheduleData } = await getMatchupData(leagueID, week);
        if (cancelled) return;

        const users = Object.values(updatedScheduleData);
        const scored = users.filter((u) => parseFloat(u.team_points || "0") > 0);
        const top = [...scored].sort(
          (a, b) => parseFloat(b.team_points || "0") - parseFloat(a.team_points || "0")
        )[0];

        let closest: PulseStats["closest"];
        for (const [, teams] of matchupMap) {
          const [t1, t2] = teams;
          if (!t1 || !t2) continue;
          const p1 = parseFloat(t1.team_points || "0");
          const p2 = parseFloat(t2.team_points || "0");
          if (p1 === 0 && p2 === 0) continue;
          const diff = Math.abs(p1 - p2);
          if (!closest || diff < closest.diff) closest = { a: t1.name, b: t2.name, diff };
        }

        setPulse({
          topScorer: top ? { name: top.name, avatar: top.avatar, points: parseFloat(top.team_points || "0") } : undefined,
          closest,
          week,
          teamCount: users.length,
        });
      } catch (error) {
        console.error("Error computing league pulse stats:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID) return;
    // The dashboard is the most-visited screen in the app - backfilling
    // Boogie's trade/waiver posts here (not just from the Trades tab)
    // means the whole season's transaction history gets announced the
    // moment anyone opens the league, not only once someone happens to
    // tap into Trades specifically.
    announceLeagueTransactions(leagueID).catch((error) =>
      console.error("Error backfilling Boogie's transaction posts:", error)
    );
  }, [leagueID]);

  if (!leagueID) return null;

  const links: QuickLink[] = [
    { label: "Standings", icon: "list", family: "ion", path: `/league/${leagueID}/standings` },
    { label: "Schedule", icon: "calendar", family: "feather", path: `/league/${leagueID}/schedule` },
    { label: "Managers", icon: "people", family: "ion", path: `/league/${leagueID}/leaguemanagers` },
    { label: "Rivalry", icon: "pulse", family: "ion", path: `/league/${leagueID}/rivalry` },
    { label: "Strength of Schedule", icon: "flame", family: "ion", path: `/league/${leagueID}/strengthofschedule` },
    { label: "Trades", icon: "repeat", family: "feather", path: `/league/${leagueID}/tradecalculator` },
    { label: "Draft", icon: "clipboard", family: "feather", path: `/league/${leagueID}/draft` },
    { label: "History", icon: "trophy", family: "ion", path: `/league/${leagueID}/history` },
  ];

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" showsVerticalScrollIndicator={false}>
      <LinearGradient colors={["#2a0a0e", "#150507", "#0c0c0e"]} locations={[0, 0.5, 1]} className="pt-7 pb-5 px-6">
        <View className="items-center">
          <Image
            source={leagueAvatar ? { uri: `https://sleepercdn.com/avatars/thumbs/${leagueAvatar}` } : helmet}
            className="w-[56px] h-[56px] rounded-full mb-2.5 border-2 border-brand"
          />
          <Text className="text-[10px] font-bold tracking-widest text-brand mb-1">FANTASY PULSE</Text>
          <Text numberOfLines={1} className="text-[21px] font-bold text-white text-center">
            {leagueName || "Your League"}
          </Text>
          {pulse.week !== undefined && (
            <Text className="text-[11px] text-gray-500 mt-0.5">
              Week {pulse.week} · {pulse.teamCount ?? 0} Teams · 2026 Season
            </Text>
          )}
        </View>
        <View className="mt-4">
          <PulseLine />
        </View>
      </LinearGradient>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-4 py-4 gap-0"
        className="border-b border-white/5"
      >
        <PulseCard icon="flame" label="TOP SCORER THIS WEEK">
          {pulse.topScorer ? (
            <View className="flex-row items-center gap-2.5">
              <Image
                source={typeof pulse.topScorer.avatar === "string" ? { uri: pulse.topScorer.avatar } : pulse.topScorer.avatar}
                className="w-[36px] h-[36px] rounded-full"
              />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-white font-bold text-[13px]">
                  {pulse.topScorer.name}
                </Text>
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#e2465a] font-bold text-[15px]">
                  {pulse.topScorer.points.toFixed(1)} pts
                </Text>
              </View>
            </View>
          ) : (
            <Text className="text-gray-500 text-[12px]">No scores yet this week</Text>
          )}
        </PulseCard>

        <PulseCard icon="stats-chart" label="CLOSEST GAME">
          {pulse.closest ? (
            <View>
              <Text numberOfLines={1} className="text-white font-semibold text-[12px]">
                {pulse.closest.a} vs {pulse.closest.b}
              </Text>
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#e2465a] font-bold text-[15px] mt-0.5">
                {pulse.closest.diff.toFixed(1)} pt margin
              </Text>
            </View>
          ) : (
            <Text className="text-gray-500 text-[12px]">Games haven&apos;t started</Text>
          )}
        </PulseCard>
      </ScrollView>

      <TransactionsTicker leagueID={leagueID} />

      <View className="flex-row flex-wrap px-4 gap-2.5 pt-5">
        {links.map((link) => (
          <Pressable
            key={link.label}
            onPress={() => router.push(link.path as Href)}
            style={{ width: "31%" }}
            className="items-center bg-[#141416] border border-white/10 rounded-2xl py-4 gap-2"
          >
            <View className="w-[38px] h-[38px] rounded-full bg-brand/15 items-center justify-center">
              {link.family === "ion" ? (
                <Ionicons name={link.icon as keyof typeof Ionicons.glyphMap} size={17} color="#e2465a" />
              ) : (
                <Feather name={link.icon as keyof typeof Feather.glyphMap} size={17} color="#e2465a" />
              )}
            </View>
            <Text className="text-white text-[11px] font-semibold">{link.label}</Text>
          </Pressable>
        ))}
      </View>

      <View className="pt-7">
        <FeedPreview leagueID={leagueID} />
      </View>

      <View className="pt-7">
        <TrendingPlayers leagueID={leagueID} />
      </View>

      <View className="pt-7">
        <ArticleCarousel leagueID={leagueID} />
      </View>

      <View className="mt-7 mb-8">
        <HomePoll leagueID={leagueID} />
      </View>
    </ScrollView>
  );
}
