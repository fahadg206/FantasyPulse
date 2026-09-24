import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, Modal, ScrollView, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { getTeamColor, getTeamLogo, getPositionColor } from "../lib/nflTeams";
import { sleeper, backend } from "../lib/api";
import { getPlayerGameLog, getPlayerCareerStats, GameLogEntry, SeasonTotals } from "../lib/playerBoxScore";
import { getPlayerBio, formatHeight, PlayerBio } from "../lib/playerBio";
import { buildPlayerTransactionHistory } from "../lib/leagueTransactions";
import type { TickerEvent, TradeEvent } from "../lib/leagueTransactions";

interface Props {
  visible: boolean;
  onClose: () => void;
  leagueID: string;
  playerId?: string;
  name: string;
  position: string;
  team?: string;
  photoUri?: string;
}

type Tab = "summary" | "gamelog" | "team" | "history";
const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "summary", label: "SUMMARY", icon: "activity" },
  { key: "gamelog", label: "GAME LOG", icon: "list" },
  { key: "team", label: "TEAM", icon: "users" },
  { key: "history", label: "HISTORY", icon: "clock" },
];

/** how hot or cold a real positional rank reads - green top-5, yellow top-12, red outside that. */
function formColorForRank(rank: number | undefined): string {
  if (rank === undefined) return "#6b7280";
  if (rank <= 5) return "#4ade80";
  if (rank <= 12) return "#eab308";
  return "#ef4444";
}

interface RosterContext {
  owner?: { name: string; avatar?: string };
  teammates: { name: string; ownerName: string }[]; // real NFL teammates rostered by OTHER managers in this league
}

// Position-specific column groups for the game log table - the same shape
// Sleeper's own game log breaks a box score into (PASS / RUSH / REC), each
// column a real field already on RawPlayerStats.
const STAT_GROUPS: Record<string, { label: string; cols: { key: string; label: string }[] }[]> = {
  QB: [
    {
      label: "PASS",
      cols: [
        { key: "pass_att", label: "ATT" },
        { key: "pass_cmp", label: "CMP" },
        { key: "pass_yd", label: "YD" },
        { key: "pass_td", label: "TD" },
        { key: "pass_int", label: "INT" },
      ],
    },
    {
      label: "RUSH",
      cols: [
        { key: "rush_att", label: "ATT" },
        { key: "rush_yd", label: "YD" },
        { key: "rush_td", label: "TD" },
      ],
    },
  ],
  RB: [
    {
      label: "RUSH",
      cols: [
        { key: "rush_att", label: "ATT" },
        { key: "rush_yd", label: "YD" },
        { key: "rush_td", label: "TD" },
      ],
    },
    {
      label: "REC",
      cols: [
        { key: "rec_tgt", label: "TGT" },
        { key: "rec", label: "REC" },
        { key: "rec_yd", label: "YD" },
        { key: "rec_td", label: "TD" },
      ],
    },
  ],
  WR: [
    {
      label: "REC",
      cols: [
        { key: "rec_tgt", label: "TGT" },
        { key: "rec", label: "REC" },
        { key: "rec_yd", label: "YD" },
        { key: "rec_td", label: "TD" },
      ],
    },
    {
      label: "RUSH",
      cols: [
        { key: "rush_att", label: "ATT" },
        { key: "rush_yd", label: "YD" },
        { key: "rush_td", label: "TD" },
      ],
    },
  ],
};
STAT_GROUPS.TE = STAT_GROUPS.WR;

export default function PlayerDetailModal({ visible, onClose, leagueID, playerId, name, position, team, photoUri }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [loading, setLoading] = useState(true);
  const [bio, setBio] = useState<PlayerBio | null>(null);
  const [log, setLog] = useState<GameLogEntry[]>([]);
  const [rosterContext, setRosterContext] = useState<RosterContext>({ teammates: [] });
  const [season, setSeason] = useState("");
  const [scoringSettings, setScoringSettings] = useState<Record<string, number>>({});

  const [historyLoading, setHistoryLoading] = useState(false);
  const [txHistory, setTxHistory] = useState<TickerEvent[] | null>(null);
  const [career, setCareer] = useState<SeasonTotals[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTab("summary");
    setTxHistory(null);
    setCareer(null);
  }, [visible, playerId]);

  useEffect(() => {
    if (!visible || !playerId || !leagueID) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [{ data: league }, { data: nflState }, bioData, { data: users }, { data: rosters }, playersData] = await Promise.all([
          sleeper.getLeague(leagueID),
          sleeper.getNflState(),
          getPlayerBio(playerId),
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        setSeason(league.season);
        setScoringSettings(league.scoring_settings || {});
        setBio(bioData);

        const throughWeek = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const entries = await getPlayerGameLog(playerId, position, bioData?.team ?? team, league.season, throughWeek, league.scoring_settings || {});
        if (!cancelled) setLog(entries);

        // Real roster context, entirely from this league's own current rosters -
        // who owns this player here, and which of their real NFL teammates
        // someone else in the league happens to have rostered.
        const nameByRoster: Record<number, { name: string; avatar?: string }> = {};
        for (const roster of rosters) {
          const owner = users.find((u: any) => u.user_id === roster.owner_id);
          nameByRoster[roster.roster_id] = {
            name: owner?.display_name ?? "Unknown",
            avatar: owner?.avatar ? `https://sleepercdn.com/avatars/thumbs/${owner.avatar}` : undefined,
          };
        }
        let owner: RosterContext["owner"];
        const teammates: RosterContext["teammates"] = [];
        const myTeam = bioData?.team ?? team;
        for (const roster of rosters) {
          const isMine = (roster.players || []).includes(playerId);
          if (isMine) owner = nameByRoster[roster.roster_id];
          if (myTeam) {
            for (const pid of roster.players || []) {
              if (pid === playerId) continue;
              const p = playersData?.[pid];
              if (p?.t === myTeam && p?.pos !== "DEF") {
                teammates.push({ name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim(), ownerName: nameByRoster[roster.roster_id]?.name ?? "Unknown" });
              }
            }
          }
        }
        if (!cancelled) setRosterContext({ owner, teammates });
      } catch (error) {
        console.error("Error loading player detail:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, playerId, leagueID, position, team]);

  // History is a real multi-season crawl (trades/adds/drops + 5 years of
  // box scores) - lazy-loaded only once the tab is actually opened, not
  // paid for on every player card tap.
  useEffect(() => {
    if (tab !== "history" || !playerId || !leagueID || txHistory !== null) return;
    let cancelled = false;
    setHistoryLoading(true);

    Promise.all([
      buildPlayerTransactionHistory(leagueID, playerId).catch(() => []),
      season ? getPlayerCareerStats(playerId, season, scoringSettings).catch(() => []) : Promise.resolve([]),
    ]).then(([tx, careerStats]) => {
      if (cancelled) return;
      setTxHistory(tx);
      setCareer(careerStats);
      setHistoryLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [tab, playerId, leagueID, season, scoringSettings, txHistory]);

  const color = getTeamColor(team);
  const positionColor = getPositionColor(position);
  const logo = getTeamLogo(team);
  const resolvedPhoto =
    photoUri ?? (position === "DEF" ? logo ?? undefined : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`);

  const gamesPlayed = log.length;
  const totalPoints = log.reduce((s, g) => s + g.points, 0);
  const ppg = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
  const best = log.reduce((max, g) => (g.points > (max?.points ?? -Infinity) ? g : max), undefined as GameLogEntry | undefined);
  const maxPoints = Math.max(1, ...log.map((g) => g.points));
  const trend = [...log].reverse();
  const mostRecent = log[0]; // log is most-recent-first
  const formColor = formColorForRank(mostRecent?.posRank);

  const statGroups = STAT_GROUPS[position] ?? [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <SafeAreaView className="flex-1 bg-[#0c0c0e]" edges={["top", "bottom"]}>
          <LinearGradient colors={[color, color, "#0c0c0e"]} locations={[0, 0.65, 1]} className="overflow-hidden pt-3">
            {logo && (
              <Image
                source={{ uri: logo }}
                resizeMode="contain"
                style={{ position: "absolute", width: 160, height: 160, opacity: 0.22, right: -35, top: -35 }}
              />
            )}
            <View className="flex-row items-start px-5 pt-2 pb-3">
              <View style={{ borderColor: positionColor }} className="rounded-full border-2 p-0.5 mr-3">
                <Image
                  source={resolvedPhoto ? { uri: resolvedPhoto } : undefined}
                  className={position === "DEF" ? "w-[60px] h-[60px]" : "w-[60px] h-[60px] rounded-full bg-white/20"}
                  resizeMode={position === "DEF" ? "contain" : "cover"}
                />
              </View>
              <View className="flex-1">
                {rosterContext.owner && (
                  <View className="flex-row items-center gap-1 mb-0.5">
                    <Feather name="arrow-right" size={11} color="rgba(255,255,255,0.85)" />
                    <Text className="text-white/85 text-[12px] font-semibold">{rosterContext.owner.name}</Text>
                  </View>
                )}
                <Text className="text-white text-[20px] font-extrabold leading-6">{name}</Text>
                <View className="flex-row items-center gap-1.5 mt-1.5">
                  <View style={{ backgroundColor: positionColor }} className="px-2 py-0.5 rounded-md">
                    <Text className="text-white text-[11px] font-extrabold">{position}</Text>
                  </View>
                  <Text className="text-white/85 text-[12px] font-bold">
                    {team ?? "FA"}
                    {bio?.number ? ` · #${bio.number}` : ""}
                  </Text>
                </View>
              </View>
            </View>

            {bio && (
              <View className="flex-row px-5 pb-4">
                {bio.age !== undefined && <BioStat icon="calendar" label="AGE" value={String(bio.age)} />}
                {formatHeight(bio.height) && <BioStat icon="arrow-up" label="HEIGHT" value={formatHeight(bio.height)!} />}
                {bio.weight && <BioStat icon="disc" label="WEIGHT" value={`${bio.weight} lbs`} />}
                {bio.years_exp !== undefined && (
                  <BioStat icon="award" label="EXP" value={bio.years_exp === 0 ? "R" : String(bio.years_exp)} />
                )}
              </View>
            )}
          </LinearGradient>

          <View className="flex-row border-b border-white/10 px-2 bg-[#0c0c0e]">
            {TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} className="flex-1 items-center py-3 gap-1">
                <Feather name={t.icon} size={13} color={tab === t.key ? positionColor : "#6b7280"} />
                <Text className={`text-[10px] font-bold tracking-wide ${tab === t.key ? "text-white" : "text-gray-500"}`}>
                  {t.label}
                </Text>
                {tab === t.key && <View style={{ backgroundColor: positionColor }} className="h-[2.5px] w-full rounded-full mt-1" />}
              </Pressable>
            ))}
          </View>

          {loading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#af1222" />
            </View>
          ) : (
            <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
              {tab === "summary" && (
                <View className="px-5 pt-4">
                  <View
                    style={{ borderColor: `${positionColor}44` }}
                    className="border rounded-2xl p-4 mb-4 overflow-hidden"
                  >
                    <LinearGradient
                      colors={[`${positionColor}2e`, "transparent"]}
                      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                    />
                    <Text className="text-gray-400 text-[10px] font-bold tracking-widest mb-1.5">POINTS PER GAME</Text>
                    <View className="flex-row items-end justify-between">
                      <Text style={{ color: positionColor }} className="text-[44px] font-extrabold leading-none">
                        {ppg.toFixed(1)}
                      </Text>
                      {mostRecent?.posRank !== undefined && (
                        <View style={{ backgroundColor: `${formColor}22`, borderColor: `${formColor}55` }} className="border px-2.5 py-1.5 rounded-xl items-end">
                          <Text style={{ color: formColor }} className="text-[13px] font-extrabold">
                            #{mostRecent.posRank} at {position}
                          </Text>
                          <Text className="text-gray-500 text-[9px] font-semibold">Week {mostRecent.week}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View className="flex-row gap-2.5 mb-5">
                    <StatChip icon="calendar" label="GAMES" value={String(gamesPlayed)} color="#3b82f6" />
                    <StatChip icon="bar-chart-2" label="TOTAL" value={totalPoints.toFixed(1)} color={positionColor} />
                    <StatChip icon="star" label="BEST" value={best ? best.points.toFixed(1) : "-"} color="#eab308" />
                  </View>

                  {trend.length > 1 && (
                    <View className="bg-[#141416] border border-white/10 rounded-2xl p-4 mb-5">
                      <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-gray-400 text-[10px] font-bold tracking-widest">SEASON TREND</Text>
                        <View className="flex-row items-center gap-1.5">
                          <View style={{ backgroundColor: "#eab308" }} className="w-2 h-2 rounded-full" />
                          <Text className="text-gray-500 text-[9px] font-semibold">Best game</Text>
                        </View>
                      </View>
                      <View className="flex-row items-end gap-1.5 h-[70px]">
                        {trend.map((g) => {
                          const isBest = best && g.week === best.week;
                          return (
                            <View key={g.week} className="flex-1 items-center">
                              <View
                                style={{ height: Math.max(4, (g.points / maxPoints) * 60), backgroundColor: isBest ? "#eab308" : positionColor }}
                                className="w-full rounded-t-md opacity-90"
                              />
                              <Text className="text-gray-600 text-[8px] font-bold mt-1">{g.week}</Text>
                            </View>
                          );
                        })}
                      </View>
                      <View className="flex-row items-center gap-1.5 mt-3 pt-3 border-t border-white/5">
                        <Feather name="minus" size={10} color="#6b7280" />
                        <Text className="text-gray-500 text-[10px]">Averaging {ppg.toFixed(1)} PPG this season</Text>
                      </View>
                    </View>
                  )}

                  {log.length === 0 && <Text className="text-gray-500 text-[13px]">No games played yet this season.</Text>}
                </View>
              )}

              {tab === "gamelog" && (
                <View className="pt-4">
                  {log.length === 0 ? (
                    <Text className="text-gray-500 text-[13px] px-5">No games played yet this season.</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-5">
                      <View>
                        <View className="flex-row pb-1">
                          <HeaderCell width={40}>WK</HeaderCell>
                          <HeaderCell width={52}>OPP</HeaderCell>
                          <HeaderCell width={54}>FPTS</HeaderCell>
                          <HeaderCell width={48}>SNP%</HeaderCell>
                          <HeaderCell width={44}>RANK</HeaderCell>
                          {statGroups.map((g) => (
                            <View key={g.label} style={{ width: g.cols.length * 44 }} className="items-center">
                              <Text className="text-gray-600 text-[9px] font-bold">{g.label}</Text>
                            </View>
                          ))}
                        </View>
                        {statGroups.length > 0 && (
                          <View className="flex-row pb-1.5">
                            <View style={{ width: 40 + 52 + 54 + 48 + 44 }} />
                            {statGroups.map((g) =>
                              g.cols.map((c) => (
                                <HeaderCell key={c.key} width={44} sub>
                                  {c.label}
                                </HeaderCell>
                              ))
                            )}
                          </View>
                        )}
                        {log.map((g, i) => (
                          <View key={g.week} className={`flex-row items-center py-2 ${i !== 0 ? "border-t border-white/5" : ""}`}>
                            <Cell width={40} bold>
                              {g.week}
                            </Cell>
                            <Cell width={52}>{g.opponent ?? "-"}</Cell>
                            <Cell width={54} bold color={positionColor}>
                              {g.points.toFixed(1)}
                            </Cell>
                            <Cell width={48}>{g.snapPct !== undefined ? `${g.snapPct}%` : "-"}</Cell>
                            <Cell width={44} bold color={g.posRank !== undefined ? formColorForRank(g.posRank) : undefined}>
                              {g.posRank !== undefined ? `#${g.posRank}` : "-"}
                            </Cell>
                            {statGroups.map((grp) =>
                              grp.cols.map((c) => (
                                <Cell key={c.key} width={44}>
                                  {g.stats[c.key] !== undefined ? String(g.stats[c.key]) : "-"}
                                </Cell>
                              ))
                            )}
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              )}

              {tab === "team" && (
                <View className="px-5 pt-4">
                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">ROSTERED BY</Text>
                  {rosterContext.owner ? (
                    <View style={{ borderColor: `${positionColor}33` }} className="flex-row items-center gap-2.5 bg-[#141416] border rounded-2xl p-3 mb-5">
                      <Image
                        source={rosterContext.owner.avatar ? { uri: rosterContext.owner.avatar } : undefined}
                        style={{ borderColor: positionColor }}
                        className="w-9 h-9 rounded-full bg-white/10 border-2"
                      />
                      <Text className="text-white font-bold text-[14px]">{rosterContext.owner.name}</Text>
                    </View>
                  ) : (
                    <Text className="text-gray-500 text-[13px] mb-5">Not currently rostered in this league.</Text>
                  )}

                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">
                    {team ?? "TEAM"} TEAMMATES IN THIS LEAGUE
                  </Text>
                  {rosterContext.teammates.length === 0 ? (
                    <Text className="text-gray-500 text-[13px]">No other {team ?? ""} players rostered here.</Text>
                  ) : (
                    <View style={{ borderColor: `${positionColor}22` }} className="bg-[#141416] border rounded-2xl overflow-hidden">
                      {rosterContext.teammates.map((t, i) => (
                        <View key={i} className={`flex-row items-center justify-between px-3.5 py-2.5 ${i !== 0 ? "border-t border-white/5" : ""}`}>
                          <Text className="text-white text-[13px] font-semibold">{t.name}</Text>
                          <Text className="text-gray-500 text-[11px]">{t.ownerName}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {tab === "history" && (
                <View className="px-5 pt-4">
                  {historyLoading ? (
                    <View className="py-8 items-center">
                      <ActivityIndicator color="#af1222" />
                    </View>
                  ) : (
                    <>
                      <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">TRANSACTION HISTORY</Text>
                      {!txHistory || txHistory.length === 0 ? (
                        <Text className="text-gray-500 text-[13px] mb-5">No trades or waiver moves on record for this player.</Text>
                      ) : (
                        <View className="mb-5 gap-2.5">
                          {txHistory.map((event) => (
                            <TransactionCard key={event.id} event={event} />
                          ))}
                        </View>
                      )}

                      {career && career.length > 0 && (
                        <>
                          <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">CAREER</Text>
                          <View style={{ borderColor: `${positionColor}33` }} className="bg-[#141416] border rounded-2xl overflow-hidden">
                            <View className="flex-row px-3.5 py-2 border-b border-white/10">
                              <Text className="text-gray-600 text-[9px] font-bold w-[52px]">SEASON</Text>
                              <Text className="text-gray-600 text-[9px] font-bold flex-1 text-center">GP</Text>
                              <Text className="text-gray-600 text-[9px] font-bold flex-1 text-center">TOTAL</Text>
                              <Text className="text-gray-600 text-[9px] font-bold flex-1 text-center">PPG</Text>
                            </View>
                            {career.map((s, i) => (
                              <View key={s.season} className={`flex-row items-center px-3.5 py-2.5 ${i !== 0 ? "border-t border-white/5" : ""}`}>
                                <Text className="text-white text-[12px] font-bold w-[52px]">{s.season}</Text>
                                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-300 text-[12px] flex-1 text-center">
                                  {s.games}
                                </Text>
                                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-300 text-[12px] flex-1 text-center">
                                  {s.totalPoints.toFixed(1)}
                                </Text>
                                <Text style={{ fontVariant: ["tabular-nums"], color: positionColor }} className="text-[12px] font-extrabold flex-1 text-center">
                                  {s.ppg.toFixed(1)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          )}

          <Pressable onPress={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/30 items-center justify-center">
            <Feather name="x" size={16} color="#fff" />
          </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

function BioStat({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View className="mr-6">
      <View className="flex-row items-center gap-1">
        <Feather name={icon} size={9} color="rgba(255,255,255,0.6)" />
        <Text className="text-white/70 text-[9px] font-bold tracking-wide">{label}</Text>
      </View>
      <Text className="text-white text-[15px] font-extrabold mt-0.5">{value}</Text>
    </View>
  );
}

function StatChip({ icon, label, value, color }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; color: string }) {
  return (
    <View style={{ borderColor: `${color}33` }} className="flex-1 bg-[#141416] border rounded-xl py-3 items-center">
      <Feather name={icon} size={13} color={color} />
      <Text style={{ color }} className="font-extrabold text-[15px] mt-1.5">
        {value}
      </Text>
      <Text className="text-gray-500 text-[9px] font-bold tracking-wide mt-0.5">{label}</Text>
    </View>
  );
}

function HeaderCell({ children, width, sub }: { children: React.ReactNode; width: number; sub?: boolean }) {
  return (
    <View style={{ width }} className="items-center">
      <Text className={`text-gray-600 font-bold ${sub ? "text-[8px]" : "text-[9px]"}`}>{children}</Text>
    </View>
  );
}

function Cell({ children, width, bold, color }: { children: React.ReactNode; width: number; bold?: boolean; color?: string }) {
  return (
    <View style={{ width }} className="items-center">
      <Text
        style={{ fontVariant: ["tabular-nums"], color: color ?? (bold ? "#e5e7eb" : "#9ca3af") }}
        className={`text-[12px] ${bold ? "font-bold" : ""}`}
      >
        {children}
      </Text>
    </View>
  );
}

function TransactionCard({ event }: { event: TickerEvent }) {
  if (event.kind === "add" || event.kind === "drop") {
    const semanticColor = event.kind === "add" ? "#4ade80" : "#ef4444";
    return (
      <View style={{ borderColor: `${semanticColor}33` }} className="bg-[#141416] border rounded-2xl px-3.5 py-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name={event.kind === "add" ? "add-circle" : "remove-circle"} size={13} color={semanticColor} />
            <Text style={{ color: semanticColor }} className="text-[10px] font-extrabold tracking-wide">
              {event.kind === "add" ? "ADDED" : "DROPPED"}
            </Text>
          </View>
          <Text className="text-gray-600 text-[10px]">{new Date(event.timestamp).toLocaleDateString()}</Text>
        </View>
        <Text className="text-white text-[13px] mt-1.5">
          by <Text className="font-bold">{event.team.name}</Text>
        </Text>
      </View>
    );
  }

  // Narrowed by the early return above (add/drop both handled and
  // returned already) - cast rather than fight TS's control-flow analysis
  // through the (A | B) & C intersection shape TradeEvent is declared as.
  const trade = event as TradeEvent;
  let label: string;
  let assetLines: { team: string; gets: string[] }[];
  if (trade.kind === "trade2") {
    label = `${trade.teamA.name} ↔ ${trade.teamB.name}`;
    assetLines = [
      { team: trade.teamB.name, gets: trade.aGives.map((a) => a.label) },
      { team: trade.teamA.name, gets: trade.aGets.map((a) => a.label) },
    ];
  } else {
    label = trade.parts.map((p) => p.team.name).join(" ↔ ");
    assetLines = trade.parts.map((p) => ({ team: p.team.name, gets: p.receives.map((a) => a.label) }));
  }

  return (
    <View style={{ borderColor: "#3b82f633" }} className="bg-[#141416] border rounded-2xl px-3.5 py-3">
      <View className="flex-row items-center justify-between mb-1.5">
        <View className="flex-row items-center gap-1.5">
          <Ionicons name="swap-horizontal" size={13} color="#3b82f6" />
          <Text style={{ color: "#3b82f6" }} className="text-[10px] font-extrabold tracking-wide">
            TRADED
          </Text>
        </View>
        <Text className="text-gray-600 text-[10px]">{new Date(event.timestamp).toLocaleDateString()}</Text>
      </View>
      <Text className="text-white text-[13px] font-bold mb-1">{label}</Text>
      {assetLines.map((line, i) => (
        <Text key={i} numberOfLines={2} className="text-gray-400 text-[11px]">
          <Text className="font-semibold text-gray-300">{line.team}</Text> gets {line.gets.join(", ") || "—"}
        </Text>
      ))}
    </View>
  );
}
