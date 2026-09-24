import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import getMatchupData, { ScheduleData, Starter } from "../../../lib/getMatchupData";
import PlayerCard from "../../../components/PlayerCard";
import PlayerDetailModal from "../../../components/PlayerDetailModal";
import { displayName } from "../../../lib/getTopPerformers";
import { getManagerHistory, ManagerAllTimeStats } from "../../../lib/getManagerHistory";
import { getCurrentSeasonExtras, CurrentSeasonExtras } from "../../../lib/getCurrentSeasonExtras";
import { getLeagueValueSettings } from "../../../lib/playerValue";
import { PowerRankingTier } from "../../../lib/powerRankings";
import {
  getNflGameStatusByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
  NflTeamGameState,
} from "../../../lib/nflGameStatus";

type WeekResult = {
  week: number;
  opponentName: string;
  opponentAvatar: any;
  myPoints: number;
  oppPoints: number;
  result: "win" | "loss" | "pending";
  // Deterministic per-matchup so both sides agree: the lower roster_id is
  // always "vs" and the higher is always "@", so e.g. one manager's "@
  // Kabo" always matches Kabo's own "vs [that manager]" for the same week.
  isHome: boolean;
};

const RESULT_COLOR: Record<WeekResult["result"], string> = {
  win: "#16a34a",
  loss: "#af1222",
  pending: "#9ca3af",
};

const TIER_STYLE: Record<PowerRankingTier, { bg: string; text: string }> = {
  Contender: { bg: "bg-green-500/20", text: "text-green-400" },
  "Playoff Contender": { bg: "bg-blue-500/20", text: "text-blue-400" },
  "Middle of the Pack": { bg: "bg-yellow-500/20", text: "text-yellow-400" },
  Rebuild: { bg: "bg-red-500/20", text: "text-red-400" },
  "No Chance": { bg: "bg-red-500/20", text: "text-red-400" },
};

export default function LeagueManagers() {
  const { leagueID, userId: requestedUserId } = useLocalSearchParams<{ leagueID: string; userId?: string }>();
  const router = useRouter();
  const [scheduleData, setScheduleData] = useState<ScheduleData>({});
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weeklyResults, setWeeklyResults] = useState<Record<string, WeekResult[]>>({});
  const [loading, setLoading] = useState(true);
  const [allTimeStats, setAllTimeStats] = useState<Record<string, ManagerAllTimeStats>>({});
  const [currentExtras, setCurrentExtras] = useState<CurrentSeasonExtras | null>(null);
  const [currentExtrasLoading, setCurrentExtrasLoading] = useState(false);
  // Pick flow, roster age, rookie-on-roster, and recently-acquired are all
  // dynasty concepts - in redraft every roster resets each offseason, so
  // "picks traded away" and "average roster age" mean nothing there. One
  // cheap league-settings check gates all four, independent of whichever
  // of the two heavier effects below (all-time stats, GM scout extras)
  // happens to finish loading first.
  const [isDynasty, setIsDynasty] = useState<boolean | null>(null);
  const [detailPlayer, setDetailPlayer] = useState<{ playerId?: string; name: string; position: string; team?: string } | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    getLeagueValueSettings(leagueID)
      .then((settings) => !cancelled && setIsDynasty(settings.isDynasty))
      .catch((error) => console.error("Error checking league format:", error));
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ data: nflState }, { data: league }, playersData] = await Promise.all([
          sleeper.getNflState(),
          sleeper.getLeague(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const nflGameStatusByTeam = await getNflGameStatusByTeam(week, nflState.season).catch((error) => {
          console.error("Error fetching NFL game status:", error);
          return {} as Record<string, NflTeamGameState>;
        });

        const { updatedScheduleData } = await getMatchupData(leagueID, week, playersData);
        if (cancelled) return;
        setScheduleData(updatedScheduleData);
        const ids = Object.keys(updatedScheduleData);
        setManagerIds(ids);
        // Arriving from Standings' "View Team" action pre-selects that
        // exact manager instead of always landing on whoever's first.
        const preferred = requestedUserId && ids.includes(requestedUserId) ? requestedUserId : undefined;
        setSelectedId((prev) => prev ?? preferred ?? ids[0] ?? null);

        // The full regular-season schedule, not just weeks played so far -
        // Sleeper already has the whole season's pairings generated, future
        // weeks just show 0-0 until they're played.
        const weeksToFetch = Math.max(1, (league.settings?.playoff_week_start ?? 15) - 1);
        const results: Record<string, WeekResult[]> = {};
        ids.forEach((id) => (results[id] = []));

        const weekData = await Promise.all(
          Array.from({ length: weeksToFetch }, (_, i) => i + 1).map((w) => getMatchupData(leagueID, w, playersData))
        );

        // Whether a week counts as decided by each starter's real NFL game
        // status, not "both scores happen to still read 0" - the same fix
        // already applied to the matchup screen/dashboard scoreboard/
        // schedule: a single early scorer while most of the lineup hasn't
        // played yet used to be enough to flip a week to "win" or "loss"
        // well before it was actually over. Only the current week needs
        // this real check - any earlier week is unconditionally done, and
        // a future week's scores are 0-0 regardless of which check runs.
        const isWeekFinal = (weekSchedule: ScheduleData, id: string, w: number): boolean => {
          if (w < week) return true;
          if (w > week) return false;
          const me = weekSchedule[id];
          const opp = me?.opponent_id ? weekSchedule[me.opponent_id] : undefined;
          const rosterFullySet = (starters: Starter[]) =>
            starters.length > 0 && starters.every((s) => s && Object.keys(s).length > 0);
          const myState = computeFantasyTeamGameState(
            (me?.starters_full_data ?? []).map((s) => s.team),
            nflGameStatusByTeam,
            rosterFullySet(me?.starters_full_data ?? [])
          );
          const oppState = computeFantasyTeamGameState(
            (opp?.starters_full_data ?? []).map((s) => s.team),
            nflGameStatusByTeam,
            rosterFullySet(opp?.starters_full_data ?? [])
          );
          return combineMatchupGameState(myState, oppState, isPastMondayNightCutoff()) === "final";
        };

        weekData.forEach(({ updatedScheduleData: weekSchedule }, i) => {
          const w = i + 1;
          for (const id of ids) {
            const me = weekSchedule[id];
            if (!me?.opponent_id) continue;
            const opp = weekSchedule[me.opponent_id];
            const myPts = parseFloat(me.team_points || "0");
            const oppPts = parseFloat(opp?.team_points || "0");
            const pending = !isWeekFinal(weekSchedule, id, w);
            results[id].push({
              week: w,
              opponentName: opp?.name ?? "TBD",
              opponentAvatar: opp?.avatar,
              myPoints: myPts,
              oppPoints: oppPts,
              result: pending ? "pending" : myPts > oppPts ? "win" : "loss",
              isHome: parseInt(me.roster_id ?? "0") < parseInt(opp?.roster_id ?? "0"),
            });
          }
        });

        if (!cancelled) setWeeklyResults(results);
      } catch (error) {
        console.error("Error loading league managers:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  // Crawls the league's full history across every past season - kept as its
  // own effect so it doesn't block the current-season view above, which
  // most visits only need.
  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    getManagerHistory(leagueID)
      .then((result) => {
        if (!cancelled) setAllTimeStats(result);
      })
      .catch((error) => console.error("Error loading manager history:", error));

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  // GM Scout's current-season-only extras (tier, avg roster age, rookie on
  // roster, most recent add) - kept as its own effect, keyed to whichever
  // manager is selected, since it's a heavier fetch (the full Sleeper
  // player blob + power rankings for the whole league) not worth doing for
  // every manager up front.
  useEffect(() => {
    if (!leagueID || !selectedId) return;
    let cancelled = false;
    setCurrentExtrasLoading(true);
    getCurrentSeasonExtras(leagueID, selectedId)
      .then((result) => {
        if (!cancelled) setCurrentExtras(result);
      })
      .catch((error) => console.error("Error loading GM scout extras:", error))
      .finally(() => {
        if (!cancelled) setCurrentExtrasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueID, selectedId]);

  const allStats = selectedId ? allTimeStats[selectedId] : undefined;
  const selectedManager = selectedId ? scheduleData[selectedId] : undefined;
  const starters = useMemo(
    () => (selectedManager?.starters_full_data ?? []).filter((s) => Object.keys(s).length > 0),
    [selectedManager]
  );
  const results = weeklyResults[selectedId ?? ""] ?? [];

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#af1222" size="large" />
        <Text className="mt-2 text-black dark:text-white">Loading Manager Data…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <View className="border-b border-gray-100 dark:border-white/10 bg-white dark:bg-black">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-3 py-3 gap-4">
          {managerIds.map((id) => {
            const m = scheduleData[id];
            const active = id === selectedId;
            return (
              <Pressable key={id} onPress={() => setSelectedId(id)} className="items-center w-[64px]">
                <Image
                  source={typeof m.avatar === "string" ? { uri: m.avatar } : m.avatar}
                  style={{ opacity: active ? 1 : 0.4 }}
                  className={`w-[52px] h-[52px] rounded-full ${active ? "border-2 border-brand" : "border border-transparent"}`}
                />
                <Text
                  numberOfLines={1}
                  className={`text-[10px] mt-1 text-center ${active ? "text-black dark:text-white font-bold" : "text-gray-400"}`}
                >
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {selectedManager && (
          <>
            {/* Team banner, ESPN team-page style */}
            <View className="bg-[#0c0c0e] pt-6 pb-5 items-center">
              <Image
                source={
                  typeof selectedManager.avatar === "string"
                    ? { uri: selectedManager.avatar }
                    : selectedManager.avatar
                }
                className="w-[76px] h-[76px] rounded-full mb-2 border-2 border-brand"
              />
              <Text className="text-xl font-bold text-white">{selectedManager.name}</Text>

              {selectedId && (
                <Pressable
                  onPress={() => router.push(`/profile/manager/${selectedId}`)}
                  className="flex-row items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 mt-2"
                >
                  <Feather name="user" size={11} color="#af1222" />
                  <Text className="text-brand text-[11px] font-bold">View Profile</Text>
                </Pressable>
              )}

              <View className="flex-row flex-wrap items-center justify-center gap-1.5 mt-2 px-6">
                {currentExtrasLoading ? (
                  <ActivityIndicator color="#af1222" size="small" />
                ) : (
                  <>
                    {currentExtras?.tier && (
                      <View className={`px-2.5 py-1 rounded-full ${TIER_STYLE[currentExtras.tier.tier].bg}`}>
                        <Text className={`text-[10px] font-bold ${TIER_STYLE[currentExtras.tier.tier].text}`}>
                          {currentExtras.tier.tier}
                        </Text>
                      </View>
                    )}
                    {allStats?.badges.map((badge) => (
                      <View key={badge} className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15">
                        <Text className="text-[10px] font-semibold text-gray-200">{badge}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>

              <View className="flex-row mt-4 gap-6">
                <StatTile label="RECORD" value={`${selectedManager.wins ?? 0}-${selectedManager.losses ?? 0}`} />
                <RankStatTile
                  label="STARTER RANK"
                  rank={currentExtras?.tier?.starterRank}
                  total={managerIds.length}
                />
                <RankStatTile
                  label="OVERALL RANK"
                  rank={currentExtras?.tier?.rank}
                  total={managerIds.length}
                />
              </View>
            </View>

            {allStats && allStats.seasonsPlayed > 0 && (
              <View className="px-4 pt-5">
                <Text className="font-bold mb-2.5 text-black dark:text-white text-[15px]">
                  All-Time Stats <Text className="text-gray-400 font-normal text-[12px]">({allStats.seasonsPlayed} seasons)</Text>
                </Text>
                <View className="flex-row flex-wrap gap-2.5">
                  <AllTimeTile
                    label="RECORD"
                    value={`${allStats.wins}-${allStats.losses}${allStats.ties ? `-${allStats.ties}` : ""}`}
                  />
                  <AllTimeTile
                    label="WIN %"
                    value={`${(allStats.winPct * 100).toFixed(1)}%`}
                    rank={allStats.ranks.winPct}
                    total={allStats.leagueSize}
                  />
                  <AllTimeTile
                    label="BEST FINISH"
                    value={allStats.bestFinish ?? "N/A"}
                    sub={allStats.bestFinishSeason ?? undefined}
                  />
                  <AllTimeTile
                    label="PLAYOFF APPEARANCES"
                    value={`${allStats.playoffAppearances} / ${allStats.seasonsPlayed}`}
                    rank={allStats.ranks.playoffAppearances}
                    total={allStats.leagueSize}
                  />
                  <AllTimeTile
                    label="TRANSACTIONS"
                    value={String(allStats.totalTransactions)}
                    rank={allStats.ranks.transactions}
                    total={allStats.leagueSize}
                  />
                  <AllTimeTile
                    label="BEST SEASON"
                    value={allStats.bestSeason ? `${allStats.bestSeason.season}: ${allStats.bestSeason.wins}-${allStats.bestSeason.losses}` : "N/A"}
                    rank={allStats.ranks.bestSeason}
                    total={allStats.leagueSize}
                  />
                  <AllTimeTile
                    label="WORST SEASON"
                    value={allStats.worstSeason ? `${allStats.worstSeason.season}: ${allStats.worstSeason.wins}-${allStats.worstSeason.losses}` : "N/A"}
                  />
                  <AllTimeTile
                    label="TRADES"
                    value={String(allStats.totalTrades)}
                  />
                  {isDynasty && (
                    <AllTimeTile
                      label="PICK FLOW"
                      value={`+${allStats.picksGained} / -${allStats.picksLost}`}
                    />
                  )}
                </View>
              </View>
            )}

            {isDynasty && (
            <View className="px-4 pt-5">
              <Text className="font-bold mb-2.5 text-black dark:text-white text-[15px]">
                GM Scout <Text className="text-gray-400 font-normal text-[12px]">this season</Text>
              </Text>
              {currentExtrasLoading ? (
                <ActivityIndicator color="#af1222" />
              ) : (
                <View className="gap-2.5">
                  <View className="flex-row flex-wrap gap-2.5">
                    <AllTimeTile
                      label="AVG ROSTER AGE"
                      value={currentExtras?.avgRosterAge != null ? String(currentExtras.avgRosterAge) : "N/A"}
                    />
                  </View>
                  {(currentExtras?.rookieOnRoster || currentExtras?.recentlyAcquired) && (
                    <View className="flex-row flex-wrap gap-2.5">
                      {currentExtras.rookieOnRoster && (
                        <View className="flex-row items-center gap-2 bg-[#f0eeee] dark:bg-[#141416] rounded-2xl p-2.5" style={{ width: "48%" }}>
                          <Image
                            source={{
                              uri: `https://sleepercdn.com/content/nfl/players/thumb/${currentExtras.rookieOnRoster.sleeperId}.jpg`,
                            }}
                            className="w-8 h-8 rounded-full bg-slate-300"
                          />
                          <View className="flex-1">
                            <Text className="text-gray-500 text-[9px] font-bold tracking-wider">ROOKIE ON ROSTER</Text>
                            <Text numberOfLines={1} className="text-black dark:text-white text-[12px] font-bold">
                              {currentExtras.rookieOnRoster.fn} {currentExtras.rookieOnRoster.ln}
                            </Text>
                          </View>
                        </View>
                      )}
                      {currentExtras.recentlyAcquired && (
                        <View className="flex-row items-center gap-2 bg-[#f0eeee] dark:bg-[#141416] rounded-2xl p-2.5" style={{ width: "48%" }}>
                          <Image
                            source={{
                              uri: `https://sleepercdn.com/content/nfl/players/thumb/${currentExtras.recentlyAcquired.sleeperId}.jpg`,
                            }}
                            className="w-8 h-8 rounded-full bg-slate-300"
                          />
                          <View className="flex-1">
                            <Text className="text-gray-500 text-[9px] font-bold tracking-wider">RECENTLY ACQUIRED</Text>
                            <Text numberOfLines={1} className="text-black dark:text-white text-[12px] font-bold">
                              {currentExtras.recentlyAcquired.fn} {currentExtras.recentlyAcquired.ln}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
            )}

            <View className="px-4 pt-5">
              <Text className="font-bold mb-2.5 text-black dark:text-white text-[15px]">Starting Lineup</Text>
              <View className="flex-row flex-wrap gap-2 mb-7">
                {starters.map((s: Starter, i) => (
                  <View key={i} className="w-[31%]">
                    <PlayerCard
                      variant="tile"
                      playerId={s.id}
                      name={displayName(s)}
                      position={s.pos ?? ""}
                      team={s.team}
                      bottomSlot={<Text className="text-white/80 text-[9px] mt-0.5">{s.points ?? 0} pts</Text>}
                      onExpand={() => setDetailPlayer({ playerId: s.id, name: displayName(s), position: s.pos ?? "", team: s.team })}
                    />
                  </View>
                ))}
              </View>

              <Text className="font-bold mb-2.5 text-black dark:text-white text-[15px]">Schedule</Text>
              <View className="mb-6 rounded-xl border border-gray-100 dark:border-white/10 overflow-hidden">
                {results.map((wr, i) => (
                  <View
                    key={wr.week}
                    className={`flex-row items-center px-3 py-2.5 bg-white dark:bg-[#121212] ${
                      i !== results.length - 1 ? "border-b border-gray-100 dark:border-white/10" : ""
                    }`}
                  >
                    <Text className="w-[38px] text-[11px] font-bold text-gray-400">WK {wr.week}</Text>
                    <Image
                      source={typeof wr.opponentAvatar === "string" ? { uri: wr.opponentAvatar } : wr.opponentAvatar}
                      className="w-[26px] h-[26px] rounded-full mr-2"
                    />
                    <Text numberOfLines={1} className="flex-1 text-[13px] text-black dark:text-white">
                      <Text className="text-gray-400 font-normal">{wr.isHome ? "vs " : "@ "}</Text>
                      {wr.opponentName}
                    </Text>
                    {wr.result === "pending" ? (
                      <Text className="text-[11px] text-gray-400">--</Text>
                    ) : (
                      <>
                        <Text
                          style={{ fontVariant: ["tabular-nums"] }}
                          className="text-[12px] text-gray-500 mr-2"
                        >
                          {wr.myPoints.toFixed(1)}-{wr.oppPoints.toFixed(1)}
                        </Text>
                        <View
                          style={{ backgroundColor: RESULT_COLOR[wr.result] }}
                          className="w-[20px] h-[20px] rounded-full items-center justify-center"
                        >
                          <Text className="text-white text-[10px] font-bold">
                            {wr.result === "win" ? "W" : "L"}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <PlayerDetailModal
        visible={!!detailPlayer}
        onClose={() => setDetailPlayer(null)}
        leagueID={leagueID}
        playerId={detailPlayer?.playerId}
        name={detailPlayer?.name ?? ""}
        position={detailPlayer?.position ?? ""}
        team={detailPlayer?.team}
      />
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[18px] font-bold">
        {value}
      </Text>
      <Text className="text-gray-500 text-[9px] font-bold tracking-wider mt-0.5">{label}</Text>
    </View>
  );
}

function RankStatTile({ label, rank, total }: { label: string; rank?: number; total: number }) {
  const color = rank !== undefined && total > 1 ? rankColor(rank, total) : "#6b7280";
  return (
    <View className="items-center">
      <Text style={{ fontVariant: ["tabular-nums"], color }} className="text-[18px] font-bold">
        {rank !== undefined ? `#${rank}` : "--"}
      </Text>
      <Text className="text-gray-500 text-[9px] font-bold tracking-wider mt-0.5">{label}</Text>
    </View>
  );
}

function rankColor(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 1 / 3) return "#22c55e";
  if (pct <= 2 / 3) return "#eab308";
  return "#6b7280";
}

function AllTimeTile({
  label,
  value,
  sub,
  rank,
  total,
}: {
  label: string;
  value: string;
  sub?: string;
  rank?: number;
  total?: number;
}) {
  return (
    <View style={{ width: "31.5%" }} className="bg-[#f0eeee] dark:bg-[#141416] rounded-2xl p-3 border border-transparent dark:border-white/10">
      <Text className="text-gray-500 text-[9px] font-bold tracking-wider mb-1.5">{label}</Text>
      <Text numberOfLines={1} className="text-black dark:text-white text-[13px] font-bold">
        {value}
      </Text>
      {sub && <Text className="text-gray-500 text-[10px] mt-0.5">{sub}</Text>}
      {rank !== undefined && total !== undefined && total > 1 && (
        <Text style={{ color: rankColor(rank, total) }} className="text-[10px] font-bold mt-1.5">
          #{rank} of {total}
        </Text>
      )}
    </View>
  );
}
