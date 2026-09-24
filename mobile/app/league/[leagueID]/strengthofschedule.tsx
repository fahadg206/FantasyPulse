import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import { buildLeagueSimData } from "../../../lib/leagueSimData";
import { computeStrengthOfSchedule, TeamSOS, SOSTier } from "../../../lib/strengthOfSchedule";

const helmet = require("../../../assets/images/helmet2.png");

const TIER_META: Record<SOSTier, { color: string; bg: string; border: string }> = {
  Brutal: { color: "#ef4444", bg: "bg-red-500/15", border: "border-red-500/30" },
  Tough: { color: "#f97316", bg: "bg-orange-500/15", border: "border-orange-500/30" },
  Balanced: { color: "#eab308", bg: "bg-yellow-500/15", border: "border-yellow-500/30" },
  Favorable: { color: "#3b82f6", bg: "bg-blue-500/15", border: "border-blue-500/30" },
  Cakewalk: { color: "#22c55e", bg: "bg-green-500/15", border: "border-green-500/30" },
};

function WeekCell({ strength, week }: { strength: number; week: number }) {
  const tier = strength >= 80 ? "Brutal" : strength >= 60 ? "Tough" : strength >= 40 ? "Balanced" : strength >= 20 ? "Favorable" : "Cakewalk";
  const meta = TIER_META[tier as SOSTier];
  return (
    <View className="items-center" style={{ width: 26 }}>
      <View style={{ backgroundColor: meta.color }} className="w-full h-6 rounded-md opacity-80" />
      <Text className="text-gray-600 text-[8px] font-bold mt-0.5">{week}</Text>
    </View>
  );
}

function TeamSOSCard({ team, rank, isGauntlet, router, leagueID }: { team: TeamSOS; rank: number; isGauntlet: boolean; router: any; leagueID: string }) {
  const meta = TIER_META[team.tier];

  return (
    <Pressable
      onPress={() => router.push(`/profile/manager/${team.userId}`)}
      style={{ borderColor: `${meta.color}44` }}
      className="bg-[#141416] border rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-center mb-3">
        <View style={{ borderColor: meta.color }} className="w-8 h-8 rounded-full border-2 items-center justify-center mr-2.5">
          <Text style={{ color: meta.color }} className="font-bold text-[13px]">
            {rank}
          </Text>
        </View>
        <Image
          source={team.avatar ? { uri: team.avatar } : helmet}
          className="w-10 h-10 rounded-full bg-white/10 mr-2.5"
        />
        <View className="flex-1 mr-2">
          <Text numberOfLines={1} className="text-white font-bold text-[14px]">
            {team.name}
          </Text>
          <Text className="text-gray-500 text-[11px]">
            {team.remaining.length} {team.remaining.length === 1 ? "game" : "games"} left
          </Text>
        </View>
        <View className="items-end">
          <View className={`flex-row items-center gap-1 px-2.5 py-1 rounded-full ${meta.bg}`}>
            {isGauntlet && <Ionicons name="flame" size={11} color={meta.color} />}
            <Text style={{ color: meta.color }} className="text-[11px] font-bold">
              {team.tier}
            </Text>
          </View>
          <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-extrabold text-[16px] mt-1">
            {team.sosScore}
          </Text>
        </View>
      </View>

      {team.remaining.length > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2.5">
            <View className="flex-row gap-1.5">
              {team.remaining.map((r) => (
                <WeekCell key={r.week} strength={r.strength} week={r.week} />
              ))}
            </View>
          </ScrollView>

          <View className="flex-row items-center justify-between">
            {team.toughest && (
              <View className="flex-row items-center gap-1 flex-1 mr-2">
                <Feather name="trending-up" size={10} color="#ef4444" />
                <Text numberOfLines={1} className="text-gray-500 text-[10px] flex-1">
                  Toughest: <Text className="text-gray-300 font-semibold">{team.toughest.opponentName}</Text> (Wk{" "}
                  {team.toughest.week})
                </Text>
              </View>
            )}
            {team.easiest && (
              <View className="flex-row items-center gap-1 flex-1">
                <Feather name="trending-down" size={10} color="#22c55e" />
                <Text numberOfLines={1} className="text-gray-500 text-[10px] flex-1">
                  Easiest: <Text className="text-gray-300 font-semibold">{team.easiest.opponentName}</Text> (Wk{" "}
                  {team.easiest.week})
                </Text>
              </View>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}

export default function StrengthOfSchedule() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<TeamSOS[]>([]);
  const [currentWeek, setCurrentWeek] = useState(1);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: nflState }, sim] = await Promise.all([sleeper.getNflState(), buildLeagueSimData(leagueID)]);
        if (cancelled) return;
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        setCurrentWeek(week);
        setTeams(computeStrengthOfSchedule(sim, week));
      } catch (error) {
        console.error("Error computing strength of schedule:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
        <Text className="mt-2 text-gray-400 text-xs">Scouting the rest of the schedule…</Text>
      </View>
    );
  }

  // The single worst 3-week stretch anyone in the league is staring down -
  // real signal (an actual run of tough games), not a flat season average,
  // which can hide a brutal patch behind a couple of easy byes elsewhere.
  const gauntletTeam = teams.reduce<TeamSOS | null>((worst, t) => {
    if (!t.gauntlet) return worst;
    if (!worst?.gauntlet || t.gauntlet.avgStrength > worst.gauntlet.avgStrength) return t;
    return worst;
  }, null);

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">STRENGTH OF SCHEDULE</Text>
      <Text className="text-white text-[21px] font-bold">Who's Got It Easy?</Text>
      <Text className="text-gray-500 text-[12px] mt-1.5">
        Real fantasy difficulty, not NFL matchups - the average strength of every opponent still left on each
        team's schedule (Week {currentWeek} on), off real weekly projections and this season's actual scoring.
      </Text>

      {gauntletTeam?.gauntlet && (
        <View className="bg-[#1c0a0a] border border-red-500/30 rounded-2xl p-4 mt-4 mb-1">
          <View className="flex-row items-center gap-2 mb-1.5">
            <Ionicons name="flame" size={16} color="#ef4444" />
            <Text className="text-red-400 text-[11px] font-bold tracking-widest">GAUNTLET ALERT</Text>
          </View>
          <Text className="text-white text-[13px] leading-5">
            <Text className="font-bold">{gauntletTeam.name}</Text> runs into the league's toughest stretch - three
            brutal games back to back, Weeks {gauntletTeam.gauntlet.startWeek}-{gauntletTeam.gauntlet.endWeek}.
          </Text>
        </View>
      )}

      <View className="flex-row items-center flex-wrap gap-x-3 gap-y-1.5 mt-5 mb-3">
        {(Object.keys(TIER_META) as SOSTier[]).map((tier) => (
          <View key={tier} className="flex-row items-center gap-1">
            <View style={{ backgroundColor: TIER_META[tier].color }} className="w-2.5 h-2.5 rounded-full" />
            <Text className="text-gray-500 text-[10px] font-semibold">{tier}</Text>
          </View>
        ))}
      </View>

      {teams.map((team, i) => (
        <TeamSOSCard
          key={team.userId}
          team={team}
          rank={i + 1}
          isGauntlet={team.userId === gauntletTeam?.userId}
          router={router}
          leagueID={leagueID}
        />
      ))}
    </ScrollView>
  );
}
