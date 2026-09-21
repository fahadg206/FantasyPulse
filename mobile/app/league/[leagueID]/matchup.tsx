import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import getMatchupData, { ScheduleData, Starter } from "../../../lib/getMatchupData";
import { getTopPerformers, TopPerformer, displayName } from "../../../lib/getTopPerformers";
import useTimeChecks from "../../../lib/useTimeChecks";
import SchedulePoll from "../../../components/SchedulePoll";
import MatchupPredictorRing from "../../../components/MatchupPredictorRing";
import { getTeamColor, getTeamLogo } from "../../../lib/nflTeams";
import AnimatedNumber from "../../../components/AnimatedNumber";
import BigPlayToast from "../../../components/BigPlayToast";
import MatchupFeed from "../../../components/MatchupFeed";
import useBigPlayFeed from "../../../lib/useBigPlayFeed";

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#eab308",
  DEF: "#94a3b8",
  K: "#a855f7",
  FLEX: "#f97316",
  SFLEX: "#f97316",
};

const SLOT_LABEL: Record<string, string> = {
  WRRB_FLEX: "FLEX",
  FLEX: "FLEX",
  REC_FLEX: "FLEX",
  SUPER_FLEX: "SFLEX",
  IDP_FLEX: "IDP",
};

function slotLabel(slot: string) {
  return SLOT_LABEL[slot] ?? slot;
}

export default function MatchupDetail() {
  const { leagueID, week: weekParam, matchupID } = useLocalSearchParams<{
    leagueID: string;
    week: string;
    matchupID: string;
  }>();
  const week = parseInt(weekParam, 10);

  const [scheduleData, setScheduleData] = useState<ScheduleData>({});
  const [team1Id, setTeam1Id] = useState<string | null>(null);
  const [team2Id, setTeam2Id] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [displayWeek, setDisplayWeek] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [topPerformers, setTopPerformers] = useState<{ team1: TopPerformer[]; team2: TopPerformer[] }>({
    team1: [],
    team2: [],
  });
  const [season, setSeason] = useState<string>();
  const [scoringSettings, setScoringSettings] = useState<{ [stat: string]: number }>({});
  const [feedOpen, setFeedOpen] = useState(false);
  const [playersDataForFeed, setPlayersDataForFeed] = useState<Record<string, any>>({});

  const { isSundayAfternoon, isSundayEvening, isSundayNight, isMondayNight } = useTimeChecks();
  const preGameEnded = isSundayAfternoon || isSundayEvening || isSundayNight || isMondayNight;

  useEffect(() => {
    if (!leagueID || !matchupID || !week) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ data: nflState }, { data: league }, { matchupMap, updatedScheduleData, playersData }] =
          await Promise.all([sleeper.getNflState(), sleeper.getLeague(leagueID), getMatchupData(leagueID, week)]);
        if (cancelled) return;
        const currentWeek = nflState.display_week ?? 1;
        setDisplayWeek(currentWeek);
        setSeason(nflState.season);
        setScoringSettings(league.scoring_settings || {});
        setSlots((league.roster_positions as string[]).filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI"));
        setScheduleData(updatedScheduleData);
        setPlayersDataForFeed(playersData || {});
        const teams = matchupMap.get(matchupID);
        const t1 = teams?.[0]?.user_id ?? null;
        const t2 = teams?.[1]?.user_id ?? null;
        setTeam1Id(t1);
        setTeam2Id(t2);

        if (t1 && t2) {
          const roster1 = updatedScheduleData[t1]?.roster_id;
          const roster2 = updatedScheduleData[t2]?.roster_id;
          const starters1 = updatedScheduleData[t1]?.starters_full_data ?? [];
          const starters2 = updatedScheduleData[t2]?.starters_full_data ?? [];
          if (roster1 && roster2) {
            const throughWeek = Math.max(0, currentWeek - 1);
            const performers = await getTopPerformers(
              leagueID,
              roster1,
              starters1,
              roster2,
              starters2,
              throughWeek,
              playersData,
              currentWeek,
              3
            );
            if (!cancelled) setTopPerformers(performers);
          }
        }
      } catch (error) {
        console.error("Error loading matchup detail:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID, matchupID, week]);

  const team1 = team1Id ? scheduleData[team1Id] : undefined;
  const team2 = team2Id ? scheduleData[team2Id] : undefined;

  // Called unconditionally (before any early return below) so this hook's
  // call order never changes between renders - it just stays disabled
  // until there's a real matchup and season to poll for.
  const { latestPlay: matchupLatestPlay } = useBigPlayFeed({
    week,
    season: season ?? "",
    team1: {
      userId: team1Id ?? "",
      name: team1?.name ?? "",
      starterSleeperIds: (team1?.starters_full_data ?? []).map((s) => s.id).filter(Boolean) as string[],
    },
    team2: {
      userId: team2Id ?? "",
      name: team2?.name ?? "",
      starterSleeperIds: (team2?.starters_full_data ?? []).map((s) => s.id).filter(Boolean) as string[],
    },
    playersData: playersDataForFeed,
    scoringSettings,
    enabled: !loading && !!team1Id && !!team2Id && !!season,
  });

  if (!leagueID || !matchupID || !week) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" size="large" />
      </View>
    );
  }

  if (!team1 || !team2) {
    return (
      <View className="flex-1 items-center justify-center p-6 bg-[#0c0c0e]">
        <Text className="text-gray-400 text-center">Couldn&apos;t find this matchup.</Text>
      </View>
    );
  }

  const team1Points = parseFloat(team1.team_points || "0");
  const team2Points = parseFloat(team2.team_points || "0");
  const preGame = team1Points === 0 && team2Points === 0;
  const s1 = team1.starters_points || [];
  const s2 = team2.starters_points || [];
  const liveGame = !preGame && (s1.includes(0) || s2.includes(0));
  const postGame = !preGame && !liveGame && (preGameEnded || (displayWeek !== undefined && displayWeek > week));

  const starters1 = team1.starters_full_data ?? [];
  const starters2 = team2.starters_full_data ?? [];
  const bench1 = (team1.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0);
  const bench2 = (team2.bench_full_data ?? []).filter((s) => Object.keys(s).length > 0);
  const total1 = team1.wins !== undefined ? `${team1.wins}-${team1.losses}` : "0-0";
  const total2 = team2.wins !== undefined ? `${team2.wins}-${team2.losses}` : "0-0";

  const rowCount = Math.max(slots.length, starters1.length, starters2.length);
  const benchRowCount = Math.max(bench1.length, bench2.length);

  const proj1 = starters1.reduce((sum, s) => sum + parseFloat(s.proj || "0"), 0);
  const proj2 = starters2.reduce((sum, s) => sum + parseFloat(s.proj || "0"), 0);
  const projTotal = proj1 + proj2 || 1;
  const pct1 = Math.round((proj1 / projTotal) * 100);
  const pct2 = 100 - pct1;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View className="pt-6 pb-5 px-4">
        <View className="flex-row items-center justify-between">
          <TeamHeader name={team1.name} avatar={team1.avatar} record={total1} />
          <View className="items-center px-2">
            {preGame ? (
              <>
                <Text className="text-[10px] font-bold text-gray-400 tracking-widest mb-1">WEEK {week}</Text>
                <Text className="text-white text-[20px] font-bold">@</Text>
              </>
            ) : (
              <>
                <Text
                  className="text-[9px] font-bold tracking-widest mb-1"
                  style={{ color: liveGame ? "#ef4444" : "#9ca3af" }}
                >
                  {liveGame ? "LIVE" : postGame ? "FINAL" : `WEEK ${week}`}
                </Text>
                <View className="flex-row items-center gap-3">
                  <AnimatedNumber
                    value={team1Points}
                    decimals={1}
                    style={{ fontVariant: ["tabular-nums"] }}
                    className={`text-[26px] font-bold ${team1Points >= team2Points ? "text-white" : "text-gray-500"}`}
                  />
                  <Text className="text-gray-600 text-[16px]">-</Text>
                  <AnimatedNumber
                    value={team2Points}
                    decimals={1}
                    style={{ fontVariant: ["tabular-nums"] }}
                    className={`text-[26px] font-bold ${team2Points >= team1Points ? "text-white" : "text-gray-500"}`}
                  />
                </View>
              </>
            )}
          </View>
          <TeamHeader name={team2.name} avatar={team2.avatar} record={total2} align="right" />
        </View>

        <View className="items-center mt-3">
          <BigPlayToast play={matchupLatestPlay} />
        </View>

        {/* Matchup Predictor */}
        {(proj1 > 0 || proj2 > 0) && (
          <View className="mt-5">
            <MatchupPredictorRing
              pct1={pct1}
              pct2={pct2}
              team1Name={team1.name}
              team2Name={team2.name}
              team1Avatar={team1.avatar}
              team2Avatar={team2.avatar}
            />
          </View>
        )}
      </View>

      {/* Season top performers - its own section, separate from this week's scoring */}
      <View className="px-4 pb-5">
        <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2">
          {topPerformers.team1[0]?.isProjected || topPerformers.team2[0]?.isProjected
            ? "PROJECTED TOP PERFORMERS"
            : "SEASON TOP PERFORMERS"}
        </Text>
        <View className="flex-row justify-between gap-3">
          <View className="flex-1 gap-2">
            {(topPerformers.team1.length > 0 ? topPerformers.team1 : [null]).map((p, i) => (
              <TopPerformerCard key={i} performer={p} />
            ))}
          </View>
          <View className="flex-1 gap-2">
            {(topPerformers.team2.length > 0 ? topPerformers.team2 : [null]).map((p, i) => (
              <TopPerformerCard key={i} performer={p} align="right" />
            ))}
          </View>
        </View>
      </View>

      {preGame && !liveGame && (
        <View className="items-center py-4 bg-[#131315]">
          <SchedulePoll
            leagueID={leagueID}
            team1Name={team1.name}
            team2Name={team2.name}
            matchupId={matchupID}
            nflWeek={displayWeek}
            liveGame={liveGame}
          />
        </View>
      )}

      <View className="bg-white dark:bg-black rounded-t-3xl pt-5 pb-10">
        <SectionHeader title="Starters" week={week} />
        <View className="px-3">
          {Array.from({ length: rowCount }, (_, i) => (
            <MatchupRow key={i} left={starters1[i]} right={starters2[i]} slot={slots[i]} />
          ))}
        </View>

        {benchRowCount > 0 && (
          <>
            <View className="mt-4">
              <SectionHeader title="Bench" />
            </View>
            <View className="px-3">
              {Array.from({ length: benchRowCount }, (_, i) => (
                <MatchupRow key={i} left={bench1[i]} right={bench2[i]} dimmed />
              ))}
            </View>
          </>
        )}

        <View className="mt-4 px-4">
          <Pressable
            onPress={() => setFeedOpen((open) => !open)}
            className="flex-row items-center gap-1.5 py-2"
          >
            <Feather name="activity" size={14} color="#9ca3af" />
            <Text className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">
              {feedOpen ? "Hide Feed" : "Feed"}
            </Text>
          </Pressable>
          {feedOpen && season && (
            <MatchupFeed
              week={week}
              season={season}
              team1={{
                userId: team1Id ?? "",
                name: team1.name,
                starterSleeperIds: starters1.map((s) => s.id).filter(Boolean) as string[],
              }}
              team2={{
                userId: team2Id ?? "",
                name: team2.name,
                starterSleeperIds: starters2.map((s) => s.id).filter(Boolean) as string[],
              }}
              playersData={playersDataForFeed}
              scoringSettings={scoringSettings}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function SectionHeader({ title, week }: { title: string; week?: number }) {
  return (
    <View className="flex-row items-center justify-between px-4 mb-2">
      <Text className="font-bold text-[15px] text-black dark:text-white">{title}</Text>
      {week !== undefined && <Text className="text-[12px] text-gray-400">Week {week}</Text>}
    </View>
  );
}

function TeamHeader({
  name,
  avatar,
  record,
  align = "left",
}: {
  name: string;
  avatar: any;
  record: string;
  align?: "left" | "right";
}) {
  return (
    <View className="items-center flex-1">
      <Image
        source={typeof avatar === "string" ? { uri: avatar } : avatar}
        className="w-[52px] h-[52px] rounded-full mb-1.5"
      />
      <Text numberOfLines={1} className="text-white text-[12px] font-bold text-center px-1">
        {name}
      </Text>
      <Text className="text-gray-400 text-[10px] mt-0.5">{record}</Text>
    </View>
  );
}

function TopPerformerCard({ performer, align = "left" }: { performer: TopPerformer | null; align?: "left" | "right" }) {
  const isDef = performer?.pos === "DEF";
  const photoUri = performer
    ? isDef
      ? getTeamLogo(performer.team) ?? undefined
      : `https://sleepercdn.com/content/nfl/players/thumb/${performer.playerId}.jpg`
    : undefined;

  return (
    <View
      className={`flex-1 bg-white/5 rounded-xl px-3 py-2.5 flex-row items-center gap-2.5 ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      {performer ? (
        <>
          <Image
            source={photoUri ? { uri: photoUri } : undefined}
            resizeMode={isDef ? "contain" : "cover"}
            className={isDef ? "w-[32px] h-[32px]" : "w-[36px] h-[36px] rounded-full bg-white/10"}
          />
          <View className={align === "right" ? "items-end flex-1" : "items-start flex-1"}>
            <Text numberOfLines={1} className="text-white text-[13px] font-bold">
              {performer.name}
            </Text>
            <View className={`flex-row items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[#e2465a] text-[11px] font-bold">
                {(performer.ppg ?? 0).toFixed(1)} PPG
              </Text>
              {performer.isProjected && <Text className="text-[9px] text-gray-500 italic">(proj.)</Text>}
            </View>
            <Text className="text-[10px] text-gray-500">{performer.team}</Text>
          </View>
        </>
      ) : (
        <Text className="text-gray-600 text-[12px] flex-1 text-center">No data yet</Text>
      )}
    </View>
  );
}

function PlayerHalf({ player, align }: { player?: Starter; align: "left" | "right" }) {
  if (!player || Object.keys(player).length === 0) {
    return (
      <View className={`flex-1 flex-row items-center ${align === "right" ? "justify-end" : ""}`}>
        <Text className="text-[11px] text-gray-400 italic">Empty</Text>
      </View>
    );
  }
  const isDef = player.pos === "DEF";
  const logo = isDef ? null : getTeamLogo(player.team);
  const hasScored = !!player.points && player.points !== "0";

  const info = (
    <View className={align === "left" ? "items-start" : "items-end"}>
      <Text numberOfLines={1} className="text-[13px] font-bold text-black dark:text-white">
        {displayName(player)}
      </Text>
      <View className={`flex-row items-center gap-1 mt-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Text className="text-[10px] text-gray-500">{player.team}</Text>
        {logo && <Image source={{ uri: logo }} className="w-[12px] h-[12px]" resizeMode="contain" />}
      </View>
    </View>
  );

  const photo = (
    <Image
      source={{
        uri: isDef ? (getTeamLogo(player.team) ?? undefined) : `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`,
      }}
      className={isDef ? "w-[34px] h-[34px]" : "w-[38px] h-[38px] rounded-full"}
      resizeMode={isDef ? "contain" : "cover"}
      style={{ backgroundColor: isDef ? "transparent" : getTeamColor(player.team) + "22" }}
    />
  );

  // Actual score is the headline; the projection rides underneath in
  // smaller, muted text so an unplayed slot reads as "-" over its proj.
  const scoreBlock = (
    <View className="w-[46px]" style={{ alignItems: align === "left" ? "flex-end" : "flex-start" }}>
      <Text
        numberOfLines={1}
        style={{ fontVariant: ["tabular-nums"] }}
        className="text-[14px] font-bold text-black dark:text-white"
      >
        {hasScored ? player.points : "-"}
      </Text>
      {player.proj !== undefined && (
        <Text numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }} className="text-[10px] text-gray-500">
          {player.proj}
        </Text>
      )}
    </View>
  );

  if (align === "left") {
    return (
      <View className="flex-1 flex-row items-center gap-2">
        {photo}
        {info}
        <View style={{ marginLeft: "auto" }}>{scoreBlock}</View>
      </View>
    );
  }
  return (
    <View className="flex-1 flex-row items-center justify-end gap-2">
      <View style={{ marginRight: "auto" }}>{scoreBlock}</View>
      {info}
      {photo}
    </View>
  );
}

function MatchupRow({ left, right, slot, dimmed }: { left?: Starter; right?: Starter; slot?: string; dimmed?: boolean }) {
  const badgeLabel = slot ? slotLabel(slot) : (left?.pos ?? right?.pos ?? "");
  const badgeColor = POSITION_COLOR[badgeLabel] ?? POSITION_COLOR[left?.pos ?? right?.pos ?? ""] ?? "#9ca3af";

  return (
    <View className={`flex-row items-center py-2.5 border-b border-gray-100 dark:border-white/5 ${dimmed ? "opacity-70" : ""}`}>
      <PlayerHalf player={left} align="left" />
      {badgeLabel ? (
        <View style={{ backgroundColor: badgeColor }} className="rounded px-1.5 py-0.5 mx-2 min-w-[34px] items-center">
          <Text className="text-white text-[9px] font-bold">{badgeLabel}</Text>
        </View>
      ) : (
        <View className="mx-2 w-[34px]" />
      )}
      <PlayerHalf player={right} align="right" />
    </View>
  );
}
