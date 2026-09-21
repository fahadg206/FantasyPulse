import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, FlatList, ActivityIndicator, ImageSourcePropType } from "react-native";
import { useRouter } from "expo-router";
import { MotiView } from "moti";
import { sleeper, backend } from "../lib/api";
import getMatchupData, { MatchupMapData } from "../lib/getMatchupData";
import { syncLeagueStorageFiles } from "../lib/syncLeagueStorage";
import AnimatedNumber from "./AnimatedNumber";
import {
  getNflGameStatusByTeam,
  computeFantasyTeamGameState,
  combineMatchupGameState,
  isPastMondayNightCutoff,
  NflTeamGameState,
} from "../lib/nflGameStatus";

type MatchupEntry = [string, MatchupMapData[]];

function LiveDot() {
  return (
    <MotiView
      from={{ opacity: 1 }}
      animate={{ opacity: 0.2 }}
      transition={{ type: "timing", duration: 650, loop: true }}
      className="w-[5px] h-[5px] rounded-full bg-[#dc2626] mr-1"
    />
  );
}

export default function Scoreboard({ leagueID }: { leagueID: string }) {
  const [matchups, setMatchups] = useState<MatchupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [playersData, setPlayersData] = useState<Record<string, any>>({});
  const [week, setWeek] = useState<number>();
  const [nflGameStatusByTeam, setNflGameStatusByTeam] = useState<Record<string, NflTeamGameState>>({});
  const router = useRouter();

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const nflStateRes = await sleeper.getNflState();
        const nflState = nflStateRes.data;
        const currentWeek =
          nflState.season_type === "regular"
            ? nflState.display_week
            : nflState.season_type === "post"
              ? 18
              : 1;
        if (cancelled) return;
        setWeek(currentWeek);

        const [{ matchupMap }, players] = await Promise.all([
          getMatchupData(leagueID, currentWeek),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;
        setPlayersData(players);
        setMatchups(Array.from(matchupMap.entries()));

        getNflGameStatusByTeam(currentWeek, nflState.season)
          .then((statusByTeam) => {
            if (!cancelled) setNflGameStatusByTeam(statusByTeam);
          })
          .catch((error) => console.error("Error fetching NFL game status:", error));
      } catch (error) {
        console.error("Error fetching scoreboard data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  // Keeps the Firebase Storage files that fetchHeadlines/fetchPreview/
  // fetchPlayoffPredictions depend on up to date - see syncLeagueStorage.ts
  // for why this is needed. Fire-and-forget: it shouldn't block or affect
  // the scoreboard's own loading state, and addContentIfDifferent already
  // skips the network write when nothing has changed.
  useEffect(() => {
    if (!leagueID) return;
    syncLeagueStorageFiles(leagueID);
  }, [leagueID]);

  if (loading) {
    return (
      <View className="h-[124px] items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  if (matchups.length === 0) return null;

  return (
    <View className="bg-[#0c0c0e] border-b border-white/10">
      <Text className="px-3.5 pt-2.5 pb-2 text-[10px] font-bold tracking-widest text-brand">
        WEEK {week} · FANTASY
      </Text>

      <FlatList
        horizontal
        data={matchups}
        keyExtractor={([matchupID]) => matchupID}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-3 pb-3 gap-2.5"
        ListFooterComponent={
          <Pressable
            onPress={() => router.push(`/league/${leagueID}/schedule`)}
            className="w-[60px] items-center justify-center rounded-xl bg-brand/15 border border-brand/30"
          >
            <Text className="text-[10px] font-bold text-brand text-center leading-[13px]">ALL{"\n"}SCORES</Text>
          </Pressable>
        }
        renderItem={({ item: [matchupID, teams] }) => {
          const [team1, team2] = teams;
          if (!team1 || !team2) return null;

          const weekString = week?.toString();
          let team1Proj = 0;
          let team2Proj = 0;
          for (const p of team1.starters || []) {
            const proj = playersData?.[p]?.wi?.[weekString ?? ""]?.p;
            if (proj !== undefined) team1Proj += parseFloat(proj);
          }
          for (const p of team2.starters || []) {
            const proj = playersData?.[p]?.wi?.[weekString ?? ""]?.p;
            if (proj !== undefined) team2Proj += parseFloat(proj);
          }

          const team1Points = parseFloat(team1.team_points || "0");
          const team2Points = parseFloat(team2.team_points || "0");

          // Live/final by each starter's real NFL game status, not by
          // whether their fantasy points happen to be 0 yet - a player can
          // finish a game with a genuine 0, which the old points-based
          // check couldn't tell apart from "hasn't played". A lineup with
          // any empty slot ("0" in Sleeper's starters array) never counts
          // as final.
          const team1Starters = team1.starters || [];
          const team2Starters = team2.starters || [];
          const rosterFullySet = (starterIds: string[]) =>
            starterIds.length > 0 && !starterIds.includes("0");
          const team1GameState = computeFantasyTeamGameState(
            team1Starters.map((id) => playersData?.[id]?.t),
            nflGameStatusByTeam,
            rosterFullySet(team1Starters)
          );
          const team2GameState = computeFantasyTeamGameState(
            team2Starters.map((id) => playersData?.[id]?.t),
            nflGameStatusByTeam,
            rosterFullySet(team2Starters)
          );
          const matchupGameState = combineMatchupGameState(
            team1GameState,
            team2GameState,
            isPastMondayNightCutoff()
          );
          const preGame = matchupGameState === "pre";
          const liveGame = matchupGameState === "live";
          const postGame = matchupGameState === "final";
          const team1Leading = !preGame && team1Points >= team2Points;
          const team2Leading = !preGame && team2Points >= team1Points;

          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/league/[leagueID]/matchup",
                  params: { leagueID, week: String(week), matchupID },
                } as any)
              }
              className="bg-[#141416] rounded-2xl border border-white/10 w-[168px] overflow-hidden"
            >
              {liveGame && <View className="h-[2.5px] bg-[#dc2626]" />}
              <View className="px-3 pt-2.5 pb-2">
                <ScoreRow
                  name={team1.name}
                  avatar={team1.avatar}
                  points={team1.team_points}
                  showScore={!preGame}
                  emphasize={team1Leading}
                />
                <View className="h-px bg-white/10 my-1.5" />
                <ScoreRow
                  name={team2.name}
                  avatar={team2.avatar}
                  points={team2.team_points}
                  showScore={!preGame}
                  emphasize={team2Leading}
                />
              </View>

              <View className="border-t border-white/10 px-3 py-1.5 flex-row items-center justify-between min-h-[28px]">
                {preGame && (
                  <View>
                    <Text className="text-[9px] text-gray-400 font-semibold" numberOfLines={1}>
                      {Math.round(team1Proj) === Math.round(team2Proj)
                        ? "PICK'EM"
                        : team1Proj > team2Proj
                          ? `${abbrev(team1.name)} -${Math.round(team1Proj - team2Proj)}`
                          : `${abbrev(team2.name)} -${Math.round(team2Proj - team1Proj)}`}
                    </Text>
                    <Text className="text-[9px] text-gray-600">O/U {Math.round(team1Proj + team2Proj)}</Text>
                  </View>
                )}
                {postGame && <Text className="text-[9px] font-bold text-gray-500 tracking-wider">FINAL</Text>}
                {!postGame && !preGame && !liveGame && <View />}
                {liveGame && (
                  <View className="flex-row items-center bg-[#dc2626]/15 border border-[#dc2626]/40 rounded-full px-2 py-0.5 ml-auto">
                    <LiveDot />
                    <Text className="text-[9px] font-bold text-[#dc2626] tracking-wide">LIVE</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function abbrev(name: string) {
  return name.length > 8 ? `${name.slice(0, 7)}…` : name;
}

function ScoreRow({
  name,
  avatar,
  points,
  showScore,
  emphasize,
}: {
  name: string;
  avatar?: string | ImageSourcePropType;
  points?: string;
  showScore: boolean;
  emphasize: boolean;
}) {
  return (
    <View className="flex-row justify-between items-center">
      <View className="flex-row items-center flex-1 mr-2">
        <Image
          source={typeof avatar === "string" ? { uri: avatar } : avatar}
          className="w-[24px] h-[24px] rounded-full mr-2 bg-white/10"
        />
        <Text
          numberOfLines={1}
          className={`text-[12px] flex-1 ${emphasize ? "font-bold text-white" : "font-medium text-gray-500"}`}
        >
          {name}
        </Text>
      </View>
      {showScore ? (
        <AnimatedNumber
          value={parseFloat(points || "0")}
          decimals={1}
          style={{ fontVariant: ["tabular-nums"] }}
          className={`text-[16px] ${emphasize ? "font-bold text-white" : "font-semibold text-gray-500"}`}
        />
      ) : (
        <Text className="text-[10px] text-gray-500">--</Text>
      )}
    </View>
  );
}
