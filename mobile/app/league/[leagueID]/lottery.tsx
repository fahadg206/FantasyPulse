import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import { rankTeams, determinePlayoffTeams, TeamSeedData } from "../../../lib/whatIfSimulation";
import {
  LOTTERY_LEAGUE_IDS,
  computeLotteryOdds,
  buildMockDraftBoard,
  LotteryTeam,
  MockDraftPick,
} from "../../../lib/draftLottery";
import { PlayerPos } from "../../../lib/draftProspects";

const helmet = require("../../../assets/images/helmet2.png");
const POS_COLOR: Record<PlayerPos, string> = { QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#eab308" };

interface TeamMeta {
  rosterId: string;
  teamName: string;
  avatar?: string;
}

export default function DraftLottery() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [loading, setLoading] = useState(true);
  const [lottery, setLottery] = useState<LotteryTeam[]>([]);
  const [board, setBoard] = useState<MockDraftPick[]>([]);

  useEffect(() => {
    if (!leagueID || !LOTTERY_LEAGUE_IDS.has(leagueID)) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [{ data: league }, { data: rosters }, { data: users }, playersData] = await Promise.all([
          sleeper.getLeague(leagueID),
          sleeper.getLeagueRosters(leagueID),
          sleeper.getLeagueUsers(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        const playoffSpots: number = league.settings?.playoff_teams ?? 6;
        const divisionsCount: number = league.settings?.divisions ?? 0;

        const teamMeta: Record<string, TeamMeta> = {};
        const wins: Record<string, number> = {};
        const pointsFor: Record<string, number> = {};
        const managerInfo: Record<string, TeamSeedData> = {};
        const posCountsByRoster: Record<string, Record<PlayerPos, number>> = {};

        for (const roster of rosters as any[]) {
          const id = String(roster.roster_id);
          const user = (users as any[]).find((u) => u.user_id === roster.owner_id);
          teamMeta[id] = {
            rosterId: id,
            teamName: user?.metadata?.team_name || user?.display_name || "Unknown Team",
            avatar: user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined,
          };
          wins[id] = roster.settings?.wins ?? 0;
          pointsFor[id] = (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100;
          managerInfo[id] = { division: roster.settings?.division };

          const counts: Record<PlayerPos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
          for (const playerId of roster.players ?? []) {
            const pos = (playersData as any)?.[playerId]?.pos as PlayerPos | undefined;
            if (pos && pos in counts) counts[pos]++;
          }
          posCountsByRoster[id] = counts;
        }

        const teamIds = Object.keys(teamMeta);
        const ranked = rankTeams(teamIds, wins, pointsFor);
        const { qualifiers } = determinePlayoffTeams(ranked, managerInfo, divisionsCount, playoffSpots);
        const qualifierSet = new Set(qualifiers);
        // ranked is best-to-worst; lottery display wants worst-to-best
        // (the worst team gets the best odds), so the non-qualifiers slice
        // of it is reversed.
        const nonPlayoffWorstFirst = ranked.filter((id) => !qualifierSet.has(id)).reverse();

        const lotteryResult = computeLotteryOdds(nonPlayoffWorstFirst.map((id) => teamMeta[id]));
        if (!cancelled) setLottery(lotteryResult);

        // Full mock draft order: lottery teams worst-to-best (same as
        // above), then playoff teams in reverse standings order - the
        // worst playoff seed picks first among playoff teams, same
        // convention the real NFL draft uses. There's no actual
        // randomized lottery draw run here (that's what the odds above
        // represent), so this board uses current standings order as its
        // stand-in.
        const playoffWorstFirst = [...qualifiers].reverse();
        const draftOrder = [...nonPlayoffWorstFirst, ...playoffWorstFirst].map((id) => ({
          ...teamMeta[id],
          posCounts: posCountsByRoster[id],
        }));

        const mockBoard = buildMockDraftBoard(draftOrder);
        if (!cancelled) setBoard(mockBoard);
      } catch (error) {
        console.error("Error loading draft lottery:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (!LOTTERY_LEAGUE_IDS.has(leagueID)) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-[#0c0c0e]">
        <Text className="text-gray-500 text-[13px] text-center">
          The draft lottery isn&apos;t set up for this league.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" size="large" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">DRAFT LOTTERY</Text>
      <Text className="text-gray-500 text-[12px] mb-4">
        If the season ended today, these teams would be picking in the lottery. Odds start at 30% for the worst
        record and step down 5% per slot.
      </Text>

      <View className="rounded-2xl border border-white/10 overflow-hidden mb-8">
        {lottery.map((team, i) => (
          <View
            key={team.rosterId}
            className={`flex-row items-center px-4 py-3 ${i !== lottery.length - 1 ? "border-b border-white/5" : ""}`}
          >
            <View className="w-[26px] h-[26px] rounded-full bg-white/5 items-center justify-center mr-2.5">
              <Text className="text-gray-400 text-[11px] font-bold">{i + 1}</Text>
            </View>
            <Image
              source={team.avatar ? { uri: team.avatar } : helmet}
              className="w-[30px] h-[30px] rounded-full mr-2.5 bg-white/10"
            />
            <Text numberOfLines={1} className="flex-1 text-white font-semibold text-[13px] mr-2">
              {team.teamName}
            </Text>
            <View className="bg-brand/15 border border-brand/30 rounded-full px-3 py-1">
              <Text className="text-brand text-[13px] font-bold">{team.odds}%</Text>
            </View>
          </View>
        ))}
      </View>

      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">DYNASTY EARLY BOARD</Text>
      <Text className="text-gray-500 text-[12px] mb-4">
        A way-too-early mock of next year&apos;s rookie draft - real 2027 prospect rankings, matched to each team&apos;s
        actual biggest roster need at their current draft slot.
      </Text>

      <View className="rounded-2xl border border-white/10 overflow-hidden">
        {board.map((pick, i) => (
          <View
            key={pick.rosterId}
            className={`flex-row items-center px-4 py-3 ${i !== board.length - 1 ? "border-b border-white/5" : ""}`}
          >
            <View className="w-[26px] h-[26px] rounded-full bg-white/5 items-center justify-center mr-2.5">
              <Text className="text-gray-400 text-[11px] font-bold">{pick.pickNumber}</Text>
            </View>
            <Image
              source={pick.avatar ? { uri: pick.avatar } : helmet}
              className="w-[30px] h-[30px] rounded-full mr-2.5 bg-white/10"
            />
            <View className="flex-1 mr-2">
              <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
                {pick.teamName}
              </Text>
              <Text className="text-gray-500 text-[10px] mt-0.5">Need: {pick.need}</Text>
            </View>
            {pick.prospect ? (
              <View className="items-end">
                <View className="flex-row items-center gap-1.5">
                  <View
                    style={{ backgroundColor: POS_COLOR[pick.prospect.pos] }}
                    className="rounded px-1.5 py-0.5"
                  >
                    <Text className="text-white text-[9px] font-bold">{pick.prospect.pos}</Text>
                  </View>
                  <Text numberOfLines={1} className="text-white text-[13px] font-bold max-w-[130px]">
                    {pick.prospect.name}
                  </Text>
                </View>
                <Text className="text-gray-500 text-[10px] mt-0.5">{pick.prospect.school}</Text>
              </View>
            ) : (
              <Text className="text-gray-600 text-[11px]">-</Text>
            )}
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-1.5 mt-4">
        <Feather name="info" size={11} color="#6b7280" />
        <Text className="text-gray-600 text-[10px] flex-1">
          Prospect rankings are from early 2027 draft big boards and will keep moving all season - this is a
          snapshot, not a prediction.
        </Text>
      </View>
    </ScrollView>
  );
}
