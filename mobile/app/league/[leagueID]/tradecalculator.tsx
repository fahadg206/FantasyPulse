import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, Modal, FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather, FontAwesome } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import ManagerPicker, { PickableManager } from "../../../components/ManagerPicker";
import PlayerCard from "../../../components/PlayerCard";
import TradeHistory from "../../../components/TradeHistory";
import { displayName } from "../../../lib/getTopPerformers";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue, computeAdjustedValue } from "../../../lib/playerValue";
import { NON_STARTER_SLOTS } from "../../../lib/startSitAccuracy";
import {
  computeOptimalLineupAssignment,
  computeTeamNeeds,
  computeLeagueNeedBaseline,
  computeWinImpact,
  TeamNeedsResult,
} from "../../../lib/tradeAnalysis";
import {
  buildSeasonToDatePPG,
  computeRedraftTeamNeeds,
  computeLeagueRedraftNeedBaseline,
} from "../../../lib/redraftNeeds";
import { buildLeagueSimData, projectedLineupPoints, LeagueSimData, SimTeamInfo } from "../../../lib/leagueSimData";
import type { PlayerPos } from "../../../lib/draftProspects";

const helmet = require("../../../assets/images/helmet2.png");

interface Player {
  id: string;
  fn: string;
  ln: string;
  pos: string;
  t: string;
  value: number;
}

interface TradeItem {
  playerId: string;
  player: Player;
  fromUserId: string;
  toUserId: string;
}

const TEAM_ACCENTS = ["#af1222", "#3b82f6", "#eab308"];

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

function Stars({ value }: { value: number }) {
  const full = Math.floor(value / 2000);
  const remainder = value % 2000;
  const partial = remainder >= 500 ? (remainder >= 1500 ? 0.75 : remainder >= 1000 ? 0.5 : 0.25) : 0;
  return (
    <View className="flex-row gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <FontAwesome key={i} name="star" size={11} color="#eab308" />
      ))}
      {partial > 0 && <FontAwesome name="star-half-full" size={11} color="#eab308" />}
    </View>
  );
}

function fairnessVerdict(maxAbsNet: number) {
  if (maxAbsNet <= 1000) return { text: "Fair trade", color: "#22c55e" };
  if (maxAbsNet <= 2500) return { text: "Slightly lopsided", color: "#eab308" };
  if (maxAbsNet <= 5000) return { text: "Unfair", color: "#f97316" };
  return { text: "Highway robbery", color: "#ef4444" };
}

export default function TradeCalculator() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();

  // --- league-wide, loaded once ---
  const [users, setUsers] = useState<PickableManager[]>([]);
  const [playersData, setPlayersData] = useState<Record<string, any>>({});
  const [valueSettings, setValueSettings] = useState<LeagueValueSettings | null>(null);
  const [valuesBySleeperId, setValuesBySleeperId] = useState<Record<string, RawPlayerValue>>({});
  const [allRosters, setAllRosters] = useState<Record<string, { rosterPlayerIds: string[] }>>({});
  const [leagueAvgNeed, setLeagueAvgNeed] = useState<Record<PlayerPos, number> | null>(null);
  const [startingSlots, setStartingSlots] = useState<string[]>([]);
  const [projWeek, setProjWeek] = useState<number>(1);
  const [loadingLeague, setLoadingLeague] = useState(true);
  // Redraft-only inputs for team needs (see lib/redraftNeeds.ts) - unused
  // for a dynasty league, which reasons off KTC value instead.
  const [seasonToDatePPG, setSeasonToDatePPG] = useState<Record<string, number>>({});
  const [remainingWeeks, setRemainingWeeks] = useState<number[]>([]);

  // --- the trade itself ---
  const [teamIds, setTeamIds] = useState<(string | null)[]>([null, null]);
  const [items, setItems] = useState<TradeItem[]>([]);
  const [picker, setPicker] = useState<{ forTeam: string; chosenPlayerId?: string } | null>(null);
  const [expandedLineup, setExpandedLineup] = useState<Record<string, boolean>>({});

  // --- win-impact, fetched lazily + recomputed on trade edits ---
  const [simData, setSimData] = useState<LeagueSimData | null>(null);
  const [loadingSim, setLoadingSim] = useState(false);
  const [winImpactByTeam, setWinImpactByTeam] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, rostersRes, settings, values, playersDataRes, leagueRes, nflStateRes] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          getLeagueValueSettings(leagueID),
          backend.fetchAllPlayerValues(),
          backend.fetchPlayers(leagueID),
          sleeper.getLeague(leagueID),
          sleeper.getNflState(),
        ]);
        if (cancelled) return;

        setUsers(
          usersRes.data.map((u: any) => ({
            id: u.user_id,
            name: u.display_name,
            avatar: u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : undefined,
          }))
        );
        setPlayersData(playersDataRes);
        setValueSettings(settings);
        setValuesBySleeperId(values);

        const rosterMap: Record<string, { rosterPlayerIds: string[] }> = {};
        rostersRes.data.forEach((r: any) => {
          rosterMap[r.owner_id] = { rosterPlayerIds: r.players ?? [] };
        });
        setAllRosters(rosterMap);

        const managerInfoForNeeds: Record<string, SimTeamInfo> = {};
        rostersRes.data.forEach((r: any) => {
          managerInfoForNeeds[r.owner_id] = {
            name: "",
            rosterId: r.roster_id,
            rosterPlayerIds: r.players ?? [],
          };
        });

        const currentWeek: number = nflStateRes.data.display_week || 1;
        setStartingSlots((leagueRes.data.roster_positions || []).filter((p: string) => !NON_STARTER_SLOTS.has(p)));
        setProjWeek(currentWeek);

        // Team needs reasons completely differently depending on format -
        // see lib/redraftNeeds.ts for why a dynasty roster's long-term KTC
        // value says nothing useful about a redraft team's needs. Dynasty
        // needs the values fetch above and nothing else; redraft needs
        // real season-to-date box scores + rest-of-season projections,
        // which means fetching the same league-wide schedule data the
        // win-impact projection uses - fetched here eagerly for redraft
        // (so Needs badges aren't waiting on someone picking 2 teams
        // first) and reused as-is for win-impact later instead of being
        // fetched a second time.
        if (settings.isDynasty) {
          setLeagueAvgNeed(computeLeagueNeedBaseline(managerInfoForNeeds, playersDataRes, values, settings));
        } else {
          const sim = await buildLeagueSimData(leagueID);
          if (cancelled) return;
          setSimData(sim);
          const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
          const remaining = sim.weekNumbers.filter((w) => w >= currentWeek);
          const ppg = buildSeasonToDatePPG(sim.matchupData, playedWeeks);
          setSeasonToDatePPG(ppg);
          setRemainingWeeks(remaining);
          setLeagueAvgNeed(computeLeagueRedraftNeedBaseline(managerInfoForNeeds, playersDataRes, ppg, remaining));
        }
      } catch (error) {
        console.error("Error loading trade calculator data:", error);
      } finally {
        if (!cancelled) setLoadingLeague(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const activeTeamIds = teamIds.filter((id): id is string => !!id);

  // Fetch the heavier season-schedule/projection data (needed for real
  // win-impact) only once at least 2 teams are picked, and only once -
  // recomputing win impact on every trade edit after that reuses this,
  // it doesn't refetch it.
  useEffect(() => {
    if (!leagueID || activeTeamIds.length < 2 || simData) return;
    let cancelled = false;
    setLoadingSim(true);
    buildLeagueSimData(leagueID)
      .then((data) => {
        if (!cancelled) setSimData(data);
      })
      .catch((error) => console.error("Error building league sim data:", error))
      .finally(() => !cancelled && setLoadingSim(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueID, activeTeamIds.length]);

  // Reset the trade whenever the team lineup changes (swapping a team out
  // mid-build would otherwise leave stale items pointing at a team no
  // longer in the trade).
  useEffect(() => {
    setItems([]);
    setWinImpactByTeam({});
  }, [teamIds.join(",")]);

  function postTradeRoster(userId: string): string[] {
    const base = allRosters[userId]?.rosterPlayerIds ?? [];
    const leaving = new Set(items.filter((it) => it.fromUserId === userId).map((it) => it.playerId));
    const arriving = items.filter((it) => it.toUserId === userId).map((it) => it.playerId);
    return base.filter((id) => !leaving.has(id)).concat(arriving);
  }

  // Real projected-wins impact via the same deterministic engine Standings'
  // What-If uses - debounced off simData + the current trade so it doesn't
  // recompute on every single render, only once the trade settles for a
  // moment.
  useEffect(() => {
    if (!simData || activeTeamIds.length < 2) return;
    const handle = setTimeout(() => {
      const adjusted: Record<number, Record<string, number>> = {};
      for (const week of simData.weekNumbers) {
        adjusted[week] = { ...simData.projectionCache[week] };
      }
      for (const userId of activeTeamIds) {
        const roster = postTradeRoster(userId);
        for (const week of simData.weekNumbers) {
          adjusted[week][userId] = projectedLineupPoints(roster, week, playersData, simData.startingSlots);
        }
      }
      const next: Record<string, number | null> = {};
      for (const userId of activeTeamIds) {
        const impact = computeWinImpact(
          simData.teamIds,
          simData.managerInfo,
          simData.matchupData,
          simData.projectionCache,
          adjusted,
          simData.playoffStartWeek,
          userId
        );
        next[userId] = impact.winsDelta;
      }
      setWinImpactByTeam(next);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simData, items, activeTeamIds.join(",")]);

  const destinationsFor = (fromUserId: string) => activeTeamIds.filter((id) => id !== fromUserId);

  const addPlayer = (fromUserId: string, playerId: string, toUserId: string) => {
    const meta = playersData[playerId];
    if (!meta) return;
    const raw = valuesBySleeperId[playerId] ?? {};
    const value = valueSettings ? computeAdjustedValue(raw, valueSettings) : 0;
    const player: Player = { id: playerId, fn: meta.fn, ln: meta.ln, pos: meta.pos, t: meta.t, value };
    setItems((prev) => [...prev, { playerId, player, fromUserId, toUserId }]);
    setPicker(null);
  };

  const removeItem = (playerId: string, fromUserId: string) => {
    setItems((prev) => prev.filter((it) => !(it.playerId === playerId && it.fromUserId === fromUserId)));
  };

  if (!leagueID) return null;

  if (loadingLeague) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  const pickerRoster = picker
    ? (allRosters[picker.forTeam]?.rosterPlayerIds ?? []).filter(
        (id) => !items.some((it) => it.fromUserId === picker.forTeam && it.playerId === id)
      )
    : [];
  const pickerDestinations = picker ? destinationsFor(picker.forTeam) : [];

  // Dynasty reasons off real KTC trade value (lib/tradeAnalysis.ts, the
  // same "best real player at a position vs. the league's own bar" logic
  // the Draft Lottery board uses); redraft has no long-term asset value to
  // speak of, so it reasons off real season-to-date box scores blended
  // with rest-of-season projections instead (lib/redraftNeeds.ts) - a
  // genuinely different question, not the same formula relabeled.
  const getTeamNeeds = (rosterPlayerIds: string[]): TeamNeedsResult => {
    if (valueSettings?.isDynasty) {
      return computeTeamNeeds(rosterPlayerIds, playersData, valuesBySleeperId, valueSettings, leagueAvgNeed!);
    }
    return computeRedraftTeamNeeds(rosterPlayerIds, playersData, seasonToDatePPG, remainingWeeks, leagueAvgNeed!);
  };

  const netValueByTeam: Record<string, number> = {};
  activeTeamIds.forEach((id) => {
    const out = items.filter((it) => it.fromUserId === id).reduce((s, it) => s + it.player.value, 0);
    const inn = items.filter((it) => it.toUserId === id).reduce((s, it) => s + it.player.value, 0);
    netValueByTeam[id] = inn - out;
  });
  const maxAbsNet = Math.max(0, ...activeTeamIds.map((id) => Math.abs(netValueByTeam[id] ?? 0)));
  const verdict = fairnessVerdict(maxAbsNet);
  const hasAnyItems = items.length > 0;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <View className="mb-1">
        <Text className="text-[11px] font-bold tracking-widest text-brand">TRADE CALCULATOR</Text>
        <Text className="text-white text-[21px] font-bold mt-0.5">Build a Trade</Text>
        <Text className="text-gray-500 text-[12px] mt-1">
          Real trade values, real projected lineup + win impact, and each team&apos;s real needs - up to 3 teams.
        </Text>
        {valueSettings && (
          <Text className="text-gray-600 text-[11px] mt-1.5">
            {valueSettings.isDynasty
              ? "Needs are based on long-term dynasty value at each position vs. the league's own bar."
              : "Needs are based on real season-to-date scoring blended with rest-of-season projections - no long-term value to lean on in redraft."}
          </Text>
        )}
      </View>

      <View className="flex-row flex-wrap gap-2.5 mt-4 mb-2">
        {teamIds.map((id, slot) => (
          <ManagerPicker
            key={slot}
            label={`Team ${slot + 1}`}
            options={users.filter((u) => !teamIds.some((t, i) => t === u.id && i !== slot))}
            selectedId={id}
            onSelect={(newId) =>
              setTeamIds((prev) => prev.map((t, i) => (i === slot ? newId : t)))
            }
          />
        ))}
        {teamIds.length === 2 ? (
          <Pressable
            onPress={() => setTeamIds((prev) => [...prev, null])}
            className="flex-row items-center gap-1.5 border-2 border-dashed border-white/15 rounded-xl px-3 py-2.5"
          >
            <Feather name="plus" size={14} color="#9ca3af" />
            <Text className="text-gray-400 text-[12px] font-semibold">3rd team</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setTeamIds((prev) => prev.slice(0, 2))}
            className="flex-row items-center gap-1.5 border-2 border-dashed border-white/15 rounded-xl px-3 py-2.5"
          >
            <Feather name="minus" size={14} color="#9ca3af" />
            <Text className="text-gray-400 text-[12px] font-semibold">Remove</Text>
          </Pressable>
        )}
      </View>

      {activeTeamIds.length >= 2 && leagueAvgNeed && valueSettings && (
        <View className="gap-3 mt-3">
          {activeTeamIds.map((userId, i) => {
            const user = users.find((u) => u.id === userId);
            const accent = TEAM_ACCENTS[i % TEAM_ACCENTS.length];
            const outgoing = items.filter((it) => it.fromUserId === userId);
            const incoming = items.filter((it) => it.toUserId === userId);
            const roster = allRosters[userId]?.rosterPlayerIds ?? [];
            const needs: TeamNeedsResult = getTeamNeeds(roster);
            const notableNeeds = needs.ranked.filter((n) => n.score > 0.15).slice(0, 2);

            const afterRoster = postTradeRoster(userId);
            const beforePts = projectedLineupPoints(roster, projWeek, playersData, startingSlots);
            const afterPts = projectedLineupPoints(afterRoster, projWeek, playersData, startingSlots);
            const ptsDelta = afterPts - beforePts;
            const winsDelta = winImpactByTeam[userId];
            const netValue = netValueByTeam[userId] ?? 0;
            const lineup = computeOptimalLineupAssignment(
              afterRoster,
              Object.fromEntries(
                afterRoster.map((id) => [id, parseFloat(playersData[id]?.wi?.[projWeek.toString()]?.p ?? "0")])
              ),
              Object.fromEntries(afterRoster.map((id) => [id, playersData[id]?.pos])),
              startingSlots
            );

            return (
              <View key={userId} style={{ borderColor: `${accent}33` }} className="bg-[#141416] border rounded-2xl overflow-hidden">
                <View className="flex-row items-center gap-3 px-4 pt-4 pb-3">
                  <Image source={user?.avatar ? { uri: user.avatar } : helmet} className="w-[40px] h-[40px] rounded-full" />
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-white text-[15px] font-bold">
                      {user?.name}
                    </Text>
                    <Text className="text-[11px] mt-0.5" style={{ color: netValue >= 0 ? "#22c55e" : "#ef4444" }}>
                      {incoming.length > 0 || outgoing.length > 0
                        ? `${incoming.length > 0 ? `+${incoming.length}` : "0"} players · Value ${netValue >= 0 ? "+" : ""}${formatValue(netValue)}`
                        : "No changes yet"}
                    </Text>
                  </View>
                </View>

                {notableNeeds.length > 0 && (
                  <View className="flex-row items-center gap-1.5 px-4 pb-3">
                    <Feather name="alert-circle" size={11} color="#eab308" />
                    <Text className="text-[10px] text-gray-500">
                      Needs: <Text className="text-yellow-500 font-bold">{notableNeeds.map((n) => n.pos).join(", ")}</Text>
                    </Text>
                  </View>
                )}

                <View className="px-4 pb-3">
                  <Pressable
                    onPress={() => setPicker({ forTeam: userId })}
                    className="flex-row items-center justify-center gap-1.5 border-2 border-brand rounded-xl py-2 mb-2.5"
                  >
                    <Feather name="plus" size={13} color="#af1222" />
                    <Text className="text-brand text-[12px] font-semibold">Send a player from {user?.name}</Text>
                  </Pressable>

                  {outgoing.length > 0 && (
                    <View className="gap-2 mb-2.5">
                      <Text className="text-[10px] font-bold tracking-wider text-gray-500">SENDING</Text>
                      {outgoing.map((it) => (
                        <PlayerCard
                          key={it.playerId}
                          playerId={it.playerId}
                          name={displayName(it.player)}
                          position={it.player.pos}
                          team={it.player.t}
                          bottomSlot={
                            <View className="flex-row items-center gap-2 mt-0.5">
                              <Stars value={it.player.value} />
                              {activeTeamIds.length === 3 && (
                                <Text className="text-white/70 text-[9px]">→ {users.find((u) => u.id === it.toUserId)?.name}</Text>
                              )}
                            </View>
                          }
                          rightSlot={
                            <Pressable onPress={() => removeItem(it.playerId, it.fromUserId)} hitSlop={8}>
                              <Feather name="x-circle" size={18} color="#ffffff" />
                            </Pressable>
                          }
                        />
                      ))}
                    </View>
                  )}

                  {incoming.length > 0 && (
                    <View className="gap-2">
                      <Text className="text-[10px] font-bold tracking-wider text-gray-500">RECEIVING</Text>
                      {incoming.map((it) => (
                        <PlayerCard
                          key={it.playerId}
                          playerId={it.playerId}
                          name={displayName(it.player)}
                          position={it.player.pos}
                          team={it.player.t}
                          bottomSlot={
                            <View className="flex-row items-center gap-2 mt-0.5">
                              <Stars value={it.player.value} />
                              {activeTeamIds.length === 3 && (
                                <Text className="text-white/70 text-[9px]">← {users.find((u) => u.id === it.fromUserId)?.name}</Text>
                              )}
                            </View>
                          }
                          rightSlot={
                            <Pressable onPress={() => removeItem(it.playerId, it.fromUserId)} hitSlop={8}>
                              <Feather name="x-circle" size={18} color="#ffffff" />
                            </Pressable>
                          }
                        />
                      ))}
                    </View>
                  )}
                </View>

                {hasAnyItems && (outgoing.length > 0 || incoming.length > 0) && (
                  <>
                    <View className="flex-row border-t border-white/10">
                      <StatTile
                        label="LINEUP PTS"
                        value={`${ptsDelta >= 0 ? "+" : ""}${ptsDelta.toFixed(1)}`}
                        color={ptsDelta >= 0 ? "#22c55e" : "#ef4444"}
                        divider={false}
                      />
                      <StatTile
                        label="PROJ. WINS"
                        value={winsDelta === undefined || winsDelta === null ? (loadingSim ? "…" : "-") : `${winsDelta >= 0 ? "+" : ""}${winsDelta}`}
                        color={!winsDelta ? "#6b7280" : winsDelta > 0 ? "#22c55e" : "#ef4444"}
                      />
                      <StatTile label="VALUE" value={`${netValue >= 0 ? "+" : ""}${formatValue(netValue)}`} color={netValue >= 0 ? "#22c55e" : "#ef4444"} />
                    </View>

                    <Pressable
                      onPress={() => setExpandedLineup((p) => ({ ...p, [userId]: !p[userId] }))}
                      className="flex-row items-center justify-center gap-1.5 py-2.5 border-t border-white/10"
                    >
                      <Feather name={expandedLineup[userId] ? "chevron-up" : "chevron-down"} size={13} color="#9ca3af" />
                      <Text className="text-gray-400 text-[11px] font-semibold">
                        {expandedLineup[userId] ? "Hide" : "Preview"} projected starting lineup
                      </Text>
                    </Pressable>

                    {expandedLineup[userId] && (
                      <View className="px-4 pb-4 gap-1.5">
                        {lineup.map((slot, i) => {
                          const meta = slot.playerId ? playersData[slot.playerId] : null;
                          const isNew = slot.playerId && incoming.some((it) => it.playerId === slot.playerId);
                          return (
                            <View key={i} className="flex-row items-center justify-between py-1">
                              <View className="flex-row items-center gap-2">
                                <Text className="text-gray-500 text-[10px] font-bold w-[46px]">{slot.slot}</Text>
                                <Text numberOfLines={1} className={`text-[12px] max-w-[150px] ${isNew ? "text-brand font-bold" : "text-white"}`}>
                                  {meta ? `${meta.fn} ${meta.ln}` : "Empty"}
                                </Text>
                                {isNew && <Feather name="arrow-up-right" size={11} color="#af1222" />}
                              </View>
                              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[11px]">
                                {slot.points.toFixed(1)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })}

          {hasAnyItems && (
            <View
              style={{ backgroundColor: `${verdict.color}18`, borderColor: verdict.color }}
              className="self-center px-4 py-1.5 rounded-full border"
            >
              <Text style={{ color: verdict.color }} className="font-bold text-[13px]">
                {verdict.text}
              </Text>
            </View>
          )}
        </View>
      )}

      {leagueID && (
        <View className="mt-2">
          <TradeHistory
            leagueID={leagueID}
            userIds={activeTeamIds.length === 2 ? [activeTeamIds[0], activeTeamIds[1]] : undefined}
          />
        </View>
      )}

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setPicker(null)}>
          <Pressable className="bg-[#150f0f] rounded-t-2xl max-h-[75%]" onPress={() => {}}>
            {picker && picker.chosenPlayerId ? (
              <>
                <Text className="text-center font-bold py-3 border-b border-white/10 text-white">Send to which team?</Text>
                <View className="p-4 gap-2.5">
                  {pickerDestinations.map((toId) => {
                    const u = users.find((x) => x.id === toId);
                    return (
                      <Pressable
                        key={toId}
                        onPress={() => addPlayer(picker.forTeam, picker.chosenPlayerId!, toId)}
                        className="flex-row items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5"
                      >
                        <Image source={u?.avatar ? { uri: u.avatar } : helmet} className="w-[30px] h-[30px] rounded-full" />
                        <Text className="text-white font-semibold">{u?.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <>
                <Text className="text-center font-bold py-3 border-b border-white/10 text-white">Add a player</Text>
                <FlatList
                  data={pickerRoster}
                  keyExtractor={(id) => id}
                  contentContainerClassName="p-3 gap-2"
                  renderItem={({ item: playerId }) => {
                    const player = playersData[playerId];
                    if (!player || !picker) return null;
                    const isNeed =
                      leagueAvgNeed && pickerDestinations.length === 1
                        ? getTeamNeeds(allRosters[pickerDestinations[0]]?.rosterPlayerIds ?? []).scores[
                            player.pos as PlayerPos
                          ] > 0.15
                        : false;
                    return (
                      <Pressable
                        onPress={() => {
                          const dests = destinationsFor(picker.forTeam);
                          if (dests.length === 1) addPlayer(picker.forTeam, playerId, dests[0]);
                          else setPicker({ forTeam: picker.forTeam, chosenPlayerId: playerId });
                        }}
                        className="mb-2"
                      >
                        <PlayerCard
                          playerId={playerId}
                          name={displayName(player)}
                          position={player.pos}
                          team={player.t}
                          bottomSlot={
                            isNeed ? (
                              <Text className="text-yellow-400 text-[9px] font-bold mt-0.5">FILLS A NEED</Text>
                            ) : undefined
                          }
                          rightSlot={<Feather name="plus-circle" size={20} color="#ffffff" />}
                        />
                      </Pressable>
                    );
                  }}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function StatTile({
  label,
  value,
  color,
  divider = true,
}: {
  label: string;
  value: string;
  color: string;
  divider?: boolean;
}) {
  return (
    <View className={`flex-1 items-center py-2.5 ${divider ? "border-l border-white/10" : ""}`}>
      <Text style={{ color, fontVariant: ["tabular-nums"] }} className="text-[15px] font-bold">
        {value}
      </Text>
      <Text className="text-gray-500 text-[9px] font-bold tracking-wide mt-0.5">{label}</Text>
    </View>
  );
}
