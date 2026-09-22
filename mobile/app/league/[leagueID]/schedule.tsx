import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, ImageSourcePropType } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { MotiView } from "moti";
import { sleeper, backend } from "../../../lib/api";
import getMatchupData, { MatchupMapData, ScheduleData } from "../../../lib/getMatchupData";
import { getSeasonTotals, getTopNForTeam, SeasonTotals, TopPerformer } from "../../../lib/getTopPerformers";
import { getTeamLogo } from "../../../lib/nflTeams";
import AnimatedNumber from "../../../components/AnimatedNumber";
import {
  getNflGameStatusByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
  NflTeamGameState,
} from "../../../lib/nflGameStatus";

type MatchupEntry = [string, MatchupMapData[]];
type GameStatus = "live" | "upcoming" | "final";

const STATUS_META: Record<GameStatus, { label: string; color: string }> = {
  live: { label: "LIVE NOW", color: "#dc2626" },
  upcoming: { label: "UPCOMING", color: "#9ca3af" },
  final: { label: "FINAL", color: "#6b7280" },
};

function LiveDot() {
  return (
    <MotiView
      from={{ opacity: 1 }}
      animate={{ opacity: 0.2 }}
      transition={{ type: "timing", duration: 650, loop: true }}
      className="w-[5px] h-[5px] rounded-full bg-[#dc2626] mr-1.5"
    />
  );
}

function StatusBadge({ status }: { status: GameStatus }) {
  const meta = STATUS_META[status];
  if (status === "live") {
    return (
      <View className="flex-row items-center bg-[#dc2626]/15 border border-[#dc2626]/40 rounded-full px-2 py-0.5">
        <LiveDot />
        <Text className="text-[9px] font-bold text-[#dc2626] tracking-wide">LIVE</Text>
      </View>
    );
  }
  return (
    <View className="bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
      <Text style={{ color: meta.color }} className="text-[9px] font-bold tracking-wide">
        {status === "final" ? "FINAL" : "UPCOMING"}
      </Text>
    </View>
  );
}

export default function Schedule() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const [counter, setCounter] = useState(1);
  const [displayWeek, setDisplayWeek] = useState<number>();
  const [matchups, setMatchups] = useState<MatchupEntry[]>([]);
  const [scheduleData, setScheduleData] = useState<ScheduleData>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [playersData, setPlayersData] = useState<any>(null);
  const [seasonTotals, setSeasonTotals] = useState<SeasonTotals>({});
  const [season, setSeason] = useState<string>();
  const [nflGameStatusByTeam, setNflGameStatusByTeam] = useState<Record<string, NflTeamGameState>>({});

  useEffect(() => {
    if (!leagueID) return;
    backend.fetchPlayers(leagueID).then(setPlayersData).catch(console.error);
  }, [leagueID]);

  // Season totals only depend on how many weeks have been completed - not
  // on which week the user is currently browsing - so this is fetched once
  // per league visit rather than every time the week counter changes.
  useEffect(() => {
    if (!leagueID || displayWeek === undefined) return;
    getSeasonTotals(leagueID, Math.max(0, displayWeek - 1))
      .then(setSeasonTotals)
      .catch((e) => console.error("Error fetching season totals:", e));
  }, [leagueID, displayWeek]);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const { data: nflState } = await sleeper.getNflState();
        if (cancelled) return;

        let week = counter;
        if (!initialized) {
          week = nflState.display_week || 1;
          setCounter(week);
          setInitialized(true);
        }
        setDisplayWeek(nflState.display_week);
        setSeason(nflState.season);

        const { matchupMap, updatedScheduleData } = await getMatchupData(leagueID, week, playersData);
        if (cancelled) return;

        setMatchups(Array.from(matchupMap.entries()));
        setScheduleData(updatedScheduleData);

        getNflGameStatusByTeam(week, nflState.season)
          .then((statusByTeam) => {
            if (!cancelled) setNflGameStatusByTeam(statusByTeam);
          })
          .catch((error) => console.error("Error fetching NFL game status:", error));
      } catch (error) {
        console.error("Error fetching matchup data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID, counter]);

  if (!leagueID) return null;

  const changeWeek = (delta: number) => {
    setCounter((c) => Math.min(14, Math.max(1, c + delta)));
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" size="large" />
        <Text className="mt-2 text-gray-400">Loading Schedule…</Text>
      </View>
    );
  }

  const games = matchups
    .map(([matchupID, teams]) => {
      const [team1, team2] = teams;
      if (!team1 || !team2) return null;

      const team1Points = parseFloat(team1.team_points || "0");
      const team2Points = parseFloat(team2.team_points || "0");

      // Live/final by each starter's real NFL game status, not by whether
      // their fantasy points happen to be 0 yet - a player can finish a
      // game with a genuine 0, which the old points-based check couldn't
      // tell apart from "hasn't played". A lineup with any empty slot
      // never counts as final.
      const starters1Full = scheduleData[team1.user_id ?? ""]?.starters_full_data ?? [];
      const starters2Full = scheduleData[team2.user_id ?? ""]?.starters_full_data ?? [];
      const rosterFullySet = (slots: typeof starters1Full) =>
        slots.length > 0 && slots.every((s) => s && Object.keys(s).length > 0);
      const team1GameState = computeFantasyTeamGameState(
        starters1Full.map((s) => s.team),
        nflGameStatusByTeam,
        rosterFullySet(starters1Full)
      );
      const team2GameState = computeFantasyTeamGameState(
        starters2Full.map((s) => s.team),
        nflGameStatusByTeam,
        rosterFullySet(starters2Full)
      );
      const matchupGameState = combineMatchupGameState(
        team1GameState,
        team2GameState,
        isPastMondayNightCutoff()
      );
      const preGame = matchupGameState === "pre";
      const liveGame = matchupGameState === "live";
      const postGame = matchupGameState === "final";
      const status: GameStatus = liveGame ? "live" : postGame ? "final" : "upcoming";

      const team1Leading = postGame && team1Points >= team2Points;
      const team2Leading = postGame && team2Points >= team1Points;

      const team1Full = scheduleData[team1.user_id ?? ""];
      const team2Full = scheduleData[team2.user_id ?? ""];
      const team1Top2 =
        team1Full?.roster_id && displayWeek !== undefined
          ? getTopNForTeam(seasonTotals, team1Full.roster_id, team1Full.starters_full_data ?? [], playersData, displayWeek, 2)
          : [];
      const team2Top2 =
        team2Full?.roster_id && displayWeek !== undefined
          ? getTopNForTeam(seasonTotals, team2Full.roster_id, team2Full.starters_full_data ?? [], playersData, displayWeek, 2)
          : [];

      return { matchupID, team1, team2, preGame, status, team1Leading, team2Leading, team1Top2, team2Top2 };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const sections: { status: GameStatus; games: typeof games }[] = (["live", "upcoming", "final"] as const)
    .map((status) => ({ status, games: games.filter((g) => g.status === status) }))
    .filter((s) => s.games.length > 0);

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-5 pb-4 border-b border-white/10">
        <Text className="text-[11px] font-bold tracking-widest text-brand">SCHEDULE</Text>
        <View className="flex-row items-center justify-between mt-0.5">
          <Text className="text-white text-[21px] font-bold">Week {counter}</Text>
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => changeWeek(-1)}
              hitSlop={10}
              className="w-[32px] h-[32px] rounded-full bg-white/5 border border-white/10 items-center justify-center"
            >
              <Feather name="chevron-left" size={16} color="#e2465a" />
            </Pressable>
            <Pressable
              onPress={() => changeWeek(1)}
              hitSlop={10}
              className="w-[32px] h-[32px] rounded-full bg-white/5 border border-white/10 items-center justify-center"
            >
              <Feather name="chevron-right" size={16} color="#e2465a" />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView contentContainerClassName="px-4 py-4">
        {sections.map((section) => (
          <View key={section.status} className="mb-2">
            <View className="flex-row items-center gap-2 mb-2.5">
              <Text className="text-[11px] font-bold tracking-wider text-gray-500">
                {STATUS_META[section.status].label}
              </Text>
              <View className="flex-1 h-px bg-white/10" />
            </View>

            {section.games.map(({ matchupID, team1, team2, preGame, status, team1Leading, team2Leading, team1Top2, team2Top2 }) => (
              <Pressable
                key={matchupID}
                onPress={() =>
                  router.push({
                    pathname: "/league/[leagueID]/matchup",
                    params: { leagueID, week: String(counter), matchupID },
                  } as any)
                }
                className="bg-[#141416] rounded-2xl border border-white/10 mb-3 overflow-hidden"
              >
                <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
                  <StatusBadge status={status} />
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] font-semibold text-brand">Matchup</Text>
                    <Feather name="chevron-right" size={12} color="#af1222" />
                  </View>
                </View>

                <View className="px-4 pt-1 pb-3.5">
                  <ScheduleTeamRow
                    name={team1.name}
                    avatar={team1.avatar}
                    points={team1.team_points}
                    showScore={!preGame}
                    emphasize={team1Leading}
                    performers={team1Top2}
                  />
                  <View className="h-px bg-white/10 my-2.5" />
                  <ScheduleTeamRow
                    name={team2.name}
                    avatar={team2.avatar}
                    points={team2.team_points}
                    showScore={!preGame}
                    emphasize={team2Leading}
                    performers={team2Top2}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function PerformerLine({ performer }: { performer: TopPerformer }) {
  const isDef = performer.pos === "DEF";
  const photoUri = isDef
    ? (getTeamLogo(performer.team) ?? undefined)
    : `https://sleepercdn.com/content/nfl/players/thumb/${performer.playerId}.jpg`;

  return (
    <View className="flex-row items-center justify-end gap-1 mt-1">
      <Text numberOfLines={1} className="text-[10px] text-gray-500 max-w-[80px]">
        {performer.name}
      </Text>
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[10px] font-bold text-[#e2465a]">
        {performer.ppg.toFixed(1)}
      </Text>
      <Image
        source={photoUri ? { uri: photoUri } : undefined}
        resizeMode={isDef ? "contain" : "cover"}
        className={isDef ? "w-[16px] h-[16px]" : "w-[16px] h-[16px] rounded-full bg-white/10"}
      />
    </View>
  );
}

function ScheduleTeamRow({
  name,
  avatar,
  points,
  showScore,
  emphasize,
  performers,
}: {
  name: string;
  avatar?: string | ImageSourcePropType;
  points?: string;
  showScore: boolean;
  emphasize: boolean;
  performers: TopPerformer[];
}) {
  return (
    <View className="flex-row items-start justify-between">
      <View className="flex-row items-center flex-1 mr-2 pt-0.5">
        <Image
          source={typeof avatar === "string" ? { uri: avatar } : avatar}
          className="w-[36px] h-[36px] rounded-full mr-2.5 bg-white/10"
        />
        <Text
          numberOfLines={1}
          className={`text-[14px] flex-1 ${emphasize ? "font-bold text-white" : "font-medium text-gray-500"}`}
        >
          {name}
        </Text>
      </View>
      <View className="items-end">
        {showScore ? (
          <AnimatedNumber
            value={parseFloat(points || "0")}
            decimals={1}
            style={{ fontVariant: ["tabular-nums"] }}
            className={`text-[19px] ${emphasize ? "font-bold text-white" : "font-semibold text-gray-500"}`}
          />
        ) : (
          <Text className="text-[12px] text-gray-500">--</Text>
        )}
        {performers.map((p, i) => (
          <PerformerLine key={i} performer={p} />
        ))}
      </View>
    </View>
  );
}
