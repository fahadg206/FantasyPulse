import { useEffect, useState } from "react";
import { View, Text, Image, FlatList, ScrollView, ActivityIndicator, Pressable, Modal, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import getMatchupData from "../../../lib/getMatchupData";
import { storage, StorageKeys } from "../../../lib/storage";
import WhatIfModal from "../../../components/WhatIfModal";
import { runMonteCarlo } from "../../../lib/whatIfSimulation";
import { getZoneForRank, isZoneStart, StandingsZone } from "../../../lib/leagueZones";
import { LOTTERY_LEAGUE_IDS } from "../../../lib/draftLottery";

const helmet = require("../../../assets/images/helmet2.png");

interface TeamData {
  avatar?: string | number;
  name: string;
  user_id?: string;
  starters?: string[];
  team_points_for_dec?: string;
  team_points_against_dec?: string;
  team_points_for?: string;
  team_points_against?: string;
  wins?: string;
  losses?: string;
  streak?: string;
  playoffOdds?: number;
  divisionOdds?: number;
  division?: number;
}
type ManagerInfo = Record<string, TeamData>;
type SortedTeamData = [string, TeamData][];

function calculateTeamProjection(starters: string[], week: number, playersData: any) {
  let total = 0;
  for (const playerId of starters) {
    const p = playersData?.[playerId]?.wi?.[week.toString()]?.p;
    if (p !== undefined) total += parseFloat(p);
  }
  return total;
}

export default function Standings() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const [sortedTeamData, setSortedTeamData] = useState<SortedTeamData>([]);
  const [leagueName, setLeagueName] = useState("");
  const [playoffSpots, setPlayoffSpots] = useState(6);
  const [preseason, setPreseason] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading Standings");
  const [divisionNames, setDivisionNames] = useState<Record<number, string>>({});
  // Bumping this re-runs the full load effect below - pull-to-refresh's
  // only job. refreshKey === 0 means "this run is the initial mount," so
  // the full-screen loading state stays reserved for that one; every
  // later run (a refresh) only ever touches the small pull spinner.
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"overall" | "division">("overall");
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  // Which team's action sheet ("View Team" / "View Profile") is open, if
  // any - tapping a row used to navigate straight to their profile, which
  // buried "View Team" (their roster on League Managers) with no way to
  // reach it from here at all.
  const [actionsFor, setActionsFor] = useState<{ userId: string; name: string } | null>(null);
  // Everything the What-If simulator needs, captured once from the main
  // fetch below so it can re-run scenarios without re-fetching anything.
  const [simInputs, setSimInputs] = useState<{
    managerInfo: ManagerInfo;
    matchupData: Record<number, any>;
    projectionCache: Record<number, Record<string, number>>;
    playoffStartWeek: number;
    playoffSpots: number;
  } | null>(null);

  useEffect(() => {
    const messages = ["Loading Standings", "Importing League Data", "Calculating Projections"];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setLoadingMessage(messages[i]);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    const isInitial = refreshKey === 0;

    (async () => {
      try {
        const storedName = await storage.getItem(StorageKeys.selectedLeagueName);
        if (!cancelled && storedName) setLeagueName(storedName);

        const [playersData, usersData, rostersData, leagueSettings] = await Promise.all([
          backend.fetchPlayers(leagueID),
          sleeper.getLeagueUsers(leagueID).then((r) => r.data),
          sleeper.getLeagueRosters(leagueID).then((r) => r.data),
          sleeper.getLeague(leagueID).then((r) => r.data),
        ]);
        if (cancelled) return;

        const playoffStartWeek: number = leagueSettings.settings.playoff_week_start;
        const usersWithRoster = usersData.filter((user: any) =>
          rostersData.some((r: any) => r.owner_id === user.user_id)
        );

        const managerInfo: ManagerInfo = {};
        for (const user of usersWithRoster) {
          managerInfo[user.user_id] = {
            user_id: user.user_id,
            avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : helmet,
            name: user.display_name,
          };
        }
        const divisionsCount: number = leagueSettings.settings?.divisions ?? 0;
        if (divisionsCount > 1) {
          const names: Record<number, string> = {};
          for (let d = 1; d <= divisionsCount; d++) {
            names[d] = leagueSettings.metadata?.[`division_${d}`] ?? `Division ${d}`;
          }
          if (!cancelled) setDivisionNames(names);
        }

        for (const roster of rostersData) {
          const m = managerInfo[roster.owner_id];
          if (m) {
            m.starters = roster.starters;
            m.division = roster.settings?.division;
            m.team_points_for_dec = roster.settings.fpts_decimal;
            m.team_points_for = roster.settings.fpts;
            m.team_points_against_dec = roster.settings.fpts_against_decimal;
            m.team_points_against = roster.settings.fpts_against || "0";
            m.wins = roster.settings.wins;
            m.losses = roster.settings.losses;
            if (roster.metadata?.streak) m.streak = roster.metadata.streak;
          }
        }

        // All weeks are fetched in parallel and share the already-fetched
        // players payload, instead of each week re-fetching it in sequence.
        const weekNumbers = Array.from({ length: playoffStartWeek - 1 }, (_, i) => i + 1);
        const weekResults = await Promise.all(
          weekNumbers.map((week) => getMatchupData(leagueID, week, playersData))
        );
        const matchupData: Record<number, any> = {};
        weekNumbers.forEach((week, i) => {
          matchupData[week] = weekResults[i].updatedScheduleData;
        });
        if (cancelled) return;

        // The projection for a given (team, week) is fixed - precompute it
        // once instead of recalculating it inside every one of the 1000
        // simulation iterations below.
        const projectionCache: Record<number, Record<string, number>> = {};
        for (const week of weekNumbers) {
          projectionCache[week] = {};
          for (const userId in managerInfo) {
            projectionCache[week][userId] = calculateTeamProjection(
              managerInfo[userId].starters || [],
              week,
              playersData
            );
          }
        }

        let teamArray = Object.entries(managerInfo)
          .sort((a, b) => {
            const bPts =
              (parseFloat(b[1].team_points_for || "0") || 0) +
              (parseFloat(b[1].team_points_for_dec || "0") || 0) / 100;
            const aPts =
              (parseFloat(a[1].team_points_for || "0") || 0) +
              (parseFloat(a[1].team_points_for_dec || "0") || 0) / 100;
            return bPts - aPts;
          })
          .sort((a, b) => parseInt(b[1].wins || "0") - parseInt(a[1].wins || "0"));

        // Monte Carlo playoff-odds simulation
        const totalSimulations = 1000;
        // Not every league uses a 6-team playoff bracket - use the league's
        // own setting so the odds (and the standings playoff-line divider)
        // are actually correct for this league.
        const playoffSpots = leagueSettings.settings?.playoff_teams || 6;
        if (!cancelled) setPlayoffSpots(playoffSpots);

        // Tiebreaks ties in wins by points-for and (when the league has
        // divisions) gives each division's leader an automatic bid before
        // filling remaining spots by record - see whatIfSimulation.ts for
        // why, and it's shared with the What-If modal so both agree.
        const teamIds = teamArray.map(([userId]) => userId);
        const { playoffOdds, divisionOdds } = runMonteCarlo(
          teamIds,
          managerInfo,
          matchupData,
          projectionCache,
          playoffStartWeek,
          playoffSpots,
          divisionsCount,
          {},
          totalSimulations
        );
        teamIds.forEach((userId) => {
          managerInfo[userId].playoffOdds = playoffOdds[userId];
          if (divisionsCount > 1) managerInfo[userId].divisionOdds = divisionOdds[userId];
        });

        if (!cancelled) {
          setSimInputs({ managerInfo, matchupData, projectionCache, playoffStartWeek, playoffSpots });
        }

        const allZeroRecord = teamArray.every(([, t]) => parseInt(t.wins || "0") === 0);
        if (allZeroRecord) {
          teamArray = [...teamArray].sort(
            (a, b) => (managerInfo[b[0]].playoffOdds || 0) - (managerInfo[a[0]].playoffOdds || 0)
          );
        }

        if (!cancelled) {
          setPreseason(allZeroRecord);
          setSortedTeamData(teamArray.map(([id]) => [id, managerInfo[id]]));
          if (isInitial) setLoading(false);
          else setRefreshing(false);
        }
      } catch (error) {
        console.error("Error fetching standings data:", error);
        if (!cancelled) {
          if (isInitial) setLoading(false);
          else setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID, refreshKey]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" size="large" />
        <Text className="text-gray-400 text-[13px]">{loadingMessage}</Text>
      </View>
    );
  }

  const hasDivisions = Object.keys(divisionNames).length > 1;

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-5 pb-4 border-b border-white/10">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-2">
            <Text className="text-[11px] font-bold tracking-widest text-brand">STANDINGS</Text>
            <Text numberOfLines={1} className="text-white text-[21px] font-bold mt-0.5">
              {leagueName}
            </Text>
            <Text className="text-gray-500 text-[11px] mt-0.5">
              {preseason
                ? "Projected finish - no games played yet"
                : viewMode === "division"
                  ? "Ranked within each division"
                  : `Top ${playoffSpots} make the playoffs`}
            </Text>
          </View>
          <Pressable
            onPress={() => setWhatIfOpen(true)}
            className="flex-row items-center gap-1.5 bg-brand/15 border border-brand/30 rounded-full px-3 py-1.5"
          >
            <Feather name="help-circle" size={12} color="#e2465a" />
            <Text className="text-brand text-[11px] font-bold">What If?</Text>
          </Pressable>
        </View>

        {(hasDivisions || LOTTERY_LEAGUE_IDS.has(leagueID)) && (
          <View className="flex-row items-center justify-between mt-3.5">
            {hasDivisions ? (
              <View className="flex-row bg-[#1c1c1e] rounded-full p-1 self-start">
                {(["overall", "division"] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => setViewMode(mode)}
                    className={`px-4 py-1.5 rounded-full ${viewMode === mode ? "bg-brand" : ""}`}
                  >
                    <Text className={`text-[11px] font-bold ${viewMode === mode ? "text-white" : "text-gray-400"}`}>
                      {mode === "overall" ? "Overall" : "Division"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View />
            )}

            {LOTTERY_LEAGUE_IDS.has(leagueID) && (
              <Pressable
                onPress={() => router.push(`/league/${leagueID}/lottery`)}
                className="flex-row items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5"
              >
                <Ionicons name="shuffle" size={12} color="#af1222" />
                <Text className="text-brand text-[11px] font-bold">Draft Lottery</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View className="flex-row items-center px-4 py-2 border-b border-white/10">
        <Text className="w-[26px] text-[10px] font-bold text-gray-500">RK</Text>
        <Text className="flex-1 text-[10px] font-bold text-gray-500">TEAM</Text>
        <Text className="w-[42px] text-[10px] font-bold text-gray-500 text-center">W-L</Text>
        <Text className="w-[52px] text-[10px] font-bold text-gray-500 text-right">PF</Text>
        <Text className="w-[52px] text-[10px] font-bold text-gray-500 text-right">PA</Text>
        <Text className="w-[50px] text-[10px] font-bold text-gray-500 text-right">
          {viewMode === "division" ? "DIV %" : "ODDS"}
        </Text>
      </View>

      {viewMode === "overall" ? (
        <FlatList
          data={sortedTeamData}
          keyExtractor={([userId]) => userId}
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
          renderItem={({ item: [userId, user], index }) => {
            const rank = index + 1;
            return (
              <TeamRow
                user={user}
                rank={rank}
                showPlayoffLine={index === playoffSpots && playoffSpots < sortedTeamData.length}
                oddsField="playoffOdds"
                zone={getZoneForRank(leagueID, rank, sortedTeamData.length)}
                zoneStarts={isZoneStart(leagueID, rank, sortedTeamData.length)}
                onPress={() => user.user_id && setActionsFor({ userId: user.user_id, name: user.name })}
              />
            );
          }}
        />
      ) : (
        <ScrollView
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
          {Array.from({ length: Object.keys(divisionNames).length }, (_, i) => i + 1).map((div) => {
            const teams = sortedTeamData.filter(([, u]) => u.division === div);
            if (teams.length === 0) return null;
            return (
              <View key={div}>
                <View className="px-4 py-2 bg-white/[0.03]">
                  <Text className="text-[11px] font-bold tracking-wider text-brand">
                    {divisionNames[div]?.toUpperCase() ?? `DIVISION ${div}`}
                  </Text>
                </View>
                {teams.map(([userId, user], i) => (
                  <TeamRow
                    key={userId}
                    user={user}
                    rank={i + 1}
                    showPlayoffLine={false}
                    oddsField="divisionOdds"
                    onPress={() => user.user_id && setActionsFor({ userId: user.user_id, name: user.name })}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      <WhatIfModal
        visible={whatIfOpen}
        onClose={() => setWhatIfOpen(false)}
        managerInfo={simInputs?.managerInfo ?? {}}
        matchupData={simInputs?.matchupData ?? {}}
        projectionCache={simInputs?.projectionCache ?? {}}
        playoffStartWeek={simInputs?.playoffStartWeek ?? 1}
        playoffSpots={simInputs?.playoffSpots ?? playoffSpots}
        divisionsCount={Object.keys(divisionNames).length}
      />

      <Modal visible={actionsFor !== null} transparent animationType="fade" onRequestClose={() => setActionsFor(null)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setActionsFor(null)}>
          <Pressable className="bg-[#141416] rounded-t-2xl overflow-hidden pb-6" onPress={() => {}}>
            <View className="items-center pt-3 pb-2">
              <View className="w-9 h-1 rounded-full bg-white/15" />
            </View>
            <Text numberOfLines={1} className="text-white font-bold text-[15px] text-center px-6 pb-3">
              {actionsFor?.name}
            </Text>
            <Pressable
              onPress={() => {
                if (!actionsFor) return;
                router.push({
                  pathname: "/league/[leagueID]/leaguemanagers",
                  params: { leagueID, userId: actionsFor.userId },
                } as any);
                setActionsFor(null);
              }}
              className="flex-row items-center gap-3 px-5 py-3.5 border-t border-white/10"
            >
              <Ionicons name="shirt-outline" size={18} color="#e5e7eb" />
              <Text className="text-white text-[14px] font-semibold">View Team</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!actionsFor) return;
                router.push(`/profile/manager/${actionsFor.userId}`);
                setActionsFor(null);
              }}
              className="flex-row items-center gap-3 px-5 py-3.5 border-t border-white/10"
            >
              <Ionicons name="person-circle-outline" size={18} color="#e5e7eb" />
              <Text className="text-white text-[14px] font-semibold">View Profile</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const ZONE_COLOR: Record<StandingsZone["color"], string> = {
  red: "#ef4444",
  green: "#22c55e",
};

function TeamRow({
  user,
  rank,
  showPlayoffLine,
  oddsField,
  zone,
  zoneStarts,
  onPress,
}: {
  user: TeamData;
  rank: number;
  showPlayoffLine: boolean;
  oddsField: "playoffOdds" | "divisionOdds";
  /** the promotion/relegation-style zone this rank falls in, if this league defines one (lib/leagueZones.ts) - not a Sleeper concept, manually configured per league */
  zone?: StandingsZone;
  /** true on the first row of `zone`, where its divider/label renders */
  zoneStarts?: boolean;
  onPress: () => void;
}) {
  const zoneColor = zone ? ZONE_COLOR[zone.color] : undefined;

  const pointsFor =
    user.team_points_for !== undefined
      ? (
          parseFloat(user.team_points_for) +
          (user.team_points_for_dec ? parseFloat(user.team_points_for_dec) / 100 : 0)
        ).toFixed(1)
      : "-";
  const pointsAgainst =
    user.team_points_against !== undefined
      ? (
          parseFloat(user.team_points_against) +
          (user.team_points_against_dec ? parseFloat(user.team_points_against_dec) / 100 : 0)
        ).toFixed(1)
      : "-";
  const odds = user[oddsField];
  const oddsColor = odds === undefined ? "#6b7280" : odds >= 75 ? "#22c55e" : odds >= 40 ? "#eab308" : "#6b7280";

  return (
    <>
      {showPlayoffLine && (
        <View className="flex-row items-center px-4 py-1.5 bg-white/[0.03]">
          <View className="flex-1 h-px bg-brand/40" />
          <Text className="text-[9px] font-bold tracking-wider text-brand mx-2">PLAYOFF LINE</Text>
          <View className="flex-1 h-px bg-brand/40" />
        </View>
      )}
      {zone && zoneStarts && zoneColor && (
        <View className="flex-row items-center px-4 py-1.5 bg-white/[0.03]">
          <View style={{ backgroundColor: zoneColor }} className="flex-1 h-px opacity-40" />
          <Text style={{ color: zoneColor }} className="text-[9px] font-bold tracking-wider mx-2 uppercase">
            {zone.label}
          </Text>
          <View style={{ backgroundColor: zoneColor }} className="flex-1 h-px opacity-40" />
        </View>
      )}
      <Pressable
        onPress={onPress}
        style={zoneColor ? { borderLeftWidth: 3, borderLeftColor: zoneColor, backgroundColor: `${zoneColor}14` } : undefined}
        className="flex-row items-center px-4 py-3 border-b border-white/5"
      >
        <RankBadge rank={rank} />
        <Image
          source={typeof user.avatar === "string" ? { uri: user.avatar } : user.avatar}
          className="w-[30px] h-[30px] rounded-full mx-2.5 bg-white/10"
        />
        <View className="flex-1 mr-1">
          <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
            {user.name}
          </Text>
          <StreakTag streak={user.streak} />
        </View>
        <Text style={{ fontVariant: ["tabular-nums"] }} className="w-[42px] text-center text-white text-[13px] font-bold">
          {user.wins}-{user.losses}
        </Text>
        <Text style={{ fontVariant: ["tabular-nums"] }} className="w-[52px] text-right text-gray-300 text-[12px]">
          {pointsFor}
        </Text>
        <Text style={{ fontVariant: ["tabular-nums"] }} className="w-[52px] text-right text-gray-500 text-[12px]">
          {pointsAgainst}
        </Text>
        <Text style={{ fontVariant: ["tabular-nums"], color: oddsColor }} className="w-[50px] text-right text-[12px] font-bold">
          {odds !== undefined ? `${odds.toFixed(0)}%` : "-"}
        </Text>
      </Pressable>
    </>
  );
}

const RANK_STYLE: Record<number, { bg: string; text: string }> = {
  1: { bg: "#3a2e0a", text: "#eab308" },
  2: { bg: "#2a2c30", text: "#cbd5e1" },
  3: { bg: "#3a2414", text: "#d08a4f" },
};

function RankBadge({ rank }: { rank: number }) {
  const style = RANK_STYLE[rank];
  return (
    <View
      style={{ backgroundColor: style?.bg ?? "#1c1c1e" }}
      className="w-[24px] h-[24px] rounded-full items-center justify-center"
    >
      {rank === 1 ? (
        <Ionicons name="trophy" size={12} color={style.text} />
      ) : (
        <Text style={{ color: style?.text ?? "#9ca3af" }} className="text-[11px] font-bold">
          {rank}
        </Text>
      )}
    </View>
  );
}

function StreakTag({ streak }: { streak?: string }) {
  if (!streak || streak === "N/A") return <Text className="text-[10px] text-gray-600">-</Text>;
  const isWin = streak.includes("W");
  return (
    <Text style={{ color: isWin ? "#22c55e" : "#ef4444" }} className="text-[10px] font-semibold">
      {isWin ? "Won" : "Lost"} {streak.replace(/[WL]/g, "")} straight
    </Text>
  );
}
