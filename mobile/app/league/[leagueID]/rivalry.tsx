import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import {
  fetchLeagueManagers,
  fetchRivalry,
  computeRivalryHighlights,
  Rivalry,
  RivalryMatchup,
  TeamManagersMap,
  RivalUser,
} from "../../../lib/getRivalry";
import getMatchupData, { Starter } from "../../../lib/getMatchupData";
import { getSeasonFinishes, SeasonFinish } from "../../../lib/getSeasonFinish";
import ManagerPicker from "../../../components/ManagerPicker";
import HeadToHead from "../../../components/HeadToHead";
import MatchupPlayerGrid from "../../../components/MatchupPlayerGrid";

const helmet = require("../../../assets/images/helmet2.png");
const matchupsImg = require("../../../assets/images/matchupsImage.png");

const FINISH_COLOR: Record<SeasonFinish, string> = {
  Champion: "#eab308",
  "Runner-Up": "#cbd5e1",
  "3rd Place": "#d08a4f",
  "Made Playoffs": "#4ade80",
  "Missed Playoffs": "#6b7280",
};

function FinishBadge({ finish, align }: { finish: SeasonFinish; align: "left" | "right" }) {
  return (
    <View
      style={{ backgroundColor: `${FINISH_COLOR[finish]}22`, borderColor: `${FINISH_COLOR[finish]}55` }}
      className={`px-2 py-0.5 rounded-full border ${align === "right" ? "self-end" : "self-start"}`}
    >
      <Text style={{ color: FINISH_COLOR[finish] }} className="text-[9px] font-bold">
        {finish}
      </Text>
    </View>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color = "#af1222",
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  sub?: string;
  color?: string;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={{ width: "48.5%" }}
      className="bg-[#141416] border border-white/10 rounded-2xl p-3.5 mb-2.5"
    >
      <View className="flex-row items-center gap-1.5 mb-2">
        <Feather name={icon} size={12} color={color} />
        <Text className="text-gray-500 text-[9px] font-bold tracking-wider">{label}</Text>
      </View>
      <Text numberOfLines={1} className="text-white text-[15px] font-bold">
        {value}
      </Text>
      {sub && (
        <Text numberOfLines={1} className="text-gray-500 text-[10px] mt-0.5">
          {sub}
        </Text>
      )}
    </Wrapper>
  );
}

export default function RivalryScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [users, setUsers] = useState<Record<string, RivalUser>>({});
  const [teamManagersMap, setTeamManagersMap] = useState<TeamManagersMap>({});
  const [userOne, setUserOne] = useState<string | null>(null);
  const [userTwo, setUserTwo] = useState<string | null>(null);
  const [rivalry, setRivalry] = useState<Rivalry | null>(null);
  const [loadingManagers, setLoadingManagers] = useState(true);
  const [loadingRivalry, setLoadingRivalry] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [currentSeason, setCurrentSeason] = useState("");

  interface SlateDetail {
    starters1: Starter[];
    starters2: Starter[];
    bench1: Starter[];
    bench2: Starter[];
    slots: string[];
    finishOne: SeasonFinish | null;
    finishTwo: SeasonFinish | null;
  }
  const [slateDetail, setSlateDetail] = useState<SlateDetail | null>(null);
  const [loadingSlateDetail, setLoadingSlateDetail] = useState(false);

  useEffect(() => {
    if (!leagueID) return;
    fetchLeagueManagers(leagueID)
      .then(({ users, teamManagersMap, currentSeason }) => {
        setUsers(users);
        setTeamManagersMap(teamManagersMap);
        setCurrentSeason(currentSeason);
      })
      .catch((e) => console.error("Error loading league managers:", e))
      .finally(() => setLoadingManagers(false));
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID || !userOne || !userTwo || userOne === userTwo) return;
    setLoadingRivalry(true);
    setWeekIndex(0);
    fetchRivalry(leagueID, userOne, userTwo, teamManagersMap)
      .then(setRivalry)
      .catch((e) => console.error("Error loading rivalry:", e))
      .finally(() => setLoadingRivalry(false));
  }, [leagueID, userOne, userTwo, teamManagersMap]);

  // Real per-player detail for whichever meeting is currently on screen -
  // that season's own real starters/bench (matching the current-week
  // matchup screen's roster grid, not just a flat list of starters) and,
  // if it's a past season, each team's real final finish that year.
  useEffect(() => {
    const slateNow = rivalry?.matchups[weekIndex];
    if (!slateNow || !userOne || !userTwo) {
      setSlateDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingSlateDetail(true);

    (async () => {
      try {
        const [{ updatedScheduleData }, league] = await Promise.all([
          getMatchupData(slateNow.leagueId, slateNow.week),
          sleeper.getLeague(slateNow.leagueId).then((r) => r.data),
        ]);
        if (cancelled) return;

        const team1 = updatedScheduleData[userOne];
        const team2 = updatedScheduleData[userTwo];
        const slots: string[] = (league.roster_positions || []).filter(
          (p: string) => p !== "BN" && p !== "IR" && p !== "TAXI"
        );

        let finishOne: SeasonFinish | null = null;
        let finishTwo: SeasonFinish | null = null;
        if (slateNow.year !== currentSeason) {
          const finishes = await getSeasonFinishes(slateNow.leagueId);
          if (cancelled) return;
          finishOne = finishes[Number(slateNow.rosterIdOne)] ?? null;
          finishTwo = finishes[Number(slateNow.rosterIdTwo)] ?? null;
        }
        if (cancelled) return;

        setSlateDetail({
          starters1: (team1?.starters_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          starters2: (team2?.starters_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          bench1: (team1?.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          bench2: (team2?.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0),
          slots,
          finishOne,
          finishTwo,
        });
      } catch (error) {
        console.error("Error loading rivalry matchup detail:", error);
        if (!cancelled) setSlateDetail(null);
      } finally {
        if (!cancelled) setLoadingSlateDetail(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rivalry, weekIndex, userOne, userTwo, currentSeason]);

  const managerOptions = useMemo(
    () => Object.values(users).map((u) => ({ id: u.managerID, name: u.userName, avatar: u.avatar })),
    [users]
  );

  const highlights = useMemo(() => (rivalry ? computeRivalryHighlights(rivalry) : null), [rivalry]);

  const jumpTo = (m: RivalryMatchup) => {
    if (!rivalry) return;
    const idx = rivalry.matchups.findIndex((x) => x.year === m.year && x.week === m.week);
    if (idx !== -1) setWeekIndex(idx);
  };

  const slate = rivalry?.matchups[weekIndex];
  const userOneInfo = users[userOne ?? ""];
  const userTwoInfo = users[userTwo ?? ""];

  if (!leagueID) return null;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 items-center pb-10">
      <View className="w-full mb-4">
        <Text className="text-[11px] font-bold tracking-widest text-brand">RIVALRY</Text>
        <Text className="text-white text-[21px] font-bold mt-0.5">Head-to-Head</Text>
        <Text className="text-gray-500 text-[12px] mt-1">
          Every meeting these two managers have ever had, and the storylines buried in it.
        </Text>
      </View>

      <View className="flex-row items-center gap-3 mb-5">
        <ManagerPicker
          label="Select User"
          options={managerOptions}
          selectedId={userOne}
          onSelect={setUserOne}
          excludeId={userTwo}
        />
        <Text className="font-bold text-white">vs.</Text>
        <ManagerPicker
          label="Select User"
          options={managerOptions}
          selectedId={userTwo}
          onSelect={setUserTwo}
          excludeId={userOne}
        />
      </View>

      {loadingManagers && <ActivityIndicator color="#af1222" className="mt-4" />}

      {!userOne || !userTwo ? (
        <Image source={matchupsImg} className="w-full h-[180px] mt-10 opacity-90" resizeMode="contain" />
      ) : loadingRivalry ? (
        <View className="items-center mt-10">
          <ActivityIndicator color="#af1222" size="large" />
          <Text className="mt-2 text-white">Loading Rivalry…</Text>
        </View>
      ) : !rivalry || rivalry.matchups.length === 0 ? (
        <Text className="mt-10 text-gray-500 text-center px-6">
          These managers haven&apos;t faced each other in a tracked season yet.
        </Text>
      ) : (
        <View className="w-full mt-2">
          <HeadToHead
            nameOne={userOneInfo?.userName ?? ""}
            avatarOne={userOneInfo?.avatar}
            userIdOne={userOne ?? undefined}
            nameTwo={userTwoInfo?.userName ?? ""}
            avatarTwo={userTwoInfo?.avatar}
            userIdTwo={userTwo ?? undefined}
            winsOne={rivalry.wins.one}
            winsTwo={rivalry.wins.two}
            ties={rivalry.ties}
            pointsOne={rivalry.points.one}
            pointsTwo={rivalry.points.two}
            playoffWinsOne={rivalry.playoffWins.one}
            playoffWinsTwo={rivalry.playoffWins.two}
            playoffTies={rivalry.playoffTies}
          />

          {highlights && (
            <View className="w-full flex-row flex-wrap justify-between mb-1">
              {highlights.streak && highlights.streak.count > 1 && (
                <StatCard
                  icon="zap"
                  label="CURRENT STREAK"
                  color="#eab308"
                  value={
                    highlights.streak.side === "tie"
                      ? `${highlights.streak.count} straight ties`
                      : `${highlights.streak.count} straight for ${
                          highlights.streak.side === "one" ? userOneInfo?.userName : userTwoInfo?.userName
                        }`
                  }
                />
              )}

              {highlights.closestGame && (
                <StatCard
                  icon="crosshair"
                  label="CLOSEST GAME"
                  color="#3b82f6"
                  value={`${highlights.closestGame.margin.toFixed(1)} pt margin`}
                  sub={`${highlights.closestGame.matchup.year} · Week ${highlights.closestGame.matchup.week}`}
                  onPress={() => jumpTo(highlights.closestGame!.matchup)}
                />
              )}

              {highlights.biggestBlowout && (
                <StatCard
                  icon="trending-up"
                  label="BIGGEST BLOWOUT"
                  color="#ef4444"
                  value={`${(highlights.biggestBlowout.winner === "one" ? userOneInfo?.userName : userTwoInfo?.userName) ?? ""} by ${highlights.biggestBlowout.margin.toFixed(1)}`}
                  sub={`${highlights.biggestBlowout.matchup.year} · Week ${highlights.biggestBlowout.matchup.week}`}
                  onPress={() => jumpTo(highlights.biggestBlowout!.matchup)}
                />
              )}

              {highlights.highestCombined && (
                <StatCard
                  icon="activity"
                  label="HIGHEST-SCORING"
                  color="#22c55e"
                  value={`${(highlights.highestCombined.totalOne + highlights.highestCombined.totalTwo).toFixed(1)} combined`}
                  sub={`${highlights.highestCombined.matchup.year} · Week ${highlights.highestCombined.matchup.week}`}
                  onPress={() => jumpTo(highlights.highestCombined!.matchup)}
                />
              )}

            </View>
          )}

          {/* One chip per meeting, in the same order weekIndex navigates -
              a quick visual scan of the whole series (who won each one)
              and a faster way to jump than stepping one at a time. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full mb-4 -mx-1">
            <View className="flex-row gap-1.5 px-1">
              {rivalry.matchups.map((m, i) => {
                const totalOne = m.matchup[0].points.reduce((t, v) => t + parseFloat(String(v)), 0);
                const totalTwo = m.matchup[1].points.reduce((t, v) => t + parseFloat(String(v)), 0);
                const won = totalOne === totalTwo ? null : totalOne > totalTwo;
                const active = i === weekIndex;
                const dotColor = won === null ? "#6b7280" : won ? "#3b82f6" : "#af1222";
                return (
                  <Pressable
                    key={`${m.year}-${m.week}`}
                    onPress={() => setWeekIndex(i)}
                    className={`items-center px-2.5 py-1.5 rounded-xl border ${
                      active ? "bg-white/10 border-white/20" : "bg-white/[0.03] border-white/5"
                    }`}
                  >
                    <View style={{ backgroundColor: dotColor }} className="w-[6px] h-[6px] rounded-full mb-1" />
                    <Text className={`text-[9px] font-bold ${active ? "text-white" : "text-gray-500"}`}>
                      {String(m.year).slice(2)} W{m.week}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {slate && (
            <View className="items-center">
              <View className="flex-row items-center gap-6 mb-4">
                <Pressable
                  onPress={() => setWeekIndex((i) => Math.max(0, i - 1))}
                  disabled={weekIndex === 0}
                  hitSlop={10}
                  className="p-1"
                >
                  <Feather name="chevron-left" size={22} color={weekIndex === 0 ? "#4b5563" : "#af1222"} />
                </Pressable>
                <View className="items-center">
                  <Text className="font-bold text-white text-[14px]">{slate.year} Season</Text>
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-gray-500 text-[11px]">Week {slate.week}</Text>
                    {slate.isPlayoff && (
                      <View className="bg-[#eab30822] border border-[#eab30840] rounded-full px-1.5 py-0.5">
                        <Text className="text-[#eab308] text-[8px] font-bold tracking-wider">PLAYOFFS</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable
                  onPress={() => setWeekIndex((i) => Math.min(rivalry.matchups.length - 1, i + 1))}
                  disabled={weekIndex === rivalry.matchups.length - 1}
                  hitSlop={10}
                  className="p-1"
                >
                  <Feather
                    name="chevron-right"
                    size={22}
                    color={weekIndex === rivalry.matchups.length - 1 ? "#4b5563" : "#af1222"}
                  />
                </Pressable>
              </View>

              <View className="w-full flex-row justify-around mb-4">
                {slate.matchup.map((side, sideIdx) => {
                  const rosterInfo = teamManagersMap[slate.year]?.[side.roster_id];
                  const total = side.points.reduce((t, v) => t + parseFloat(String(v)), 0);
                  const otherTotal = slate.matchup[sideIdx === 0 ? 1 : 0].points.reduce(
                    (t, v) => t + parseFloat(String(v)),
                    0
                  );
                  const isWinner = total > 0 && total > otherTotal;
                  return (
                    <View key={sideIdx} className="items-center">
                      <Image
                        source={
                          rosterInfo?.team.avatar
                            ? { uri: `https://sleepercdn.com/avatars/thumbs/${rosterInfo.team.avatar}` }
                            : helmet
                        }
                        style={isWinner ? { borderWidth: 2, borderColor: "#22c55e" } : undefined}
                        className="w-[36px] h-[36px] rounded-full mb-1"
                      />
                      <Text numberOfLines={1} className="text-[11px] font-bold text-white max-w-[110px]">
                        {rosterInfo?.team.name ?? "Unknown"}
                      </Text>
                      <Text
                        style={{ fontVariant: ["tabular-nums"], color: isWinner ? "#22c55e" : "#ffffff" }}
                        className="text-[18px] font-bold mt-0.5"
                      >
                        {total.toFixed(2) === "0.00" ? "-" : total.toFixed(1)}
                      </Text>
                      {/* Real final standing for that season, only when it
                          actually was a past one - the current season has
                          no finish yet. */}
                      {sideIdx === 0 && slateDetail?.finishOne && (
                        <View className="mt-1">
                          <FinishBadge finish={slateDetail.finishOne} align="left" />
                        </View>
                      )}
                      {sideIdx === 1 && slateDetail?.finishTwo && (
                        <View className="mt-1">
                          <FinishBadge finish={slateDetail.finishTwo} align="right" />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Same real player-by-player grid the current-week matchup
                  screen uses (components/MatchupPlayerGrid.tsx) - real
                  starters and bench for that exact real week, not just a
                  flat starters list. */}
              <View className="w-full rounded-2xl overflow-hidden">
                {loadingSlateDetail || !slateDetail ? (
                  <View className="py-8 items-center bg-[#141416]">
                    <ActivityIndicator color="#af1222" />
                  </View>
                ) : (
                  <MatchupPlayerGrid
                    starters1={slateDetail.starters1}
                    starters2={slateDetail.starters2}
                    bench1={slateDetail.bench1}
                    bench2={slateDetail.bench2}
                    slots={slateDetail.slots}
                  />
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
