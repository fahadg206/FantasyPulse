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
import { getWeeklyPlayerStats, RawPlayerStats } from "../../../lib/playerBoxScore";
import SchedulePoll from "../../../components/SchedulePoll";
import MatchupPredictorRing from "../../../components/MatchupPredictorRing";
import { getTeamLogo } from "../../../lib/nflTeams";
import AnimatedNumber from "../../../components/AnimatedNumber";
import BigPlayToast from "../../../components/BigPlayToast";
import MatchupFeed from "../../../components/MatchupFeed";
import CommentsSection from "../../../components/CommentsSection";
import useBigPlayFeed from "../../../lib/useBigPlayFeed";
import { ensureMatchupRecapPosted } from "../../../lib/ensureMatchupRecap";
import { ensureInjuryPostsForMatchup } from "../../../lib/ensureInjuryPost";
import MatchupPlayerGrid from "../../../components/MatchupPlayerGrid";

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

      <View className="pb-8">
        <MatchupPlayerGrid
          starters1={starters1}
          starters2={starters2}
          bench1={bench1}
          bench2={bench2}
          slots={slots}
          week={week}
          liveGameDetailsByTeam={liveGameDetailsByTeam}
          weeklyPlayerStats={weeklyPlayerStats}
        />
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
