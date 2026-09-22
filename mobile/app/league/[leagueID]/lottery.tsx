import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import { rankTeams, determinePlayoffTeams, TeamSeedData } from "../../../lib/whatIfSimulation";
import {
  LOTTERY_LEAGUE_IDS,
  computeLotteryOdds,
  computeBaselineDepth,
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
  const [isSuperflex, setIsSuperflex] = useState(false);

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
        const rosterPositions: string[] = league.roster_positions ?? [];
        setIsSuperflex(rosterPositions.some((p) => p === "SUPER_FLEX" || p === "SUPERFLEX"));

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

        const baselineDepth = computeBaselineDepth(rosterPositions);
        const mockBoard = buildMockDraftBoard(draftOrder, baselineDepth);
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
      <Text className="text-gray-500 text-[12px] mb-1">
        A way-too-early mock of next year&apos;s rookie draft - real 2027 {isSuperflex ? "superflex " : ""}prospect
        rankings, matched to each team&apos;s actual roster needs under this league&apos;s own format and scoring.
      </Text>
      {isSuperflex && (
        <View className="flex-row items-center gap-1.5 mb-4 self-start bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
          <Feather name="repeat" size={10} color="#9ca3af" />
          <Text className="text-gray-400 text-[10px] font-bold tracking-wide">SUPERFLEX VALUES</Text>
        </View>
      )}

      <View className="gap-3">
        {board.map((pick) => (
          <View key={pick.rosterId} className="rounded-2xl border border-white/10 bg-[#101012] overflow-hidden">
            <View className="flex-row items-center px-3.5 pt-3 pb-2.5">
              <View className="w-[24px] h-[24px] rounded-full bg-brand/15 border border-brand/30 items-center justify-center mr-2">
                <Text className="text-brand text-[10px] font-bold">{pick.pickNumber}</Text>
              </View>
              <Image
                source={pick.avatar ? { uri: pick.avatar } : helmet}
                className="w-[22px] h-[22px] rounded-full mr-2 bg-white/10"
              />
              <Text numberOfLines={1} className="flex-1 text-white font-semibold text-[12px] mr-2">
                {pick.teamName}
              </Text>
              <View style={{ backgroundColor: `${POS_COLOR[pick.need]}22`, borderColor: `${POS_COLOR[pick.need]}55` }} className="rounded-full border px-2 py-0.5">
                <Text style={{ color: POS_COLOR[pick.need] }} className="text-[9px] font-bold">
                  NEEDS {pick.need}
                </Text>
              </View>
            </View>

            {pick.prospect ? (
              <View className="flex-row items-center px-3.5 pb-3.5 pt-1">
                <View className="w-[52px] h-[52px] rounded-full bg-white/5 border border-white/10 overflow-hidden mr-3">
                  {pick.prospect.headshot && (
                    <Image source={{ uri: pick.prospect.headshot }} className="w-full h-full" resizeMode="cover" />
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-1.5 mb-0.5">
                    <View style={{ backgroundColor: POS_COLOR[pick.prospect.pos] }} className="rounded px-1.5 py-0.5">
                      <Text className="text-white text-[9px] font-bold">{pick.prospect.pos}</Text>
                    </View>
                    <Text numberOfLines={1} className="text-white text-[15px] font-bold flex-1">
                      {pick.prospect.name}
                    </Text>
                    <Text className="text-gray-500 text-[10px] font-bold">#{pick.prospect.overallRank} OVR</Text>
                  </View>
                  <View className="flex-row items-center gap-1.5 mb-0.5">
                    {pick.prospect.logo && (
                      <Image source={{ uri: pick.prospect.logo }} className="w-[14px] h-[14px]" resizeMode="contain" />
                    )}
                    <Text numberOfLines={1} className="text-gray-300 text-[12px] font-semibold">
                      {pick.prospect.school}
                    </Text>
                  </View>
                  {(pick.prospect.height || pick.prospect.weight) && (
                    <Text className="text-gray-500 text-[10px]">
                      {[pick.prospect.height, pick.prospect.weight].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </View>
              </View>
            ) : (
              <Text className="text-gray-600 text-[11px] px-3.5 pb-3.5">No prospect available</Text>
            )}
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-1.5 mt-4">
        <Feather name="info" size={11} color="#6b7280" />
        <Text className="text-gray-600 text-[10px] flex-1">
          Prospect rankings are from early 2027 superflex dynasty big boards and will keep moving all season - this
          is a snapshot, not a prediction.
        </Text>
      </View>
    </ScrollView>
  );
}
