import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal, TextInput, FlatList } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, RawPlayerValue, LeagueValueSettings } from "../../../lib/playerValue";
import { buildStartSitBoard, scoreArbitraryPlayers, StartSitBoard, StartSitPlayer } from "../../../lib/startSit";
import { getTeamColor, getTeamLogo, getPositionColor } from "../../../lib/nflTeams";
import { usePlayerDetail } from "../../../components/PlayerDetailProvider";

const helmet = require("../../../assets/images/helmet2.png");

interface TeamOption {
  userId: string;
  name: string;
  avatar?: string;
  rosterPlayerIds: string[];
}

interface LeagueMeta {
  season: string;
  startingSlots: string[];
  settings: LeagueValueSettings;
  playersData: Record<string, any>;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
}

function formatValue(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

/** "#4" -> "QB4" - a positional rank reads the same way real rankings pages label it. */
function formatRank(pos: string, rank: number | null): string {
  return rank === null ? "—" : `${pos}${Math.round(rank)}`;
}

// Sleeper's real roster_positions slot names run long ("SUPER_FLEX",
// "WRRB_FLEX") - shortened here so the lineup row has room to breathe.
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SFLEX",
  SUPERFLEX: "SFLEX",
  "QB/RB/WR/TE": "SFLEX",
  WRRB_FLEX: "FLEX",
  REC_FLEX: "FLEX",
};
function formatSlotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}

// Real favicons for each ranking source, via Google's favicon service - a
// small recognizable mark instead of a text label, so a chip stays legible
// at a glance no matter how many sources a player has.
const SOURCE_DOMAINS: Record<string, string> = {
  Sleeper: "sleeper.com",
  ESPN: "espn.com",
  KTC: "keeptradecut.com",
  FantasyCalc: "fantasycalc.com",
};
function getSourceLogo(label: string): string | null {
  const domain = SOURCE_DOMAINS[label];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

export default function StartSitScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const playerDetail = usePlayerDetail();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [leagueMeta, setLeagueMeta] = useState<LeagueMeta | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [board, setBoard] = useState<StartSitBoard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Any-two-players comparison, independent of the selected roster.
  const [comparePlayers, setComparePlayers] = useState<[string | null, string | null]>([null, null]);
  const [compareResults, setCompareResults] = useState<StartSitPlayer[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<0 | 1 | null>(null);

  // Team list, once.
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

  // League-wide data (every fantasy-relevant player, not just one roster) -
  // shared by the recommended lineup below and the any-two-players picker.
  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

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

        setLeagueMeta({ season: league.season, startingSlots, settings, playersData, valuesBySleeperId });
      } catch (error) {
        console.error("Error loading start/sit league data:", error);
        if (!cancelled) setLeagueMeta(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID, refreshKey]);

  // The recommended-lineup board, rebuilt whenever the selected team, week, or league data changes.
  useEffect(() => {
    if (!leagueMeta || !selectedUserId || week === 0) return;
    const team = teams.find((t) => t.userId === selectedUserId);
    if (!team) return;
    let cancelled = false;
    setLoadingBoard(true);

    (async () => {
      try {
        const result = await buildStartSitBoard({
          rosterPlayerIds: team.rosterPlayerIds,
          startingSlots: leagueMeta.startingSlots,
          week,
          season: leagueMeta.season,
          playersData: leagueMeta.playersData,
          isDynasty: leagueMeta.settings.isDynasty,
          leagueValueSettings: leagueMeta.settings,
          valuesBySleeperId: leagueMeta.valuesBySleeperId,
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
  }, [selectedUserId, leagueMeta, week, teams]);

  // The two-player comparison, whenever both slots are filled.
  useEffect(() => {
    if (!leagueMeta || comparePlayers[0] == null || comparePlayers[1] == null) {
      setCompareResults(null);
      return;
    }
    let cancelled = false;
    setComparing(true);

    (async () => {
      try {
        const results = await scoreArbitraryPlayers({
          playerIds: [comparePlayers[0]!, comparePlayers[1]!],
          week,
          season: leagueMeta.season,
          playersData: leagueMeta.playersData,
          isDynasty: leagueMeta.settings.isDynasty,
          leagueValueSettings: leagueMeta.settings,
          valuesBySleeperId: leagueMeta.valuesBySleeperId,
        });
        if (!cancelled) setCompareResults(results);
      } catch (error) {
        console.error("Error comparing players:", error);
        if (!cancelled) setCompareResults(null);
      } finally {
        if (!cancelled) setComparing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [comparePlayers, leagueMeta, week]);

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
        Sleeper, ESPN, KTC, and FantasyCalc rankings, averaged into one consensus for every player - Week {week}.
      </Text>

      <View className="rounded-2xl border border-white/10 bg-[#141416] p-4 mt-4">
        <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-1">COMPARE ANY TWO PLAYERS</Text>
        <Text className="text-gray-600 text-[11px] mb-3">Not just your roster - look up any two players in the league.</Text>
        <View className="flex-row items-center gap-2">
          <ComparePickerSlot
            player={comparePlayers[0] ? leagueMeta?.playersData[comparePlayers[0]] : undefined}
            playerId={comparePlayers[0]}
            onPress={() => setPickerSlot(0)}
            onClear={() => setComparePlayers(([, b]) => [null, b])}
          />
          <Text className="text-gray-600 text-[11px] font-extrabold">VS</Text>
          <ComparePickerSlot
            player={comparePlayers[1] ? leagueMeta?.playersData[comparePlayers[1]] : undefined}
            playerId={comparePlayers[1]}
            onPress={() => setPickerSlot(1)}
            onClear={() => setComparePlayers(([a]) => [a, null])}
          />
        </View>

        {comparing && <ActivityIndicator color="#af1222" className="mt-5" />}

        {!comparing && compareResults && (
          <View className="gap-2.5 mt-4">
            {compareResults.map((p) => (
              <PlayerRankCard
                key={p.playerId}
                player={p}
                showStatus={false}
                onPress={() => playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })}
              />
            ))}
          </View>
        )}
      </View>

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
                  <View className="flex-row items-center justify-between mb-4">
                    <Text className="text-brand text-[10px] font-bold tracking-widest">RECOMMENDED LINEUP</Text>
                    <View className="items-end">
                      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[18px] font-extrabold">
                        {totalProjected.toFixed(1)}
                      </Text>
                      <Text className="text-gray-500 text-[9px] font-semibold">PROJECTED PTS</Text>
                    </View>
                  </View>
                  <View className="gap-2.5">
                    {board.lineup.map((slot, i) => {
                      const p = board.players.find((pl) => pl.playerId === slot.playerId);
                      return (
                        <LineupRow
                          key={`${slot.slot}-${i}`}
                          slotLabel={slot.slot}
                          player={p}
                          onPress={() => p && playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })}
                        />
                      );
                    })}
                  </View>
                </LinearGradient>
              </View>

              <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-3">FULL RANKINGS BREAKDOWN</Text>
              <View className="gap-2.5 mb-6">
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

      <PlayerPickerModal
        visible={pickerSlot !== null}
        playersData={leagueMeta?.playersData ?? {}}
        week={week}
        excludeId={pickerSlot === 0 ? comparePlayers[1] : comparePlayers[0]}
        onClose={() => setPickerSlot(null)}
        onPick={(pid) => {
          if (pickerSlot === null) return;
          setComparePlayers((prev) => {
            const next: [string | null, string | null] = [...prev];
            next[pickerSlot] = pid;
            return next;
          });
          setPickerSlot(null);
        }}
      />
    </ScrollView>
  );
}

function ComparePickerSlot({
  player,
  playerId,
  onPress,
  onClear,
}: {
  player?: any;
  playerId: string | null;
  onPress: () => void;
  onClear: () => void;
}) {
  if (!player || !playerId) {
    return (
      <Pressable onPress={onPress} className="flex-1 flex-row items-center justify-center gap-1.5 border border-dashed border-white/15 rounded-xl py-3">
        <Feather name="plus" size={13} color="#6b7280" />
        <Text className="text-gray-500 text-[12px] font-semibold">Pick a player</Text>
      </Pressable>
    );
  }
  const color = getTeamColor(player.t);
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: color }} className="flex-1 flex-row items-center gap-2 rounded-xl py-2 px-2.5">
      <Image source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }} className="w-7 h-7 rounded-full bg-white/20" />
      <Text numberOfLines={1} className="flex-1 text-white text-[12px] font-bold">
        {player.fn} {player.ln}
      </Text>
      <Pressable onPress={onClear} hitSlop={8}>
        <Feather name="x" size={13} color="#ffffffaa" />
      </Pressable>
    </Pressable>
  );
}

function PlayerPickerModal({
  visible,
  playersData,
  week,
  excludeId,
  onClose,
  onPick,
}: {
  visible: boolean;
  playersData: Record<string, any>;
  week: number;
  excludeId?: string | null;
  onClose: () => void;
  onPick: (playerId: string) => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = Object.keys(playersData).filter((pid) => {
      if (pid === excludeId) return false;
      if (!q) return true;
      const p = playersData[pid];
      return `${p?.fn ?? ""} ${p?.ln ?? ""}`.toLowerCase().includes(q);
    });
    ids.sort((a, b) => {
      const pa = playersData[a];
      const pb = playersData[b];
      if (q) return `${pa?.fn ?? ""} ${pa?.ln ?? ""}`.localeCompare(`${pb?.fn ?? ""} ${pb?.ln ?? ""}`);
      return parseFloat(pb?.wi?.[String(week)]?.p || "0") - parseFloat(pa?.wi?.[String(week)]?.p || "0");
    });
    return ids.slice(0, 40);
  }, [playersData, query, excludeId, week]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable className="bg-[#141416] rounded-t-3xl p-4" style={{ maxHeight: "75%" }} onPress={(e) => e.stopPropagation()}>
          <View className="w-10 h-1 rounded-full bg-white/20 self-center mb-3" />
          <Text className="text-white text-[15px] font-bold mb-3">Pick a player</Text>
          <View className="flex-row items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5 mb-3">
            <Feather name="search" size={14} color="#6b7280" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search any player…"
              placeholderTextColor="#6b7280"
              className="flex-1 text-white text-[13px]"
              autoFocus
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={(pid) => pid}
            renderItem={({ item: pid }) => {
              const p = playersData[pid];
              const color = getTeamColor(p?.t);
              const posColor = getPositionColor(p?.pos);
              return (
                <Pressable onPress={() => onPick(pid)} className="flex-row items-center gap-3 py-2.5 border-b border-white/5">
                  <View style={{ backgroundColor: color }} className="w-9 h-9 rounded-full overflow-hidden items-center justify-center">
                    <Image source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg` }} className="w-9 h-9 rounded-full" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[13px] font-semibold">
                      {p?.fn} {p?.ln}
                    </Text>
                    <View className="flex-row items-center gap-1.5 mt-0.5">
                      <Text style={{ color: posColor }} className="text-[10px] font-bold">
                        {p?.pos}
                      </Text>
                      <Text className="text-gray-500 text-[10px]">{p?.t ?? "FA"}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text className="text-gray-500 text-[12px] text-center py-6">No players found</Text>}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function LineupRow({ slotLabel, player, onPress }: { slotLabel: string; player?: StartSitPlayer; onPress: () => void }) {
  if (!player) {
    return (
      <View className="flex-row items-center px-3.5 py-3 bg-white/5 rounded-xl opacity-50">
        <View className="w-[50px] mr-3">
          <Text numberOfLines={1} className="text-gray-500 text-[10px] font-bold">
            {formatSlotLabel(slotLabel)}
          </Text>
        </View>
        <Text className="text-gray-500 text-[12px] italic">Empty</Text>
      </View>
    );
  }
  const posColor = getPositionColor(player.pos);
  const teamColor = getTeamColor(player.team);
  const logo = getTeamLogo(player.team);
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-3.5 py-3 bg-white/5 rounded-xl">
      <View style={{ backgroundColor: `${posColor}1f` }} className="w-[50px] py-1 rounded-md items-center mr-3">
        <Text numberOfLines={1} style={{ color: posColor }} className="text-[10px] font-extrabold">
          {formatSlotLabel(slotLabel)}
        </Text>
      </View>
      <View style={{ backgroundColor: teamColor }} className="w-8 h-8 rounded-full items-center justify-center mr-3 overflow-hidden">
        {logo && (
          <Image source={{ uri: logo }} resizeMode="contain" style={{ position: "absolute", width: 26, height: 26, opacity: 0.35 }} />
        )}
        <Image
          source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${player.playerId}.jpg` }}
          className="w-8 h-8 rounded-full"
        />
      </View>
      <Text numberOfLines={1} className="flex-1 text-white text-[13px] font-semibold mr-2.5">
        {player.name}
      </Text>
      {player.consensusRank !== null && (
        <View style={{ backgroundColor: `${posColor}22` }} className="px-2 py-1 rounded-md mr-2.5">
          <Text numberOfLines={1} style={{ color: posColor }} className="text-[10px] font-extrabold">
            {formatRank(player.pos, player.consensusRank)}
          </Text>
        </View>
      )}
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-bold w-[42px] text-right">
        {player.projectedPoints.toFixed(1)}
      </Text>
    </Pressable>
  );
}

function PlayerRankCard({ player, onPress, showStatus = true }: { player: StartSitPlayer; onPress: () => void; showStatus?: boolean }) {
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
        {player.opponent && (
          <View
            style={{ backgroundColor: showStatus ? (isStarting ? "#4ade8022" : "#6b728022") : "rgba(255,255,255,0.08)" }}
            className="px-2.5 py-1 rounded-full"
          >
            <Text
              style={{ color: showStatus ? (isStarting ? "#4ade80" : "#9ca3af") : "#d1d5db" }}
              className="text-[10px] font-extrabold"
            >
              {player.opponent}
            </Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3.5 pt-3 pb-3 flex-wrap">
        {player.sources.map((s) => {
          const logo = getSourceLogo(s.label);
          return (
            <View key={s.label} style={{ flexGrow: 1, flexBasis: 64 }} className="bg-[#0c0c0e] rounded-xl py-2 items-center">
              {logo ? (
                <Image source={{ uri: logo }} style={{ width: 15, height: 15, borderRadius: 3 }} resizeMode="contain" />
              ) : (
                <Text numberOfLines={1} className="text-gray-500 text-[9px] font-bold tracking-wide">
                  {s.label.toUpperCase()}
                </Text>
              )}
              <Text className="text-white text-[13px] font-bold mt-1">{formatRank(player.pos, s.rank)}</Text>
            </View>
          );
        })}
        <View style={{ borderColor: `${posColor}55`, flexGrow: 1, flexBasis: 64 }} className="border-2 rounded-xl py-2 items-center">
          <Text numberOfLines={1} style={{ color: posColor }} className="text-[9px] font-bold tracking-wide">
            AVG
          </Text>
          <Text style={{ color: posColor }} className="text-[13px] font-extrabold mt-0.5">
            {formatRank(player.pos, player.consensusRank)}
          </Text>
        </View>
        <View style={{ flexGrow: 1, flexBasis: 64 }} className="bg-[#0c0c0e] rounded-xl py-2 items-center">
          <Text numberOfLines={1} className="text-gray-500 text-[9px] font-bold tracking-wide">
            PROJ
          </Text>
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
