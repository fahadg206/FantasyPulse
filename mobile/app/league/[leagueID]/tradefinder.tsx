import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, Modal, TextInput, FlatList } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue } from "../../../lib/playerValue";
import { computeTeamNeeds, computeLeagueNeedBaseline, TeamNeedsResult } from "../../../lib/tradeAnalysis";
import { computeRedraftTeamNeeds, computeLeagueRedraftNeedBaseline, buildSeasonToDatePPG } from "../../../lib/redraftNeeds";
import { buildLeagueSimData } from "../../../lib/leagueSimData";
import type { SimTeamInfo } from "../../../lib/leagueSimData";
import type { PlayerPos } from "../../../lib/draftProspects";
import { GiveItem, findTradeMatches, TradeCandidate, ResolvedGivePlayer } from "../../../lib/tradeFinder";
import { getTeamColor, getTeamLogo, getPositionColor } from "../../../lib/nflTeams";
import { usePlayerDetail } from "../../../components/PlayerDetailProvider";

const helmet = require("../../../assets/images/helmet2.png");

// K and DEF are excluded from both position pickers below - verified live
// that this app's real KTC value feed (the same one Trade Calculator
// prices every trade against) simply has no market for either position,
// same as any real dynasty trade-value site. A "position" pick means
// "your/their best VALUED player there," and there's no such thing for
// K/DEF - offering them here would just always come back empty. A
// specific kicker or defense can still be added as an explicit player
// (a real, harmless zero-value throw-in), just not picked by position.
const VALUED_POSITIONS = ["QB", "RB", "WR", "TE"];

interface TeamOption {
  userId: string;
  name: string;
  avatar?: string;
  rosterPlayerIds: string[];
}

interface LeagueMeta {
  settings: LeagueValueSettings;
  playersData: Record<string, any>;
  valuesBySleeperId: Record<string, RawPlayerValue>;
  leagueAvgNeed: Record<PlayerPos, number>;
  seasonToDatePPG: Record<string, number>;
  remainingWeeks: number[];
}

/** a GiveItem with a stable client-side key, so the give list can hold repeats (two "position: RB" picks) and still add/remove the right row. */
type KeyedGiveItem = GiveItem & { key: string };

function formatValue(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

function playerPhotoUri(playerId: string, pos: string | undefined, team: string | undefined): string | undefined {
  if (pos === "DEF") return getTeamLogo(team) ?? undefined;
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
}

function fairnessLabel(ratio: number): { text: string; color: string } {
  if (ratio <= 0.05) return { text: "Fair trade", color: "#22c55e" };
  if (ratio <= 0.15) return { text: "Slightly lopsided", color: "#eab308" };
  if (ratio <= 0.3) return { text: "Uneven", color: "#f97316" };
  return { text: "Lopsided", color: "#ef4444" };
}

/** zips the give list (as entered) back up with its resolved players - a "position" item may fail to resolve (no valued player left there), which this surfaces as a null slot rather than silently dropping the row. */
function mapGiveItemsToResolved(
  items: KeyedGiveItem[],
  resolved: ResolvedGivePlayer[]
): { key: string; item: KeyedGiveItem; player: ResolvedGivePlayer | null }[] {
  const autoQueueByPos: Record<string, ResolvedGivePlayer[]> = {};
  for (const r of resolved) {
    if (r.auto) (autoQueueByPos[r.pos] ??= []).push(r);
  }
  return items.map((item) => {
    if (item.kind === "player") {
      const player = resolved.find((r) => !r.auto && r.playerId === item.playerId) ?? null;
      return { key: item.key, item, player };
    }
    const queue = autoQueueByPos[item.pos];
    const player = queue && queue.length > 0 ? queue.shift()! : null;
    return { key: item.key, item, player };
  });
}

export default function TradeFinderScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const playerDetail = usePlayerDetail();

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [leagueMeta, setLeagueMeta] = useState<LeagueMeta | null>(null);
  const [loading, setLoading] = useState(true);

  const [giveItems, setGiveItems] = useState<KeyedGiveItem[]>([]);
  const [wantPositions, setWantPositions] = useState<string[]>([]);

  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [positionPickerOpen, setPositionPickerOpen] = useState(false);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [usersRes, rostersRes, settings, values, playersDataRes, nflStateRes] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          getLeagueValueSettings(leagueID),
          backend.fetchAllPlayerValues(),
          backend.fetchPlayers(leagueID),
          sleeper.getNflState(),
        ]);
        if (cancelled) return;

        const teamOptions: TeamOption[] = rostersRes.data
          .filter((r: any) => usersRes.data.some((u: any) => u.user_id === r.owner_id))
          .map((r: any) => {
            const u = usersRes.data.find((u: any) => u.user_id === r.owner_id);
            return {
              userId: r.owner_id,
              name: u?.display_name ?? "Unknown",
              avatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : undefined,
              rosterPlayerIds: r.players || [],
            };
          });
        setTeams(teamOptions);
        setSelectedUserId((prev) => prev ?? teamOptions[0]?.userId ?? null);

        const managerInfoForNeeds: Record<string, SimTeamInfo> = {};
        rostersRes.data.forEach((r: any) => {
          managerInfoForNeeds[r.owner_id] = { name: "", rosterId: r.roster_id, rosterPlayerIds: r.players ?? [] };
        });

        let leagueAvgNeed: Record<PlayerPos, number>;
        let seasonToDatePPG: Record<string, number> = {};
        let remainingWeeks: number[] = [];

        // Same dynasty-vs-redraft branch Trade Calculator already uses for
        // team needs (see lib/redraftNeeds.ts) - dynasty reasons off real
        // KTC value, redraft off real season-to-date scoring since a
        // redraft roster has no long-term asset value to speak of.
        if (settings.isDynasty) {
          leagueAvgNeed = computeLeagueNeedBaseline(managerInfoForNeeds, playersDataRes, values, settings);
        } else {
          const sim = await buildLeagueSimData(leagueID);
          if (cancelled) return;
          const currentWeek: number = nflStateRes.data.display_week || 1;
          const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
          remainingWeeks = sim.weekNumbers.filter((w) => w >= currentWeek);
          seasonToDatePPG = buildSeasonToDatePPG(sim.matchupData, playedWeeks);
          leagueAvgNeed = computeLeagueRedraftNeedBaseline(managerInfoForNeeds, playersDataRes, seasonToDatePPG, remainingWeeks);
        }

        setLeagueMeta({ settings, playersData: playersDataRes, valuesBySleeperId: values, leagueAvgNeed, seasonToDatePPG, remainingWeeks });
      } catch (error) {
        console.error("Error loading trade finder data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const getTeamNeeds = (rosterPlayerIds: string[]): TeamNeedsResult => {
    if (!leagueMeta) return { scores: { QB: 0, RB: 0, WR: 0, TE: 0 }, ranked: [], biggest: { pos: "QB", score: 0 } };
    if (leagueMeta.settings.isDynasty) {
      return computeTeamNeeds(rosterPlayerIds, leagueMeta.playersData, leagueMeta.valuesBySleeperId, leagueMeta.settings, leagueMeta.leagueAvgNeed);
    }
    return computeRedraftTeamNeeds(rosterPlayerIds, leagueMeta.playersData, leagueMeta.seasonToDatePPG, leagueMeta.remainingWeeks, leagueMeta.leagueAvgNeed);
  };

  const myTeam = teams.find((t) => t.userId === selectedUserId);

  const searchResult = useMemo(() => {
    if (!leagueMeta || !myTeam || !selectedUserId) return null;
    const otherRosters: Record<string, string[]> = {};
    teams.forEach((t) => {
      if (t.userId !== selectedUserId) otherRosters[t.userId] = t.rosterPlayerIds;
    });
    return findTradeMatches({
      myUserId: selectedUserId,
      giveItems: giveItems.map(({ key, ...rest }) => rest),
      wantPositions,
      myRosterPlayerIds: myTeam.rosterPlayerIds,
      otherRosters,
      playersData: leagueMeta.playersData,
      valuesBySleeperId: leagueMeta.valuesBySleeperId,
      leagueValueSettings: leagueMeta.settings,
      getTeamNeeds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueMeta, myTeam, selectedUserId, teams, giveItems, wantPositions]);

  const resolvedGiveRows = useMemo(
    () => mapGiveItemsToResolved(giveItems, searchResult?.give ?? []),
    [giveItems, searchResult]
  );

  if (!leagueID) return null;

  const addPlayer = (playerId: string) => {
    setGiveItems((prev) => [...prev, { key: `${Date.now()}-${playerId}`, kind: "player", playerId }]);
    setPlayerPickerOpen(false);
  };
  const addPosition = (pos: string) => {
    setGiveItems((prev) => [...prev, { key: `${Date.now()}-${pos}`, kind: "position", pos }]);
    setPositionPickerOpen(false);
  };
  const removeGiveItem = (key: string) => setGiveItems((prev) => prev.filter((it) => it.key !== key));
  const toggleWant = (pos: string) =>
    setWantPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));

  // Includes auto-picked players too, not just ones explicitly chosen by
  // name - without this, tapping "Add a player" right after a "position"
  // pick auto-resolved to that same player would double it up in the
  // give list (once auto-picked, once explicit) and double-count its value.
  const alreadyGivenIds = new Set((searchResult?.give ?? []).map((p) => p.playerId));

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">TRADE FINDER</Text>
      <Text className="text-white text-[21px] font-bold">Find a Fair Trade</Text>
      <Text className="text-gray-500 text-[12px] mt-1.5">
        Tell it what you'll give up and what you want back - it searches every other real roster in the league for the
        fairest real match, using real trade value and each team's own real needs.
      </Text>

      {loading ? (
        <ActivityIndicator color="#af1222" className="mt-8" />
      ) : (
        <>
          <Text className="text-gray-500 text-[11px] font-bold tracking-widest mt-5 mb-2">FINDING TRADES FOR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pb-2">
            {teams.map((t) => {
              const active = t.userId === selectedUserId;
              return (
                <Pressable
                  key={t.userId}
                  onPress={() => {
                    setSelectedUserId(t.userId);
                    setGiveItems([]);
                  }}
                  className="items-center"
                  style={{ width: 62 }}
                >
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

          {/* What you're offering */}
          <View className="mt-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-gray-500 text-[11px] font-bold tracking-widest">WHAT YOU'RE OFFERING</Text>
              {searchResult && searchResult.giveValue > 0 && (
                <Text className="text-white text-[12px] font-bold">{formatValue(searchResult.giveValue)} value</Text>
              )}
            </View>

            {resolvedGiveRows.length === 0 && (
              <Text className="text-gray-600 text-[12px] italic mb-2">Nothing added yet - add a player or a position below.</Text>
            )}
            <View className="gap-2 mb-2.5">
              {resolvedGiveRows.map(({ key, item, player }) => (
                <View key={key} className="flex-row items-center bg-[#141416] border border-white/10 rounded-xl px-3 py-2.5">
                  {player ? (
                    <>
                      <View style={{ backgroundColor: getTeamColor(player.team) }} className="w-9 h-9 rounded-full items-center justify-center overflow-hidden mr-2.5">
                        <Image
                          source={{ uri: playerPhotoUri(player.playerId, player.pos, player.team) }}
                          resizeMode={player.pos === "DEF" ? "contain" : "cover"}
                          style={player.pos === "DEF" ? { width: 22, height: 22 } : { width: 36, height: 36, borderRadius: 18 }}
                        />
                      </View>
                      <View className="flex-1 mr-2">
                        <Text numberOfLines={1} className="text-white text-[13px] font-semibold">
                          {leagueMeta?.playersData[player.playerId]?.fn} {leagueMeta?.playersData[player.playerId]?.ln}
                        </Text>
                        <Text className="text-gray-500 text-[10px] mt-0.5">
                          {item.kind === "position" ? `Auto-picked · ${player.pos}` : player.pos}
                          {player.team ? ` · ${player.team}` : ""}
                        </Text>
                      </View>
                      {player.value > 0 ? (
                        <Text className="text-white text-[12px] font-bold mr-2">{formatValue(player.value)}</Text>
                      ) : (
                        <Text className="text-gray-600 text-[10px] font-semibold mr-2 italic">no trade value</Text>
                      )}
                    </>
                  ) : (
                    <View className="flex-1 mr-2">
                      <Text className="text-gray-500 text-[12px] italic">
                        {item.kind === "position" ? `No valued ${item.pos} left on your roster` : "Player not found"}
                      </Text>
                    </View>
                  )}
                  <Pressable onPress={() => removeGiveItem(key)} hitSlop={8}>
                    <Feather name="x" size={15} color="#6b7280" />
                  </Pressable>
                </View>
              ))}
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setPlayerPickerOpen(true)}
                className="flex-1 flex-row items-center justify-center gap-1.5 border border-dashed border-white/15 rounded-xl py-2.5"
              >
                <Feather name="user-plus" size={13} color="#af1222" />
                <Text className="text-brand text-[12px] font-bold">Add a player</Text>
              </Pressable>
              <Pressable
                onPress={() => setPositionPickerOpen(true)}
                className="flex-1 flex-row items-center justify-center gap-1.5 border border-dashed border-white/15 rounded-xl py-2.5"
              >
                <Feather name="plus-circle" size={13} color="#af1222" />
                <Text className="text-brand text-[12px] font-bold">Add by position</Text>
              </Pressable>
            </View>
          </View>

          {/* What you want back */}
          <View className="mt-6">
            <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-2">WHAT YOU WANT BACK</Text>
            <View className="flex-row flex-wrap gap-2">
              {VALUED_POSITIONS.map((pos) => {
                const active = wantPositions.includes(pos);
                const color = getPositionColor(pos);
                return (
                  <Pressable
                    key={pos}
                    onPress={() => toggleWant(pos)}
                    style={{ backgroundColor: active ? color : "transparent", borderColor: color }}
                    className="px-3.5 py-2 rounded-full border"
                  >
                    <Text style={{ color: active ? "#fff" : color }} className="text-[12px] font-extrabold">
                      {pos}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Results */}
          <View className="mt-6">
            <Text className="text-gray-500 text-[11px] font-bold tracking-widest mb-2.5">SUGGESTED TRADES</Text>
            {resolvedGiveRows.filter((r) => r.player).length === 0 || wantPositions.length === 0 ? (
              <Text className="text-gray-600 text-[12px] italic">
                Add at least one player or position you're offering, and at least one position you want back.
              </Text>
            ) : !searchResult || searchResult.candidates.length === 0 ? (
              <Text className="text-gray-600 text-[12px] italic">
                No one in the league has a valued player at that position right now - try a different ask.
              </Text>
            ) : (
              <View className="gap-3">
                {searchResult.candidates.map((c) => (
                  <TradeCandidateCard
                    key={c.partnerUserId}
                    candidate={c}
                    partner={teams.find((t) => t.userId === c.partnerUserId)}
                    playersData={leagueMeta?.playersData ?? {}}
                    onPressPartner={() => router.push(`/profile/manager/${c.partnerUserId}`)}
                    onPressPlayer={(playerId, pos, team) => playerDetail?.openPlayer({ playerId, name: `${leagueMeta?.playersData[playerId]?.fn ?? ""} ${leagueMeta?.playersData[playerId]?.ln ?? ""}`.trim(), position: pos, team })}
                  />
                ))}
              </View>
            )}
          </View>
        </>
      )}

      <PlayerPickerModal
        visible={playerPickerOpen}
        playersData={leagueMeta?.playersData ?? {}}
        rosterPlayerIds={(myTeam?.rosterPlayerIds ?? []).filter((id) => !alreadyGivenIds.has(id))}
        onClose={() => setPlayerPickerOpen(false)}
        onPick={addPlayer}
      />

      <Modal visible={positionPickerOpen} transparent animationType="fade" onRequestClose={() => setPositionPickerOpen(false)}>
        <Pressable className="flex-1 bg-black/50 items-center justify-center px-6" onPress={() => setPositionPickerOpen(false)}>
          <Pressable className="bg-[#141416] rounded-2xl p-4 w-full" onPress={(e) => e.stopPropagation()}>
            <Text className="text-white text-[14px] font-bold mb-3">Trade away your best player at...</Text>
            <View className="flex-row flex-wrap gap-2">
              {VALUED_POSITIONS.map((pos) => {
                const color = getPositionColor(pos);
                return (
                  <Pressable
                    key={pos}
                    onPress={() => addPosition(pos)}
                    style={{ borderColor: color }}
                    className="px-4 py-2.5 rounded-full border"
                  >
                    <Text style={{ color }} className="text-[12px] font-extrabold">
                      {pos}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function PlayerPickerModal({
  visible,
  playersData,
  rosterPlayerIds,
  onClose,
  onPick,
}: {
  visible: boolean;
  playersData: Record<string, any>;
  rosterPlayerIds: string[];
  onClose: () => void;
  onPick: (playerId: string) => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = rosterPlayerIds.filter((pid) => {
      if (!q) return true;
      const p = playersData[pid];
      return `${p?.fn ?? ""} ${p?.ln ?? ""}`.toLowerCase().includes(q);
    });
    return ids.sort((a, b) => `${playersData[a]?.fn ?? ""} ${playersData[a]?.ln ?? ""}`.localeCompare(`${playersData[b]?.fn ?? ""} ${playersData[b]?.ln ?? ""}`));
  }, [rosterPlayerIds, playersData, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable className="bg-[#141416] rounded-t-3xl p-4" style={{ maxHeight: "75%" }} onPress={(e) => e.stopPropagation()}>
          <View className="w-10 h-1 rounded-full bg-white/20 self-center mb-3" />
          <Text className="text-white text-[15px] font-bold mb-3">Add a player from your roster</Text>
          <View className="flex-row items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5 mb-3">
            <Feather name="search" size={14} color="#6b7280" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your roster…"
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
                    <Image
                      source={{ uri: playerPhotoUri(pid, p?.pos, p?.t) }}
                      resizeMode={p?.pos === "DEF" ? "contain" : "cover"}
                      className="w-9 h-9 rounded-full"
                    />
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

function TradeCandidateCard({
  candidate,
  partner,
  playersData,
  onPressPartner,
  onPressPlayer,
}: {
  candidate: TradeCandidate;
  partner?: TeamOption;
  playersData: Record<string, any>;
  onPressPartner: () => void;
  onPressPlayer: (playerId: string, pos: string, team?: string) => void;
}) {
  const fairness = fairnessLabel(candidate.fairnessRatio);

  const PlayerRow = ({ playerId, pos, value, team }: { playerId: string; pos: string; value: number; team?: string }) => (
    <Pressable onPress={() => onPressPlayer(playerId, pos, team)} className="flex-row items-center gap-2.5 bg-[#0c0c0e] rounded-xl px-2.5 py-2 flex-1">
      <View style={{ backgroundColor: getTeamColor(team) }} className="w-8 h-8 rounded-full items-center justify-center overflow-hidden">
        <Image
          source={{ uri: playerPhotoUri(playerId, pos, team) }}
          resizeMode={pos === "DEF" ? "contain" : "cover"}
          style={pos === "DEF" ? { width: 20, height: 20 } : { width: 32, height: 32, borderRadius: 16 }}
        />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-white text-[12px] font-bold">
          {playersData[playerId]?.fn} {playersData[playerId]?.ln}
        </Text>
        <Text className="text-gray-500 text-[10px]">
          {pos}
          {team ? ` · ${team}` : ""} · {formatValue(value)}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View className="bg-[#141416] border border-white/10 rounded-2xl overflow-hidden">
      <Pressable onPress={onPressPartner} className="flex-row items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <Image source={partner?.avatar ? { uri: partner.avatar } : helmet} className="w-9 h-9 rounded-full" />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-white text-[14px] font-bold">
            {partner?.name ?? "Unknown"}
          </Text>
        </View>
        <View style={{ backgroundColor: `${fairness.color}22` }} className="px-2.5 py-1 rounded-full">
          <Text style={{ color: fairness.color }} className="text-[10px] font-extrabold">
            {fairness.text}
          </Text>
        </View>
      </Pressable>

      <View className="px-3.5 pb-2">
        <Text className="text-gray-500 text-[9px] font-bold tracking-wider mb-1.5">YOU GIVE</Text>
        <View className="gap-1.5">
          {candidate.give.map((p) => (
            <PlayerRow key={p.playerId} playerId={p.playerId} pos={p.pos} value={p.value} team={p.team} />
          ))}
        </View>
      </View>

      <View className="items-center py-1">
        <Feather name="repeat" size={13} color="#6b7280" />
      </View>

      <View className="px-3.5 pb-3">
        <Text className="text-gray-500 text-[9px] font-bold tracking-wider mb-1.5">YOU GET</Text>
        <View className="gap-1.5">
          {candidate.receive.map((p) => (
            <PlayerRow key={p.playerId} playerId={p.playerId} pos={p.pos} value={p.value} team={p.team} />
          ))}
        </View>
      </View>

      <View className="flex-row items-center justify-between px-3.5 py-2.5 bg-white/5">
        <Text className="text-gray-500 text-[11px]">
          {formatValue(candidate.giveValue)} <Text className="text-gray-600">for</Text> {formatValue(candidate.receiveValue)}
        </Text>
        <Text style={{ color: candidate.netValue >= 0 ? "#22c55e" : "#ef4444" }} className="text-[12px] font-extrabold">
          {candidate.netValue >= 0 ? "+" : ""}
          {formatValue(candidate.netValue)}
        </Text>
      </View>

      {candidate.reasons.length > 0 && (
        <View className="px-3.5 pb-3.5 gap-1">
          {candidate.reasons.map((reason, i) => (
            <View key={i} className="flex-row items-center gap-1.5">
              <Feather name="check-circle" size={10} color="#22c55e" />
              <Text className="text-gray-400 text-[11px]">{reason}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
