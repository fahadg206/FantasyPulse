import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, RawPlayerValue, LeagueValueSettings } from "../../../lib/playerValue";
import { buildStartSitBoard, StartSitBoard, StartSitPlayer } from "../../../lib/startSit";
import { getTeamColor, getTeamLogo, getPositionColor } from "../../../lib/nflTeams";
import { usePlayerDetail } from "../../../components/PlayerDetailProvider";

const helmet = require("../../../assets/images/helmet2.png");

interface TeamOption {
  userId: string;
  name: string;
  avatar?: string;
  rosterPlayerIds: string[];
}

function formatValue(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

export default function StartSitScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const playerDetail = usePlayerDetail();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [board, setBoard] = useState<StartSitBoard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // League + team list, once.
  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ data: users }, { data: rosters }, { data: nflState }] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          sleeper.getNflState(),
        ]);
        if (cancelled) return;

        const options: TeamOption[] = rosters
          .filter((r: any) => users.some((u: any) => u.user_id === r.owner_id))
          .map((r: any) => {
            const u = users.find((u: any) => u.user_id === r.owner_id);
            return {
              userId: r.owner_id,
              name: u?.display_name ?? "Unknown",
              avatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : undefined,
              rosterPlayerIds: r.players || [],
            };
          });

        setTeams(options);
        setSelectedUserId((prev) => prev ?? options[0]?.userId ?? null);
        setWeek(nflState.season_type === "post" ? 18 : nflState.display_week || 1);
      } catch (error) {
        console.error("Error loading start/sit team list:", error);
      } finally {
        if (!cancelled) setLoadingTeams(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  // The board itself, rebuilt whenever the selected team (or a refresh) changes.
  useEffect(() => {
    if (!leagueID || !selectedUserId || week === 0) return;
    const team = teams.find((t) => t.userId === selectedUserId);
    if (!team) return;
    let cancelled = false;
    setLoadingBoard(true);

    (async () => {
      try {
        const [league, settings, playersData] = await Promise.all([
          sleeper.getLeague(leagueID).then((r) => r.data),
          getLeagueValueSettings(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        let valuesBySleeperId: Record<string, RawPlayerValue> | undefined;
        if (settings.isDynasty) {
          valuesBySleeperId = await backend.fetchAllPlayerValues();
          if (cancelled) return;
        }

        const startingSlots: string[] = (league.roster_positions || []).filter(
          (p: string) => !["BN", "IR", "TAXI"].includes(p)
        );

        const result = await buildStartSitBoard({
          rosterPlayerIds: team.rosterPlayerIds,
          startingSlots,
          week,
          season: league.season,
          playersData,
          isDynasty: settings.isDynasty,
          valuesBySleeperId,
          leagueValueSettings: settings,
        });
        if (!cancelled) setBoard(result);
      } catch (error) {
        console.error("Error building start/sit board:", error);
        if (!cancelled) setBoard(null);
      } finally {
        if (!cancelled) {
          setLoadingBoard(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueID, selectedUserId, week, teams, refreshKey]);

  if (!leagueID) return null;

  const totalProjected = board?.lineup.reduce((s, a) => s + a.points, 0) ?? 0;

  return (
    <ScrollView
      className="flex-1 bg-[#0c0c0e]"
      contentContainerClassName="p-4 pb-10"
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
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">START / SIT</Text>
      <Text className="text-white text-[21px] font-bold">Set Your Lineup</Text>
      <Text className="text-gray-500 text-[12px] mt-1.5">
        Real Sleeper projections and ESPN's own weekly expert rankings, averaged into one consensus for every player
        on the roster - Week {week}.
      </Text>

      {loadingTeams ? (
        <ActivityIndicator color="#af1222" className="mt-8" />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 py-4">
            {teams.map((t) => {
              const active = t.userId === selectedUserId;
              return (
                <Pressable key={t.userId} onPress={() => setSelectedUserId(t.userId)} className="items-center" style={{ width: 62 }}>
                  <Image
                    source={t.avatar ? { uri: t.avatar } : helmet}
                    style={{ opacity: active ? 1 : 0.45 }}
                    className={`w-[50px] h-[50px] rounded-full ${active ? "border-2 border-brand" : "border border-transparent"}`}
                  />
                  <Text numberOfLines={1} className={`text-[10px] mt-1 text-center ${active ? "text-white font-bold" : "text-gray-500"}`}>
                    {t.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loadingBoard || !board ? (
            <View className="py-16 items-center">
              <ActivityIndicator color="#af1222" />
              <Text className="text-gray-500 text-[12px] mt-3">Crunching this week's rankings…</Text>
            </View>
          ) : (
            <>
              <View className="rounded-2xl overflow-hidden border border-brand/25 mb-5">
                <LinearGradient colors={["#2a0a0e", "#150507"]} className="p-4">
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-brand text-[10px] font-bold tracking-widest">RECOMMENDED LINEUP</Text>
                    <View className="items-end">
                      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[18px] font-extrabold">
                        {totalProjected.toFixed(1)}
                      </Text>
                      <Text className="text-gray-500 text-[9px] font-semibold">PROJECTED PTS</Text>
                    </View>
                  </View>
                  <View className="gap-1.5">
                    {board.lineup.map((slot, i) => {
                      const p = board.players.find((pl) => pl.playerId === slot.playerId);
                      return <LineupRow key={`${slot.slot}-${i}`} slotLabel={slot.slot} player={p} onPress={() => p && playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })} />;
                    })}
                  </View>
                </LinearGradient>
              </View>

              <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-3">FULL RANKINGS BREAKDOWN</Text>
              <View className="gap-2.5">
                {board.players.map((p) => (
                  <PlayerRankCard
                    key={p.playerId}
                    player={p}
                    onPress={() => playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })}
                  />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function LineupRow({ slotLabel, player, onPress }: { slotLabel: string; player?: StartSitPlayer; onPress: () => void }) {
  if (!player) {
    return (
      <View className="flex-row items-center px-3 py-2.5 bg-white/5 rounded-xl opacity-50">
        <Text className="text-gray-500 text-[10px] font-bold w-[64px]">{slotLabel}</Text>
        <Text className="text-gray-500 text-[12px] italic">Empty</Text>
      </View>
    );
  }
  const posColor = getPositionColor(player.pos);
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-3 py-2.5 bg-white/5 rounded-xl">
      <Text style={{ color: posColor }} className="text-[10px] font-extrabold w-[64px]">
        {slotLabel}
      </Text>
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${player.playerId}.jpg` }}
        className="w-7 h-7 rounded-full bg-white/10 mr-2.5"
      />
      <Text numberOfLines={1} className="flex-1 text-white text-[13px] font-semibold mr-2">
        {player.name}
      </Text>
      {player.consensusRank !== null && (
        <View style={{ backgroundColor: `${posColor}22` }} className="px-2 py-0.5 rounded-md mr-2">
          <Text style={{ color: posColor }} className="text-[10px] font-extrabold">
            #{player.consensusRank}
          </Text>
        </View>
      )}
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-bold w-[42px] text-right">
        {player.projectedPoints.toFixed(1)}
      </Text>
    </Pressable>
  );
}

function PlayerRankCard({ player, onPress }: { player: StartSitPlayer; onPress: () => void }) {
  const posColor = getPositionColor(player.pos);
  const teamColor = getTeamColor(player.team);
  const logo = getTeamLogo(player.team);
  const isStarting = player.recommendedSlot !== undefined;

  return (
    <Pressable
      onPress={onPress}
      style={{ borderColor: isStarting ? `${posColor}44` : "rgba(255,255,255,0.1)" }}
      className="bg-[#141416] border rounded-2xl overflow-hidden"
    >
      <View className="flex-row items-center px-3.5 pt-3.5">
        <View style={{ backgroundColor: teamColor }} className="w-11 h-11 rounded-full items-center justify-center mr-3 overflow-hidden">
          {logo && <Image source={{ uri: logo }} resizeMode="contain" style={{ position: "absolute", width: 34, height: 34, opacity: 0.35 }} />}
          <Image
            source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${player.playerId}.jpg` }}
            className="w-11 h-11 rounded-full"
          />
        </View>
        <View className="flex-1 mr-2">
          <Text numberOfLines={1} className="text-white font-bold text-[14px]">
            {player.name}
          </Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <View style={{ backgroundColor: posColor }} className="px-1.5 py-0.5 rounded">
              <Text className="text-white text-[9px] font-extrabold">{player.pos}</Text>
            </View>
            <Text className="text-gray-500 text-[10px] font-semibold">{player.team ?? "FA"}</Text>
            {player.dynastyValue !== undefined && (
              <View className="flex-row items-center gap-0.5">
                <Feather name="trending-up" size={9} color="#eab308" />
                <Text className="text-yellow-500 text-[10px] font-bold">{formatValue(player.dynastyValue)}</Text>
              </View>
            )}
          </View>
        </View>
        <View
          style={{ backgroundColor: isStarting ? "#4ade8022" : "#6b728022" }}
          className="px-2.5 py-1 rounded-full"
        >
          <Text style={{ color: isStarting ? "#4ade80" : "#9ca3af" }} className="text-[10px] font-extrabold">
            {isStarting ? player.recommendedSlot : "BENCH"}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center gap-2 px-3.5 pt-3 pb-3">
        {player.sources.map((s) => (
          <View key={s.label} className="flex-1 bg-[#0c0c0e] rounded-xl py-2 items-center">
            <Text className="text-gray-500 text-[9px] font-bold tracking-wide">{s.label.toUpperCase()}</Text>
            <Text className="text-white text-[13px] font-bold mt-0.5">#{s.rank}</Text>
          </View>
        ))}
        <View style={{ borderColor: `${posColor}55` }} className="flex-1 border-2 rounded-xl py-2 items-center">
          <Text style={{ color: posColor }} className="text-[9px] font-bold tracking-wide">
            CONSENSUS
          </Text>
          <Text style={{ color: posColor }} className="text-[13px] font-extrabold mt-0.5">
            {player.consensusRank !== null ? `#${player.consensusRank}` : "—"}
          </Text>
        </View>
        <View className="flex-1 bg-[#0c0c0e] rounded-xl py-2 items-center">
          <Text className="text-gray-500 text-[9px] font-bold tracking-wide">PROJ</Text>
          <Text className="text-white text-[13px] font-bold mt-0.5">{player.projectedPoints.toFixed(1)}</Text>
        </View>
      </View>

      {player.outlook && (
        <View className="px-3.5 pb-3.5 -mt-1">
          <Text numberOfLines={3} className="text-gray-400 text-[11px] leading-4">
            <Text className="text-gray-500 font-bold">ESPN: </Text>
            {player.outlook}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
