import { useEffect, useState } from "react";
import { View, Text, Image, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue } from "../../../lib/playerValue";
import { computePowerRankings, PowerRankingResult, PowerRankingTier } from "../../../lib/powerRankings";

const helmet = require("../../../assets/images/helmet2.png");

interface TeamDisplay {
  userId: string;
  name: string;
  avatar: string | number;
}

const TIER_COLORS: Record<PowerRankingTier, { bg: string; text: string; bar: string }> = {
  Contender: { bg: "bg-green-500/15", text: "text-green-500", bar: "bg-green-500" },
  "Playoff Contender": { bg: "bg-blue-500/15", text: "text-blue-500", bar: "bg-blue-500" },
  "Middle of the Pack": { bg: "bg-yellow-500/15", text: "text-yellow-500", bar: "bg-yellow-500" },
  Rebuild: { bg: "bg-red-500/15", text: "text-red-500", bar: "bg-red-500" },
  "No Chance": { bg: "bg-red-500/15", text: "text-red-500", bar: "bg-red-500" },
};

export default function PowerRankings() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<PowerRankingResult[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, TeamDisplay>>({});
  const [leagueSettings, setLeagueSettings] = useState<LeagueValueSettings | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [usersRes, rostersRes, nflStateRes, settings, playersData] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          sleeper.getNflState(),
          getLeagueValueSettings(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        const teamsDisplay: Record<string, TeamDisplay> = {};
        usersRes.data.forEach((user: any) => {
          teamsDisplay[user.user_id] = {
            userId: user.user_id,
            name: user.display_name,
            avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : helmet,
          };
        });

        let playerValuesBySleeperId: Record<string, RawPlayerValue> = {};
        if (settings.isDynasty) {
          playerValuesBySleeperId = await backend.fetchAllPlayerValues();
        }

        const currentWeek: number = nflStateRes.data.week || 1;
        const teamsInput = rostersRes.data
          .filter((roster: any) => teamsDisplay[roster.owner_id])
          .map((roster: any) => ({
            rosterId: Number(roster.roster_id),
            userId: roster.owner_id,
            wins: parseInt(roster.settings?.wins || "0"),
            losses: parseInt(roster.settings?.losses || "0"),
            rosterSleeperIds: roster.players || [],
            starterSleeperIds: roster.starters || [],
          }));

        const result = computePowerRankings({
          teams: teamsInput,
          leagueSettings: settings,
          upcomingWeeks: [currentWeek, currentWeek + 1, currentWeek + 2],
          playerValuesBySleeperId,
          getWeeklyStarterProjection: (starterIds, week) =>
            starterIds.reduce((sum: number, playerId: string) => {
              const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
              return sum + (proj !== undefined ? parseFloat(proj) : 0);
            }, 0),
        });

        if (cancelled) return;
        setTeamsById(teamsDisplay);
        setLeagueSettings(settings);
        setRankings(result);
        setLoading(false);
      } catch (error) {
        console.error("Error computing power rankings:", error);
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
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#af1222" />
        <Text className="mt-2 text-gray-500 dark:text-gray-400 text-xs">Loading Power Rankings...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-lg font-bold text-black dark:text-white">Power Rankings</Text>
        {leagueSettings && (
          <View className="px-2.5 py-1 rounded-full bg-brand/10">
            <Text className="text-[10px] font-semibold text-brand">
              {leagueSettings.isDynasty ? "Dynasty" : "Redraft"}
              {leagueSettings.isSuperflex ? " · Superflex" : ""}
            </Text>
          </View>
        )}
      </View>
      <Text className="px-4 pb-2 text-[11px] text-gray-500 dark:text-gray-400">
        {leagueSettings?.isDynasty
          ? "Blends this season's roster strength and record with the whole roster's long-term dynasty value."
          : "Based entirely on this season's roster strength and record - nothing carries over in redraft."}
      </Text>
      <FlatList
        data={rankings}
        keyExtractor={(item) => item.userId}
        contentContainerClassName="px-4 pb-6"
        renderItem={({ item }) => {
          const display = teamsById[item.userId];
          const style = TIER_COLORS[item.tier];
          return (
            <View className="flex-row items-center gap-3 p-3 mb-2 rounded-xl bg-[#f2f2f2] dark:bg-[#1a1a1a]">
              <Text className="w-6 text-center font-bold text-black dark:text-white">{item.rank}</Text>
              <Image
                source={typeof display?.avatar === "string" ? { uri: display.avatar } : display?.avatar || helmet}
                className="w-9 h-9 rounded-full"
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-black dark:text-white" numberOfLines={1}>
                  {display?.name || "Unknown Manager"}
                </Text>
                <View className="flex-row items-center gap-2 mt-1">
                  <View className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <View className={`h-full ${style.bar}`} style={{ width: `${item.powerScore}%` }} />
                  </View>
                  <Text className="text-[11px] text-gray-500 dark:text-gray-400 w-7 text-right">
                    {item.powerScore}
                  </Text>
                </View>
              </View>
              <View className={`px-2 py-1 rounded-full ${style.bg}`}>
                <Text className={`text-[10px] font-semibold ${style.text}`}>{item.tier}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
