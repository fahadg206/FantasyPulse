import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import { rankTeams, determinePlayoffTeams, TeamSeedData } from "../../../lib/whatIfSimulation";
import {
  LOTTERY_LEAGUE_IDS,
  MOCK_DRAFT_ROUNDS,
  computeLotteryOdds,
  computeBaselineDepth,
  buildMockDraftBoard,
  LotteryTeam,
  MockDraftPick,
  DraftSlot,
} from "../../../lib/draftLottery";
import { PlayerPos } from "../../../lib/draftProspects";

const helmet = require("../../../assets/images/helmet2.png");
const POS_COLOR: Record<PlayerPos, string> = { QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#eab308" };

interface TeamMeta {
  rosterId: string;
  teamName: string;
  avatar?: string;
}

interface TradedPick {
  round: number;
  season: string;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

export default function DraftLottery() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [loading, setLoading] = useState(true);
  const [lottery, setLottery] = useState<LotteryTeam[]>([]);
  const [board, setBoard] = useState<MockDraftPick[]>([]);
  const [isSuperflex, setIsSuperflex] = useState(false);
  const [draftSeason, setDraftSeason] = useState<string>("");
  const [activeRound, setActiveRound] = useState(1);

  useEffect(() => {
    if (!leagueID || !LOTTERY_LEAGUE_IDS.has(leagueID)) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [{ data: league }, { data: rosters }, { data: users }, playersData, tradedPicksRes] = await Promise.all([
          sleeper.getLeague(leagueID),
          sleeper.getLeagueRosters(leagueID),
          sleeper.getLeagueUsers(leagueID),
          backend.fetchPlayers(leagueID),
          fetch(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`).then((r) => r.json()),
        ]);
        if (cancelled) return;

        const playoffSpots: number = league.settings?.playoff_teams ?? 6;
        const divisionsCount: number = league.settings?.divisions ?? 0;
        const rosterPositions: string[] = league.roster_positions ?? [];
        const superflex = rosterPositions.some((p) => p === "SUPER_FLEX" || p === "SUPERFLEX");
        setIsSuperflex(superflex);

        // The rookie draft covering this prospect class happens the
        // offseason after the CURRENT season wraps - one year ahead of
        // whatever season this league is presently playing, not a
        // hardcoded year, so this stays correct in future seasons too.
        const nextSeason = String(Number(league.season) + 1);
        setDraftSeason(nextSeason);
        const tradedPicks: TradedPick[] = (Array.isArray(tradedPicksRes) ? tradedPicksRes : []).filter(
          (p: TradedPick) => p.season === nextSeason
        );

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
        const nonPlayoffWorstFirst = ranked.filter((id) => !qualifierSet.has(id)).reverse();

        const lotteryResult = computeLotteryOdds(nonPlayoffWorstFirst.map((id) => teamMeta[id]));
        if (!cancelled) setLottery(lotteryResult);

        // Same original-slot order repeats every round (straight, not
        // snake) - lottery teams worst-to-best, then playoff teams in
        // reverse standings order, the real NFL draft's convention.
        const playoffWorstFirst = [...qualifiers].reverse();
        const draftOrderRosterIds = [...nonPlayoffWorstFirst, ...playoffWorstFirst];

        const resolveOwner = (round: number, originalRosterId: string): string => {
          const trade = tradedPicks.find((p) => p.round === round && String(p.roster_id) === originalRosterId);
          return trade ? String(trade.owner_id) : originalRosterId;
        };

        const slots: DraftSlot[] = [];
        for (let round = 1; round <= MOCK_DRAFT_ROUNDS; round++) {
          for (const originalRosterId of draftOrderRosterIds) {
            const currentRosterId = resolveOwner(round, originalRosterId);
            const traded = currentRosterId !== originalRosterId;
            slots.push({
              round,
              originalRosterId,
              currentRosterId,
              teamName: teamMeta[currentRosterId]?.teamName ?? "Unknown Team",
              avatar: teamMeta[currentRosterId]?.avatar,
              viaTeamName: traded ? teamMeta[originalRosterId]?.teamName : undefined,
              viaAvatar: traded ? teamMeta[originalRosterId]?.avatar : undefined,
            });
          }
        }

        const baselineDepth = computeBaselineDepth(rosterPositions);
        const mockBoard = buildMockDraftBoard(slots, posCountsByRoster, baselineDepth);
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

  const roundPicks = board.filter((p) => p.round === activeRound);

  // A manager with several picks in the same round (Kaboweyne owning 5
  // round-1 picks, say) had each pick's "need" computed as their biggest
  // need *at that exact moment in the draft* - accurate per-pick, but
  // scanning down the list it just looks like their need keeps
  // flip-flopping. Showing every distinct need they hit across all their
  // picks this round, comma-separated, on each of their cards instead is
  // clearer at a glance and still just as true.
  const picksPerManager = new Map<string, number>();
  const needsByManager = new Map<string, PlayerPos[]>();
  for (const pick of roundPicks) {
    picksPerManager.set(pick.currentRosterId, (picksPerManager.get(pick.currentRosterId) ?? 0) + 1);
    const needs = needsByManager.get(pick.currentRosterId) ?? [];
    if (!needs.includes(pick.need)) needs.push(pick.need);
    needsByManager.set(pick.currentRosterId, needs);
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
        A way-too-early mock of the {draftSeason} rookie draft - real {isSuperflex ? "superflex " : ""}prospect
        rankings, matched to each team&apos;s actual roster needs and real traded picks under this league&apos;s own
        format and scoring.
      </Text>
      {isSuperflex && (
        <View className="flex-row items-center gap-1.5 mb-4 self-start bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
          <Feather name="repeat" size={10} color="#9ca3af" />
          <Text className="text-gray-400 text-[10px] font-bold tracking-wide">SUPERFLEX VALUES</Text>
        </View>
      )}

      <View className="flex-row bg-[#1c1c1e] rounded-full p-1 mb-4 self-center">
        {Array.from({ length: MOCK_DRAFT_ROUNDS }, (_, i) => i + 1).map((round) => (
          <Pressable
            key={round}
            onPress={() => setActiveRound(round)}
            className={`px-4 py-2 rounded-full ${activeRound === round ? "bg-brand" : ""}`}
          >
            <Text className={`text-[12px] font-bold ${activeRound === round ? "text-white" : "text-gray-400"}`}>
              Round {round}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-3">
        {roundPicks.map((pick) => {
          const hasMultiplePicks = (picksPerManager.get(pick.currentRosterId) ?? 0) > 1;
          const displayNeeds = hasMultiplePicks ? needsByManager.get(pick.currentRosterId) ?? [pick.need] : [pick.need];

          return (
          <View key={`${pick.round}-${pick.originalRosterId}`} className="rounded-2xl border border-white/10 bg-[#101012] overflow-hidden">
            <View className="flex-row items-center px-3.5 pt-3 pb-2.5">
              <View className="w-[24px] h-[24px] rounded-full bg-brand/15 border border-brand/30 items-center justify-center mr-2">
                <Text className="text-brand text-[10px] font-bold">{pick.pickNumber}</Text>
              </View>
              <Image
                source={pick.avatar ? { uri: pick.avatar } : helmet}
                className="w-[22px] h-[22px] rounded-full mr-2 bg-white/10"
              />
              <View className="flex-1 mr-2">
                <Text numberOfLines={1} className="text-white font-semibold text-[12px]">
                  {pick.teamName}
                </Text>
                {pick.viaTeamName && (
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <Image
                      source={pick.viaAvatar ? { uri: pick.viaAvatar } : helmet}
                      className="w-[12px] h-[12px] rounded-full bg-white/10"
                    />
                    <Text numberOfLines={1} className="text-gray-500 text-[10px]">
                      via {pick.viaTeamName}
                    </Text>
                  </View>
                )}
              </View>
              {displayNeeds.length === 1 ? (
                <View style={{ backgroundColor: `${POS_COLOR[displayNeeds[0]]}22`, borderColor: `${POS_COLOR[displayNeeds[0]]}55` }} className="rounded-full border px-2 py-0.5">
                  <Text style={{ color: POS_COLOR[displayNeeds[0]] }} className="text-[9px] font-bold">
                    NEEDS {displayNeeds[0]}
                  </Text>
                </View>
              ) : (
                <View className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 max-w-[110px]">
                  <Text numberOfLines={1} className="text-gray-300 text-[9px] font-bold">
                    NEEDS {displayNeeds.join(", ")}
                  </Text>
                </View>
              )}
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
          );
        })}
      </View>

      <View className="flex-row items-center gap-1.5 mt-4">
        <Feather name="info" size={11} color="#6b7280" />
        <Text className="text-gray-600 text-[10px] flex-1">
          Prospect rankings are from early {draftSeason} superflex dynasty big boards and will keep moving all
          season - this is a snapshot, not a prediction.
        </Text>
      </View>
    </ScrollView>
  );
}
