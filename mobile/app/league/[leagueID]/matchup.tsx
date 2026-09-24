import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import getMatchupData, { ScheduleData, Starter } from "../../../lib/getMatchupData";
import { getTopPerformers, TopPerformer, displayName } from "../../../lib/getTopPerformers";
import {
  getLiveGameDetailsByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
  NflTeamGameState,
  LiveGameDetail,
} from "../../../lib/nflGameStatus";
import { getWeeklyPlayerStats, formatBoxScoreLine, RawPlayerStats } from "../../../lib/playerBoxScore";
import { formatGameKickoff } from "../../../lib/formatTime";
import SchedulePoll from "../../../components/SchedulePoll";
import MatchupPredictorRing from "../../../components/MatchupPredictorRing";
import { getTeamColor, getTeamLogo } from "../../../lib/nflTeams";
import { usePlayerDetail } from "../../../components/PlayerDetailProvider";
import AnimatedNumber from "../../../components/AnimatedNumber";
import BigPlayToast from "../../../components/BigPlayToast";
import MatchupFeed from "../../../components/MatchupFeed";
import CommentsSection from "../../../components/CommentsSection";
import useBigPlayFeed from "../../../lib/useBigPlayFeed";
import { ensureMatchupRecapPosted } from "../../../lib/ensureMatchupRecap";
import { ensureInjuryPostsForMatchup } from "../../../lib/ensureInjuryPost";

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
  const [liveGameDetailsByTeam, setLiveGameDetailsByTeam] = useState<Record<string, LiveGameDetail>>({});
  const [weeklyPlayerStats, setWeeklyPlayerStats] = useState<Record<string, RawPlayerStats>>({});
  /** roster_id -> season average points per game, straight off each roster's own settings - cheap (rosters are already cached in lib/api.ts) and the same "how do these two normally score" context the screenshot-style matchup preview shows. */
  const [avgFptsByRoster, setAvgFptsByRoster] = useState<Record<string, number>>({});
  const nflGameStatusByTeam: Record<string, NflTeamGameState> = useMemo(
    () => Object.fromEntries(Object.entries(liveGameDetailsByTeam).map(([abbr, detail]) => [abbr, detail.state])),
    [liveGameDetailsByTeam]
  );

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

        getLiveGameDetailsByTeam(week, nflState.season)
          .then((details) => {
            if (!cancelled) setLiveGameDetailsByTeam(details);
          })
          .catch((error) => console.error("Error fetching NFL game status:", error));
        getWeeklyPlayerStats(nflState.season, week)
          .then((stats) => {
            if (!cancelled) setWeeklyPlayerStats(stats);
          })
          .catch((error) => console.error("Error fetching weekly player stats:", error));
        sleeper
          .getLeagueRosters(leagueID)
          .then(({ data: rosters }) => {
            if (cancelled) return;
            const map: Record<string, number> = {};
            for (const r of rosters as any[]) {
              const games = (r.settings?.wins ?? 0) + (r.settings?.losses ?? 0) + (r.settings?.ties ?? 0);
              if (games === 0) continue;
              const totalPts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
              map[String(r.roster_id)] = totalPts / games;
            }
            setAvgFptsByRoster(map);
          })
          .catch((error) => console.error("Error fetching roster averages:", error));
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

  // Announce the final score into the feed the first time anyone views this
  // matchup after it goes final - ensureSystemPost is a no-op if it's
  // already been posted, so it's safe to let this re-check on every render
  // where the game state could have just flipped to final. Declared before
  // the early returns below (rules-of-hooks), so it recomputes final-ness
  // itself from state rather than reusing the derived consts further down.
  useEffect(() => {
    if (loading || !team1 || !team2 || !leagueID || !matchupID || !season) return;
    const rosterFullySet = (s: Starter[]) => s.length > 0 && s.every((x) => x && Object.keys(x).length > 0);
    const s1 = team1.starters_full_data ?? [];
    const s2 = team2.starters_full_data ?? [];
    const state1 = computeFantasyTeamGameState(s1.map((s) => s.team), nflGameStatusByTeam, rosterFullySet(s1));
    const state2 = computeFantasyTeamGameState(s2.map((s) => s.team), nflGameStatusByTeam, rosterFullySet(s2));
    const isFinal = combineMatchupGameState(state1, state2, isPastMondayNightCutoff()) === "final";
    if (!isFinal) return;

    let cancelled = false;
    ensureMatchupRecapPosted({
      leagueId: leagueID,
      week,
      season,
      matchupId: matchupID,
      team1: {
        name: team1.name,
        points: parseFloat(team1.team_points || "0"),
        avatar: typeof team1.avatar === "string" ? team1.avatar : undefined,
        starters: s1,
      },
      team2: {
        name: team2.name,
        points: parseFloat(team2.team_points || "0"),
        avatar: typeof team2.avatar === "string" ? team2.avatar : undefined,
        starters: s2,
      },
      playersData: playersDataForFeed,
      scoringSettings,
    }).catch((error) => {
      if (!cancelled) console.error("Error posting final score to feed:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [loading, team1, team2, leagueID, matchupID, week, season, scoringSettings, playersDataForFeed, nflGameStatusByTeam]);

  // The initial load above only ever fetches once - real scores keep
  // moving every few seconds while these players' games are live, so
  // without this the screen would only ever show a stale snapshot from
  // whenever it was opened, until someone backed out and back in. Refetches
  // just the live-moving pieces (matchup points, live game details) on a
  // short interval - not the whole heavy initial load (league settings,
  // roster averages, top performers) - and stops entirely once the
  // matchup's actually final, since there's nothing left to move.
  useEffect(() => {
    if (!leagueID || !matchupID || !week || loading || !season || !team1 || !team2) return;
    const s1 = team1.starters_full_data ?? [];
    const s2 = team2.starters_full_data ?? [];
    const rosterFullySet = (s: Starter[]) => s.length > 0 && s.every((x) => x && Object.keys(x).length > 0);
    const state1 = computeFantasyTeamGameState(s1.map((s) => s.team), nflGameStatusByTeam, rosterFullySet(s1));
    const state2 = computeFantasyTeamGameState(s2.map((s) => s.team), nflGameStatusByTeam, rosterFullySet(s2));
    if (combineMatchupGameState(state1, state2, isPastMondayNightCutoff()) === "final") return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const [{ updatedScheduleData }, details] = await Promise.all([
          getMatchupData(leagueID, week),
          getLiveGameDetailsByTeam(week, season),
        ]);
        if (cancelled) return;
        setScheduleData((prev) => ({ ...prev, ...updatedScheduleData }));
        setLiveGameDetailsByTeam(details);
      } catch (error) {
        console.error("Error refreshing live matchup score:", error);
      }

      // Same cadence, riding the same tick - Boogie's live injury wire for
      // this matchup. ensureInjuryPostsForMatchup is self-deduping (each
      // post's id comes from the play itself), so it's fine to just re-run
      // this every tick rather than diffing anything here.
      ensureInjuryPostsForMatchup({
        leagueId: leagueID,
        week,
        season,
        matchupId: matchupID,
        team1: { name: team1.name, starters: s1, record: { wins: parseInt(team1.wins || "0"), losses: parseInt(team1.losses || "0") } },
        team2: { name: team2.name, starters: s2, record: { wins: parseInt(team2.wins || "0"), losses: parseInt(team2.losses || "0") } },
        playersData: playersDataForFeed,
        scoringSettings,
      }).catch((error) => console.error("Error posting injury updates to feed:", error));
    };

    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leagueID, matchupID, week, loading, season, team1, team2, nflGameStatusByTeam, playersDataForFeed, scoringSettings]);

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

  const starters1 = team1.starters_full_data ?? [];
  const starters2 = team2.starters_full_data ?? [];

  // Live/final by each starter's real NFL game status, not by whether their
  // fantasy points happen to be 0 yet - a player can finish a game with a
  // genuine 0, which the old points-based check couldn't tell apart from
  // "hasn't played". A lineup with any empty slot never counts as final.
  const rosterFullySet = (slots: Starter[]) =>
    slots.length > 0 && slots.every((s) => s && Object.keys(s).length > 0);
  const team1GameState = computeFantasyTeamGameState(
    starters1.map((s) => s.team),
    nflGameStatusByTeam,
    rosterFullySet(starters1)
  );
  const team2GameState = computeFantasyTeamGameState(
    starters2.map((s) => s.team),
    nflGameStatusByTeam,
    rosterFullySet(starters2)
  );
  const matchupGameState = combineMatchupGameState(
    team1GameState,
    team2GameState,
    isPastMondayNightCutoff()
  );
  const preGame = matchupGameState === "pre";
  const liveGame = matchupGameState === "live";
  const postGame = matchupGameState === "final";
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
          <TeamHeader name={team1.name} avatar={team1.avatar} userId={team1Id ?? undefined} record={total1} />
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
                    className={`text-[26px] font-bold ${
                      liveGame || (postGame && team1Points >= team2Points) ? "text-white" : "text-gray-500"
                    }`}
                  />
                  <Text className="text-gray-600 text-[16px]">-</Text>
                  <AnimatedNumber
                    value={team2Points}
                    decimals={1}
                    style={{ fontVariant: ["tabular-nums"] }}
                    className={`text-[26px] font-bold ${
                      liveGame || (postGame && team2Points >= team1Points) ? "text-white" : "text-gray-500"
                    }`}
                  />
                </View>
              </>
            )}
          </View>
          <TeamHeader name={team2.name} avatar={team2.avatar} userId={team2Id ?? undefined} record={total2} align="right" />
        </View>

        {/* Season average points per game for each team - how they
            normally score, not a live number, so it's shown regardless of
            whether the game's started yet. */}
        {(team1.roster_id !== undefined && avgFptsByRoster[team1.roster_id] !== undefined) ||
        (team2.roster_id !== undefined && avgFptsByRoster[team2.roster_id] !== undefined) ? (
          <View className="flex-row items-center justify-center gap-3 mt-3">
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[12px] font-bold text-gray-300">
              {team1.roster_id !== undefined ? (avgFptsByRoster[team1.roster_id] ?? 0).toFixed(1) : "-"}
            </Text>
            <Text className="text-[9px] font-bold tracking-widest text-gray-500">AVG FPTS</Text>
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-[12px] font-bold text-gray-300">
              {team2.roster_id !== undefined ? (avgFptsByRoster[team2.roster_id] ?? 0).toFixed(1) : "-"}
            </Text>
          </View>
        ) : null}

        <View className="items-center mt-3">
          <BigPlayToast play={matchupLatestPlay} />
        </View>

        {/* Feed sits right up top with the score, not buried below the
            rosters - it's about this game happening right now. */}
        <View className="mt-4">
          <Pressable
            onPress={() => setFeedOpen((open) => !open)}
            className="flex-row items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-3.5 py-3"
          >
            <View className="flex-row items-center gap-2">
              <View className="w-6 h-6 rounded-full bg-brand/20 items-center justify-center">
                <Feather name="activity" size={13} color="#e2465a" />
              </View>
              <Text className="text-[13px] font-bold text-white">Feed</Text>
              {!feedOpen && matchupLatestPlay && (
                <View className="w-[6px] h-[6px] rounded-full bg-[#22c55e]" />
              )}
            </View>
            <Feather name={feedOpen ? "chevron-up" : "chevron-down"} size={16} color="#9ca3af" />
          </Pressable>
          {feedOpen && season && (
            <View className="mt-2.5">
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
                forceDark
              />
            </View>
          )}
        </View>

        {/* Matchup Predictor - a win-probability projection only means
            anything before the game's actually being decided by real
            points; once either team has kicked off, the two teams'
            starters are worth what they've actually scored, not what a
            preseason-style projection guessed. */}
        {preGame && (proj1 > 0 || proj2 > 0) && (
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
            <MatchupRow
              key={i}
              left={starters1[i]}
              right={starters2[i]}
              slot={slots[i]}
              liveGameDetailsByTeam={liveGameDetailsByTeam}
              weeklyPlayerStats={weeklyPlayerStats}
            />
          ))}
        </View>

        {benchRowCount > 0 && (
          <>
            <View className="mt-4">
              <SectionHeader title="Bench" />
            </View>
            <View className="px-3">
              {Array.from({ length: benchRowCount }, (_, i) => (
                <MatchupRow
                  key={i}
                  left={bench1[i]}
                  right={bench2[i]}
                  dimmed
                  liveGameDetailsByTeam={liveGameDetailsByTeam}
                  weeklyPlayerStats={weeklyPlayerStats}
                />
              ))}
            </View>
          </>
        )}
      </View>

      {/* CommentsSection is styled dark-only (matches the Feed screen and
          everywhere else comments/posts appear), so it's wrapped in its
          own dark background rather than inheriting this page's
          light/dark-adaptive one. */}
      <View className="bg-[#0c0c0e] pt-4 pb-8">
        <CommentsSection
          targetType="matchup"
          targetId={`${week}:${matchupID}`}
          leagueId={leagueID}
          targetLabel={`${team1.name} vs ${team2.name} - Week ${week}`}
        />
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
  userId,
  record,
  align = "left",
}: {
  name: string;
  avatar: any;
  userId?: string;
  record: string;
  align?: "left" | "right";
}) {
  const router = useRouter();
  return (
    <Pressable
      disabled={!userId}
      onPress={() => userId && router.push(`/profile/manager/${userId}`)}
      className="items-center flex-1"
    >
      <Image
        source={typeof avatar === "string" ? { uri: avatar } : avatar}
        className="w-[52px] h-[52px] rounded-full mb-1.5"
      />
      <Text numberOfLines={1} className="text-white text-[12px] font-bold text-center px-1">
        {name}
      </Text>
      <Text className="text-gray-400 text-[10px] mt-0.5">{record}</Text>
    </Pressable>
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

interface PlayerDetailContent {
  isLive: boolean;
  resultLine: string;
  boxScoreLine: string | null;
  showFieldBar: boolean;
  yardLine: number;
}

// Precomputed once per player so MatchupRow can decide whether the whole
// detail row is worth rendering at all (nothing to show pre-kickoff)
// before PlayerDetail renders its half of it.
function getPlayerDetailContent(
  player: Starter | undefined,
  liveGameDetailsByTeam: Record<string, LiveGameDetail>,
  weeklyPlayerStats: Record<string, RawPlayerStats>
): PlayerDetailContent | null {
  if (!player || !player.team) return null;
  const detail = liveGameDetailsByTeam[player.team];
  if (!detail) return null;

  const opp = detail.opponentAbbr ?? "";
  const vsAt = detail.isHome ? "vs" : "@";

  // Pre-kickoff, there's no live/final result to report yet - the useful
  // thing to show instead is when this player's own game actually kicks
  // off and who it's against, same as the day/time/opponent line real
  // matchup previews show per player.
  if (detail.state === "pre") {
    const resultLine = detail.kickoff ? `${formatGameKickoff(detail.kickoff)} ${vsAt} ${opp}` : `${vsAt} ${opp}`;
    return { isLive: false, resultLine, boxScoreLine: null, showFieldBar: false, yardLine: 0 };
  }

  const isLive = detail.state === "in";
  const resultLine = isLive
    ? `Q${detail.period} ${detail.displayClock} ${detail.teamScore}-${detail.opponentScore} ${vsAt} ${opp}`
    : `${detail.teamScore > detail.opponentScore ? "W" : detail.teamScore < detail.opponentScore ? "L" : "T"} ${detail.teamScore}-${detail.opponentScore} ${vsAt} ${opp}`;

  const stats = player.id ? weeklyPlayerStats[player.id] : undefined;
  const boxScoreLine = formatBoxScoreLine(player.pos, stats);
  const showFieldBar = isLive && detail.hasPossession && detail.yardLine !== undefined;

  return { isLive, resultLine, boxScoreLine, showFieldBar, yardLine: detail.yardLine ?? 0 };
}

function FieldPositionBar({ yardLine }: { yardLine: number }) {
  const pct = Math.min(100, Math.max(0, yardLine));
  return (
    <View className="w-full mt-1.5">
      <View className="h-[5px] rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <View style={{ width: `${pct}%` }} className="h-full bg-brand rounded-full" />
      </View>
      <Text className="text-[8px] font-bold tracking-wide text-gray-400 dark:text-gray-600 mt-0.5 text-right">
        END ZONE
      </Text>
    </View>
  );
}

function PlayerDetail({ content, align }: { content: PlayerDetailContent | null; align: "left" | "right" }) {
  if (!content) return <View className="flex-1" />;
  return (
    <View className={`flex-1 ${align === "right" ? "items-end" : "items-start"}`}>
      <View className={`flex-row items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {content.isLive && <View className="w-[5px] h-[5px] rounded-full bg-brand" />}
        <Text
          numberOfLines={1}
          style={{ color: content.isLive ? "#e2465a" : "#6b7280" }}
          className="text-[10px] font-semibold"
        >
          {content.resultLine}
        </Text>
      </View>
      {content.showFieldBar && <FieldPositionBar yardLine={content.yardLine} />}
      {content.boxScoreLine && (
        <Text
          numberOfLines={2}
          className={`text-[10px] text-gray-500 mt-0.5 ${align === "right" ? "text-right" : "text-left"}`}
        >
          {content.boxScoreLine}
        </Text>
      )}
    </View>
  );
}

function PlayerHalf({ player, align }: { player?: Starter; align: "left" | "right" }) {
  const playerDetail = usePlayerDetail();
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

  const openDetail = () => playerDetail?.openPlayer({ playerId: player.id, name: displayName(player), position: player.pos ?? "", team: player.team });

  if (align === "left") {
    return (
      <View className="flex-1 flex-row items-center gap-2">
        <Pressable className="flex-row items-center gap-2 flex-1" onPress={openDetail}>
          {photo}
          {info}
        </Pressable>
        <View style={{ marginLeft: "auto" }}>{scoreBlock}</View>
      </View>
    );
  }
  return (
    <View className="flex-1 flex-row items-center justify-end gap-2">
      <View style={{ marginRight: "auto" }}>{scoreBlock}</View>
      <Pressable className="flex-row items-center justify-end gap-2 flex-1" onPress={openDetail}>
        {info}
        {photo}
      </Pressable>
    </View>
  );
}

function MatchupRow({
  left,
  right,
  slot,
  dimmed,
  liveGameDetailsByTeam,
  weeklyPlayerStats,
}: {
  left?: Starter;
  right?: Starter;
  slot?: string;
  dimmed?: boolean;
  liveGameDetailsByTeam: Record<string, LiveGameDetail>;
  weeklyPlayerStats: Record<string, RawPlayerStats>;
}) {
  const badgeLabel = slot ? slotLabel(slot) : (left?.pos ?? right?.pos ?? "");
  const badgeColor = POSITION_COLOR[badgeLabel] ?? POSITION_COLOR[left?.pos ?? right?.pos ?? ""] ?? "#9ca3af";

  const leftContent = getPlayerDetailContent(left, liveGameDetailsByTeam, weeklyPlayerStats);
  const rightContent = getPlayerDetailContent(right, liveGameDetailsByTeam, weeklyPlayerStats);
  const rowIsLive = !!leftContent?.isLive || !!rightContent?.isLive;

  return (
    <View
      className={
        rowIsLive
          ? `my-1 px-2 py-2.5 rounded-2xl bg-brand/15 border border-brand/30 ${dimmed ? "opacity-70" : ""}`
          : `py-2.5 border-b border-gray-100 dark:border-white/5 ${dimmed ? "opacity-70" : ""}`
      }
    >
      <View className="flex-row items-center">
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

      {(leftContent || rightContent) && (
        <View className="flex-row items-start mt-1.5">
          <PlayerDetail content={leftContent} align="left" />
          <View className="mx-2 w-[34px]" />
          <PlayerDetail content={rightContent} align="right" />
        </View>
      )}
    </View>
  );
}
