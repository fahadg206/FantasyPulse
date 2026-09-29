import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable, RefreshControl, Modal } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import { getLeagueHistory, SeasonHistory } from "../../../lib/getLeagueHistory";
import PlayoffBracket from "../../../components/PlayoffBracket";
import { BracketMatch } from "../../../lib/getPlayoffBracket";
import { sleeper } from "../../../lib/api";
import getMatchupData, { Starter } from "../../../lib/getMatchupData";
import { getSeasonFinishes, SeasonFinish } from "../../../lib/getSeasonFinish";
import MatchupPlayerGrid from "../../../components/MatchupPlayerGrid";

const helmet = require("../../../assets/images/helmet2.png");

const FINISH_COLOR: Record<SeasonFinish, string> = {
  Champion: "#eab308",
  "Runner-Up": "#cbd5e1",
  "3rd Place": "#d08a4f",
  "Made Playoffs": "#4ade80",
  "Missed Playoffs": "#6b7280",
};

interface MatchDetail {
  starters1: Starter[];
  starters2: Starter[];
  bench1: Starter[];
  bench2: Starter[];
  slots: string[];
  finishOne: SeasonFinish | null;
  finishTwo: SeasonFinish | null;
}

function MatchupDetailModal({
  match,
  leagueId,
  season,
  isPastSeason,
  onClose,
}: {
  match: BracketMatch | null;
  leagueId: string | null;
  season: string | null;
  /** only a completed past season has a real final finish - this year's still-in-progress bracket doesn't yet */
  isPastSeason: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamOne, teamTwo] = match?.teams ?? [null, null];

  useEffect(() => {
    if (!match || !leagueId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [{ updatedScheduleData }, league] = await Promise.all([
          getMatchupData(leagueId, match.week),
          sleeper.getLeague(leagueId).then((r) => r.data),
        ]);
        if (cancelled) return;

        const findByRosterId = (rosterId?: number) =>
          rosterId === undefined
            ? undefined
            : Object.values(updatedScheduleData).find((t) => Number(t.roster_id) === rosterId);
        const team1Data = findByRosterId(teamOne?.rosterId);
        const team2Data = findByRosterId(teamTwo?.rosterId);
        const slots: string[] = (league.roster_positions || []).filter(
          (p: string) => p !== "BN" && p !== "IR" && p !== "TAXI"
        );

        const finishes = isPastSeason ? await getSeasonFinishes(leagueId) : {};
        if (cancelled) return;

        setDetail({
          starters1: (team1Data?.starters_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          starters2: (team2Data?.starters_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          bench1: (team1Data?.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          bench2: (team2Data?.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          slots,
          finishOne: teamOne?.rosterId !== undefined ? (finishes[teamOne.rosterId] ?? null) : null,
          finishTwo: teamTwo?.rosterId !== undefined ? (finishes[teamTwo.rosterId] ?? null) : null,
        });
      } catch (error) {
        console.error("Error loading bracket matchup detail:", error);
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, leagueId, isPastSeason]);

  return (
    <Modal visible={!!match} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-[#0c0c0e]">
        <View className="flex-row items-center justify-between px-4 pt-14 pb-3">
          <Text className="text-white text-[15px] font-bold">
            {season} Season · Week {match?.week}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={20} color="#fff" />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View className="flex-row justify-around px-4 pb-5">
            {[teamOne, teamTwo].map((team, i) => {
              const isWinner = !!match?.winnerRosterId && team?.rosterId === match.winnerRosterId;
              const finish = i === 0 ? detail?.finishOne : detail?.finishTwo;
              return (
                <View key={i} className="items-center">
                  <Image
                    source={team?.avatar ? { uri: team.avatar } : helmet}
                    style={isWinner ? { borderWidth: 2, borderColor: "#22c55e" } : undefined}
                    className="w-[44px] h-[44px] rounded-full mb-1"
                  />
                  <Text numberOfLines={1} className="text-[12px] font-bold text-white max-w-[120px] text-center">
                    {team?.name ?? "Unknown"}
                  </Text>
                  {team?.points !== undefined && (
                    <Text
                      style={{ fontVariant: ["tabular-nums"], color: isWinner ? "#22c55e" : "#fff" }}
                      className="text-[18px] font-bold mt-0.5"
                    >
                      {team.points.toFixed(1)}
                    </Text>
                  )}
                  {finish && (
                    <View
                      style={{ backgroundColor: `${FINISH_COLOR[finish]}22`, borderColor: `${FINISH_COLOR[finish]}55` }}
                      className="px-2 py-0.5 rounded-full border mt-1.5"
                    >
                      <Text style={{ color: FINISH_COLOR[finish] }} className="text-[9px] font-bold">
                        {finish}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {loading || !detail ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#af1222" />
            </View>
          ) : (
            <MatchupPlayerGrid
              starters1={detail.starters1}
              starters2={detail.starters2}
              bench1={detail.bench1}
              bench2={detail.bench2}
              slots={detail.slots}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const FINISH_MEDAL: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  champion: { icon: "trophy", color: "#eab308" },
  runnerUp: { icon: "medal", color: "#cbd5e1" },
  thirdPlace: { icon: "medal", color: "#d08a4f" },
};

function SeasonCard({ season, onViewBracket }: { season: SeasonHistory; onViewBracket: () => void }) {
  return (
    <Pressable onPress={onViewBracket} className="bg-[#141416] border border-white/10 rounded-2xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-white font-bold text-[15px]">{season.season} Season</Text>
        <View className="flex-row items-center gap-1">
          <Text className="text-brand text-[11px] font-semibold">View Bracket</Text>
          <Ionicons name="chevron-forward" size={11} color="#af1222" />
        </View>
      </View>
      <View className="flex-row justify-around">
        {(["champion", "runnerUp", "thirdPlace"] as const).map((key) => {
          const team = season[key];
          if (!team) return null;
          const medal = FINISH_MEDAL[key];
          return (
            <View key={key} className="items-center flex-1">
              <View className="relative">
                <Image
                  source={team.avatar ? { uri: team.avatar } : helmet}
                  style={{ borderColor: medal.color }}
                  className="w-[44px] h-[44px] rounded-full border-2"
                />
                <View
                  style={{ backgroundColor: medal.color }}
                  className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full items-center justify-center border-2 border-[#141416]"
                >
                  <Ionicons name={medal.icon} size={9} color="#0c0c0e" />
                </View>
              </View>
              <Text numberOfLines={1} className="text-white text-[11px] font-semibold mt-1.5 max-w-[90px] text-center">
                {team.name}
              </Text>
              <Text className="text-gray-500 text-[9px] font-bold tracking-wide">
                {key === "champion" ? "CHAMPION" : key === "runnerUp" ? "RUNNER-UP" : "3RD PLACE"}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

export default function LeagueHistoryScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [history, setHistory] = useState<SeasonHistory[] | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [selectedMatch, setSelectedMatch] = useState<{ match: BracketMatch; leagueId: string } | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    getLeagueHistory(leagueID)
      .then((result) => {
        if (cancelled) return;
        setHistory(result);
        // Most of the season there's no finished (or even started) current-
        // season bracket yet - defaulting to the most recent COMPLETED one
        // means this section actually shows something worth looking at
        // most of the time, not just "playoffs haven't started."
        setSelectedLeagueId((prev) => prev ?? result[0]?.leagueId ?? leagueID);
      })
      .catch((error) => {
        console.error("Error loading league history:", error);
        if (!cancelled) {
          setHistory([]);
          setSelectedLeagueId((prev) => prev ?? leagueID);
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueID, refreshKey]);

  const seasonOptions = useMemo(() => {
    const options = (history ?? []).map((s) => ({ label: s.season, leagueId: s.leagueId }));
    // "This Season" only earns its own pill when it isn't already the same
    // season as the most recent history entry (a just-finished season's
    // bracket is both "current" and the newest history row at once).
    if (leagueID && options[0]?.leagueId !== leagueID) {
      options.unshift({ label: "This Season", leagueId: leagueID });
    }
    return options;
  }, [history, leagueID]);

  if (!leagueID) return null;

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-[#0c0c0e]"
      contentContainerClassName="p-4"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setRefreshKey((k) => k + 1);
          }}
          tintColor="#af1222"
        />
      }
    >
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">LEAGUE HISTORY</Text>
      <Text className="text-white text-[20px] font-bold mb-5">Champions &amp; Records</Text>

      <Text className="text-[13px] font-bold tracking-wider text-gray-500 mb-3">PLAYOFF BRACKET</Text>

      {seasonOptions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-3">
          {seasonOptions.map((opt) => {
            const active = opt.leagueId === selectedLeagueId;
            return (
              <Pressable
                key={opt.leagueId}
                onPress={() => setSelectedLeagueId(opt.leagueId)}
                className={`px-3 py-1.5 rounded-full border ${active ? "bg-brand border-brand" : "bg-[#141416] border-white/10"}`}
              >
                <Text className={`text-[12px] font-bold ${active ? "text-white" : "text-gray-400"}`}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View className="bg-[#0c0c0e] -mx-4 px-4 mb-6">
        {selectedLeagueId && (
          <PlayoffBracket leagueID={selectedLeagueId} onSelectMatch={(match, leagueId) => setSelectedMatch({ match, leagueId })} />
        )}
      </View>

      <Text className="text-[13px] font-bold tracking-wider text-gray-500 mb-3">CHAMPIONS TIMELINE</Text>
      {history === null ? (
        <ActivityIndicator color="#af1222" className="mt-4" />
      ) : history.length === 0 ? (
        <Text className="text-gray-500 text-[13px]">
          No completed seasons with a finished playoff bracket yet.
        </Text>
      ) : (
        history.map((season) => (
          <SeasonCard
            key={season.season}
            season={season}
            onViewBracket={() => {
              setSelectedLeagueId(season.leagueId);
              scrollRef.current?.scrollTo({ y: 0, animated: true });
            }}
          />
        ))
      )}

      <MatchupDetailModal
        match={selectedMatch?.match ?? null}
        leagueId={selectedMatch?.leagueId ?? null}
        season={seasonOptions.find((o) => o.leagueId === selectedMatch?.leagueId)?.label ?? null}
        isPastSeason={!!selectedMatch && selectedMatch.leagueId !== leagueID}
        onClose={() => setSelectedMatch(null)}
      />
    </ScrollView>
  );
}
