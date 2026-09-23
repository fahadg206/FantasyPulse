import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, ImageSourcePropType } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { MotiView } from "moti";
import { sleeper, backend } from "../../../lib/api";
import getMatchupData, { MatchupMapData, ScheduleData } from "../../../lib/getMatchupData";
import { getTopNCurrentForTeam, TopPerformer } from "../../../lib/getTopPerformers";
import { getTeamLogo } from "../../../lib/nflTeams";
import { ensureMatchupRecapPosted } from "../../../lib/ensureMatchupRecap";
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
/** Pre-game favorite callout: team name on its own line, spread on the line below - `name` is undefined for a PICK'EM (no favorite). */
type FavoriteLine = { name?: string; spread: string };

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
  const [matchups, setMatchups] = useState<MatchupEntry[]>([]);
  const [scheduleData, setScheduleData] = useState<ScheduleData>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [playersData, setPlayersData] = useState<any>(null);
  const [season, setSeason] = useState<string>();
  const [nflGameStatusByTeam, setNflGameStatusByTeam] = useState<Record<string, NflTeamGameState>>({});
  const [scoringSettings, setScoringSettings] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!leagueID) return;
    sleeper
      .getLeague(leagueID)
      .then(({ data }) => setScoringSettings(data.scoring_settings || {}))
      .catch((error) => console.error("Error fetching league scoring settings:", error));
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID) return;
    backend.fetchPlayers(leagueID).then(setPlayersData).catch(console.error);
  }, [leagueID]);

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

  // Posts each final matchup's recap into the feed the first time this
  // week's Schedule is actually looked at - not just whichever single
  // matchup someone happens to click into (the Matchup detail screen's own
  // version of this same check). Schedule shows the whole week at once and
  // is what people actually open, so this is what makes recaps reliably
  // show up without depending on someone drilling into every individual
  // final game. ensureMatchupRecapPosted is a no-op for a matchup that
  // already has one, so this is safe to re-run on every relevant state
  // change without risking a duplicate post.
  useEffect(() => {
    if (!leagueID || !season || !playersData || matchups.length === 0) return;
    let cancelled = false;

    for (const [, teams] of matchups) {
      const [team1, team2] = teams;
      if (!team1 || !team2) continue;

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
      const isFinal =
        combineMatchupGameState(team1GameState, team2GameState, isPastMondayNightCutoff()) === "final";
      if (!isFinal) continue;

      ensureMatchupRecapPosted({
        leagueId: leagueID,
        week: counter,
        season,
        matchupId: team1.matchup_id ?? "",
        team1: {
          name: team1.name,
          points: parseFloat(team1.team_points || "0"),
          avatar: typeof team1.avatar === "string" ? team1.avatar : undefined,
          starters: starters1Full,
        },
        team2: {
          name: team2.name,
          points: parseFloat(team2.team_points || "0"),
          avatar: typeof team2.avatar === "string" ? team2.avatar : undefined,
          starters: starters2Full,
        },
        playersData,
        scoringSettings,
      }).catch((error) => {
        if (!cancelled) console.error("Error posting final score to feed:", error);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [leagueID, counter, season, matchups, scheduleData, nflGameStatusByTeam, playersData, scoringSettings]);

  // The loads above only run once per week change, so without this the
  // whole board would sit on a stale snapshot from whenever it was opened
  // until the week counter changes - scores actually move every few
  // seconds while games are live. Refreshes on a short interval while any
  // matchup this week hasn't gone final yet, and stops once every game
  // here has - nothing left to move. Depending on `matchups`/`scheduleData`
  // (which this same refresh updates) means each tick reschedules the next
  // one only after the previous fetch lands, so this can't pile up
  // overlapping requests.
  useEffect(() => {
    if (!leagueID || loading || matchups.length === 0 || !season) return;

    const allFinal = matchups.every(([, teams]) => {
      const [team1, team2] = teams;
      if (!team1 || !team2) return true;
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
      return combineMatchupGameState(team1GameState, team2GameState, isPastMondayNightCutoff()) === "final";
    });
    if (allFinal) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const [{ matchupMap, updatedScheduleData }, statusByTeam] = await Promise.all([
          getMatchupData(leagueID, counter, playersData),
          getNflGameStatusByTeam(counter, season),
        ]);
        if (cancelled) return;
        setMatchups(Array.from(matchupMap.entries()));
        setScheduleData(updatedScheduleData);
        setNflGameStatusByTeam(statusByTeam);
      } catch (error) {
        console.error("Error refreshing live schedule scores:", error);
      }
    };

    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leagueID, counter, loading, matchups, scheduleData, nflGameStatusByTeam, season, playersData]);

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

      // Who's *actually* leading scoring this week, off the real points
      // already on the board - only meaningful once there's a real game in
      // progress or finished, so upcoming games don't compute this at all
      // anymore (that slot shows the spread/O-U instead - see below).
      const team1Top2 = status === "upcoming" ? [] : getTopNCurrentForTeam(starters1Full, 2);
      const team2Top2 = status === "upcoming" ? [] : getTopNCurrentForTeam(starters2Full, 2);

      // Same projected-margin / over-under the Dashboard's Scoreboard card
      // shows for an upcoming game - each side's starters' projections for
      // this week, summed.
      let team1Proj = 0;
      let team2Proj = 0;
      for (const s of starters1Full) {
        const proj = s.proj !== undefined ? parseFloat(s.proj) : undefined;
        if (proj !== undefined && !Number.isNaN(proj)) team1Proj += proj;
      }
      for (const s of starters2Full) {
        const proj = s.proj !== undefined ? parseFloat(s.proj) : undefined;
        if (proj !== undefined && !Number.isNaN(proj)) team2Proj += proj;
      }

      // The spread/O-U info each row shows in place of top performers while
      // the game hasn't started - split one-per-row rather than repeated
      // on both: the top row (team1) shows who's favored and by how much,
      // the bottom row (team2) shows the O-U. undefined (blank slot) on
      // both when there's no projection data at all for this matchup yet.
      const hasProjection = status === "upcoming" && (team1Proj > 0 || team2Proj > 0);
      const tied = Math.round(team1Proj) === Math.round(team2Proj);
      const favoriteName = team1Proj > team2Proj ? team1.name : team2.name;
      const spread = Math.round(Math.abs(team1Proj - team2Proj));
      // Name and spread are separate fields (not one combined string) so
      // the row can put the team name on its own line and the spread on
      // the line below it, rather than crowding both onto one line.
      const favoriteLine: FavoriteLine | undefined = hasProjection
        ? tied
          ? { name: undefined, spread: "PICK'EM" }
          : { name: abbrevName(favoriteName), spread: `-${spread}` }
        : undefined;
      const overUnderLine = hasProjection ? `O/U ${Math.round(team1Proj + team2Proj)}` : undefined;

      return {
        matchupID,
        team1,
        team2,
        preGame,
        status,
        team1Leading,
        team2Leading,
        team1Top2,
        team2Top2,
        favoriteLine,
        overUnderLine,
      };
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

            {section.games.map(({ matchupID, team1, team2, preGame, status, team1Leading, team2Leading, team1Top2, team2Top2, favoriteLine, overUnderLine }) => (
              <Pressable
                key={matchupID}
                onPress={() =>
                  router.push({
                    pathname: "/league/[leagueID]/matchup",
                    params: { leagueID, week: String(counter), matchupID },
                  } as any)
                }
                className="bg-[#141416] rounded-3xl border border-white/10 mb-3.5 overflow-hidden"
              >
                <View className="flex-row items-center justify-between px-4 pt-3.5 pb-1.5">
                  <StatusBadge status={status} />
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] font-semibold text-brand">Matchup</Text>
                    <Feather name="chevron-right" size={12} color="#af1222" />
                  </View>
                </View>

                <View className="px-4 pt-1.5 pb-4">
                  <ScheduleTeamRow
                    name={team1.name}
                    avatar={team1.avatar}
                    points={team1.team_points}
                    showScore={!preGame}
                    emphasize={team1Leading}
                    live={status === "live"}
                    performers={team1Top2}
                    favoriteLine={favoriteLine}
                  />
                  <View className="h-px bg-white/10 my-3.5" />
                  <ScheduleTeamRow
                    name={team2.name}
                    avatar={team2.avatar}
                    points={team2.team_points}
                    showScore={!preGame}
                    emphasize={team2Leading}
                    live={status === "live"}
                    performers={team2Top2}
                    overUnderText={overUnderLine}
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

function abbrevName(name: string) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function PerformerLine({ performer }: { performer: TopPerformer }) {
  const isDef = performer.pos === "DEF";
  const photoUri = isDef
    ? (getTeamLogo(performer.team) ?? undefined)
    : `https://sleepercdn.com/content/nfl/players/thumb/${performer.playerId}.jpg`;

  // Picture, then name, then points - reads left-to-right like "who, then
  // how much" instead of the score-first order it used to be in. Name is
  // flex-1 and points is a fixed-width right-aligned slot so every
  // performer's number lands on the same right edge, both stacked within
  // one team and lined up against the other team's below it - the column
  // this sits in is itself a fixed width (see ScheduleTeamRow), so this
  // isn't just centered within its own content.
  return (
    <View className="flex-row items-center gap-1.5">
      <Image
        source={photoUri ? { uri: photoUri } : undefined}
        resizeMode={isDef ? "contain" : "cover"}
        className={isDef ? "w-[18px] h-[18px]" : "w-[18px] h-[18px] rounded-full bg-white/10"}
      />
      <Text numberOfLines={1} className="text-[11px] text-gray-400 flex-1">
        {performer.name}
      </Text>
      <Text
        style={{ fontVariant: ["tabular-nums"] }}
        className="text-[11px] font-bold text-[#e2465a] w-[28px] text-right"
      >
        {performer.ppg.toFixed(1)}
      </Text>
    </View>
  );
}

function ScheduleTeamRow({
  name,
  avatar,
  points,
  showScore,
  emphasize,
  live,
  performers,
  favoriteLine,
  overUnderText,
}: {
  name: string;
  avatar?: string | ImageSourcePropType;
  points?: string;
  showScore: boolean;
  emphasize: boolean;
  live?: boolean;
  performers: TopPerformer[];
  /** Pre-game only, and mutually exclusive with overUnderText - one row gets the favorite+spread, the other gets the O-U, never both on the same row. */
  favoriteLine?: FavoriteLine;
  overUnderText?: string;
}) {
  // Team names are always white - only the score dims to gray for a
  // final's non-winning side (bold+white still means "the confirmed
  // winner", now also marked with a solid red triangle right before the
  // score, pointing into it). While the game's still going, neither side
  // is declared a winner, but the score is live and worth reading
  // clearly - white, just not bold - instead of the same muted gray a
  // game that hasn't started yet gets.
  const scoreColor = emphasize || live ? "text-white" : "text-gray-500";
  const weight = emphasize ? "font-bold" : live ? "font-semibold" : "font-medium";

  // Two columns: team info + score on the left, a vertical rule, then a
  // fixed-width column on the right showing that team's top performers
  // once the game has real plays on the board, or its projected
  // spread/O-U before kickoff instead. `items-stretch` on the row makes
  // the rule's height track whichever column is taller, so it runs
  // exactly the height of this one team's block and stops right at the
  // horizontal divider between the two teams - not a line that runs the
  // full card.
  //
  // The score and the divider/right column both used to size themselves
  // off their own content, so a team with a wider name or longer
  // performer names pushed everything in ITS row over relative to the
  // other team's row - nothing actually lined up vertically between the
  // two teams. The right column now has a fixed width and is always
  // rendered (even when empty) so both rows in a card reserve identical
  // space, which pins the score's right edge and the divider to the same
  // x position on both rows. The score is the last item in this
  // `justify-between` row, so its right edge sits at that same fixed
  // container edge whether or not the winner triangle is showing next to
  // it - the triangle only ever eats into the score's *left* side.
  return (
    <View className="flex-row items-stretch">
      <View className="flex-1 flex-row items-center justify-between mr-3">
        <View className="flex-row items-center flex-1 mr-3">
          <Image
            source={typeof avatar === "string" ? { uri: avatar } : avatar}
            className="w-[44px] h-[44px] rounded-full mr-3 bg-white/10"
          />
          <Text numberOfLines={1} className={`text-[16px] flex-1 ${weight} text-white`}>
            {name}
          </Text>
        </View>
        <View className="flex-row items-center">
          {emphasize && (
            <View
              style={{
                width: 0,
                height: 0,
                marginRight: 7,
                borderTopWidth: 7,
                borderBottomWidth: 7,
                borderLeftWidth: 11,
                borderTopColor: "transparent",
                borderBottomColor: "transparent",
                borderLeftColor: "#e2465a",
              }}
            />
          )}
          {showScore ? (
            <AnimatedNumber
              value={parseFloat(points || "0")}
              decimals={1}
              style={{ fontVariant: ["tabular-nums"] }}
              className={`text-[23px] ${emphasize ? "font-bold" : "font-semibold"} ${scoreColor}`}
            />
          ) : (
            <Text className="text-[13px] text-gray-500">--</Text>
          )}
        </View>
      </View>
      <View className="w-px bg-white/10 mr-3" />
      <View className="justify-center" style={{ width: 108 }}>
        {favoriteLine ? (
          <View>
            {favoriteLine.name && (
              <Text numberOfLines={1} className="text-center text-[12px] font-semibold text-gray-400">
                {favoriteLine.name}:
              </Text>
            )}
            <Text numberOfLines={1} className="text-center text-[13px] font-bold text-gray-400 mt-2">
              {favoriteLine.spread}
            </Text>
          </View>
        ) : overUnderText ? (
          <Text numberOfLines={1} className="text-right text-[12px] font-semibold text-gray-400">
            {overUnderText}
          </Text>
        ) : (
          <View className="gap-1.5">
            {performers.map((p, i) => (
              <PerformerLine key={i} performer={p} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
