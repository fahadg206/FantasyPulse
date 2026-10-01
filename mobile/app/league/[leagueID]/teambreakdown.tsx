// Team Breakdown - one manager, every real analytics engine this app
// already trusts elsewhere (power rankings, strength of schedule, Monte
// Carlo playoff odds, career history, trade grading) pulled into a single
// dashboard instead of scattered across five different screens. Nothing
// here is a new formula - every number traces back to the same lib/*.ts
// engines Power Rankings, Strength of Schedule, Standings, League Managers,
// and the Trade Calculator already use, so a number on this page always
// agrees with the same number shown anywhere else in the app.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle, Path, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue } from "../../../lib/playerValue";
import { buildLeagueSimData, LeagueSimData } from "../../../lib/leagueSimData";
import { runMonteCarlo } from "../../../lib/whatIfSimulation";
import { computeStrengthOfSchedule, TeamSOS, SOSTier } from "../../../lib/strengthOfSchedule";
import { bestValueByPosition, computeLeagueNeedBaseline } from "../../../lib/tradeAnalysis";
import {
  buildSeasonToDatePPG,
  bestRedraftScoreByPosition,
  computeLeagueRedraftNeedBaseline,
} from "../../../lib/redraftNeeds";
import { getManagerHistory, ManagerAllTimeStats } from "../../../lib/getManagerHistory";
import { getCurrentSeasonExtras, CurrentSeasonExtras } from "../../../lib/getCurrentSeasonExtras";
import { buildLeagueTransactions, buildAllSeasonsTradesForUser, TickerEvent, TradeEvent } from "../../../lib/leagueTransactions";
import { buildTradeValueLookup, TradeValueLookup } from "../../../lib/tradeValue";
import { gradeTrade, TradeGrade } from "../../../lib/tradeGrade";
import { TradeHistoryCard } from "../../../components/TradeHistory";
import type { PowerRankingTier } from "../../../lib/powerRankings";
import type { PlayerPos } from "../../../lib/draftProspects";

const helmet = require("../../../assets/images/helmet2.png");
const POSITIONS: PlayerPos[] = ["QB", "RB", "WR", "TE"];

// Same real colors this exact vocabulary uses everywhere else in the app
// (Power Rankings / League Managers / Strength of Schedule) - one look for
// "how good is this team" / "how hard is this schedule" everywhere it shows up.
const TIER_META: Record<PowerRankingTier, { color: string; icon: keyof typeof Feather.glyphMap; blurb: string }> = {
  Contender: { color: "#22c55e", icon: "award", blurb: "Built to win now" },
  "Playoff Contender": { color: "#3b82f6", icon: "shield", blurb: "In the mix for October" },
  "Middle of the Pack": { color: "#eab308", icon: "minus", blurb: "Could go either way" },
  Rebuild: { color: "#ef4444", icon: "tool", blurb: "Playing for next year" },
  "No Chance": { color: "#ef4444", icon: "trending-down", blurb: "Out of it this season" },
};
const SOS_TIER_COLOR: Record<SOSTier, string> = {
  "Tough Matchup": "#ef4444",
  Underdog: "#f97316",
  "Could Go Either Way": "#eab308",
  Favorite: "#4ade80",
  Cakewalk: "#15803d",
};

function eventInvolvesUser(event: TradeEvent, userId: string): boolean {
  return event.kind === "trade2"
    ? event.teamA.userId === userId || event.teamB.userId === userId
    : event.parts.some((p) => p.team.userId === userId);
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) return `${v < 0 ? "-" : ""}${(Math.abs(v) / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

function Section({ title, icon, children }: { title: string; icon: keyof typeof Feather.glyphMap; children: React.ReactNode }) {
  return (
    <View className="bg-[#141416] border border-white/10 rounded-2xl p-4 mt-3">
      <View className="flex-row items-center gap-1.5 mb-3">
        <Feather name={icon} size={12} color="#af1222" />
        <Text className="text-gray-500 text-[10px] font-bold tracking-widest">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function RadialGauge({
  value,
  size = 112,
  stroke = 11,
  color,
  sublabel,
  suffix = "",
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  sublabel: string;
  suffix?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const arc = (clamped / 100) * circumference;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#232326" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${arc} ${circumference - arc}`}
          strokeLinecap="round"
          originX={size / 2}
          originY={size / 2}
          rotation={-90}
        />
      </Svg>
      <View style={{ position: "absolute" }} className="items-center">
        <Text style={{ color, fontVariant: ["tabular-nums"] }} className="text-[22px] font-extrabold">
          {Math.round(clamped)}
          <Text className="text-[12px]">{suffix}</Text>
        </Text>
        <Text className="text-gray-500 text-[8px] font-bold tracking-wide text-center">{sublabel}</Text>
      </View>
    </View>
  );
}

function HBar({
  label,
  value,
  max,
  color,
  valueLabel,
  markerPct,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  valueLabel: string;
  markerPct?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View className="mb-3 last:mb-0">
      <View className="flex-row justify-between mb-1">
        <Text className="text-gray-400 text-[11px] font-bold">{label}</Text>
        <Text style={{ color }} className="text-[11px] font-bold">
          {valueLabel}
        </Text>
      </View>
      <View className="h-2 rounded-full bg-white/10 overflow-hidden">
        <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full" />
      </View>
      {markerPct !== undefined && (
        <View style={{ position: "absolute", left: `${Math.max(0, Math.min(100, markerPct))}%`, bottom: 0 }} className="w-[2px] h-2 bg-white/60" />
      )}
    </View>
  );
}

function TrendChart({ values, avg, color }: { values: number[]; avg: number; color: string }) {
  const w = 320;
  const h = 108;
  const pad = 10;
  if (values.length === 0) {
    return (
      <View style={{ height: h }} className="items-center justify-center">
        <Text className="text-gray-600 text-[11px]">No games played yet</Text>
      </View>
    );
  }
  const max = Math.max(...values, avg) * 1.08 || 1;
  const min = Math.min(...values, avg, 0) * 0.92;
  const range = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: pad + i * stepX, y: pad + (1 - (v - min) / range) * (h - pad * 2) }));
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const last = pts[pts.length - 1];
  const areaD = `${lineD} L${last.x},${h - pad} L${pts[0].x},${h - pad} Z`;
  const avgY = pad + (1 - (avg - min) / range) * (h - pad * 2);
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={areaD} fill="url(#trendFill)" />
      <Line x1={pad} y1={avgY} x2={w - pad} y2={avgY} stroke="#6b7280" strokeWidth={1} strokeDasharray="4 4" />
      <Path d={lineD} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}
    </Svg>
  );
}

export default function TeamBreakdown() {
  const { leagueID, userId: paramUserId } = useLocalSearchParams<{ leagueID: string; userId?: string }>();
  const router = useRouter();

  const [users, setUsers] = useState<{ id: string; name: string; avatar?: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [valueSettings, setValueSettings] = useState<LeagueValueSettings | null>(null);
  const [valuesBySleeperId, setValuesBySleeperId] = useState<Record<string, RawPlayerValue>>({});
  const [playersData, setPlayersData] = useState<Record<string, any>>({});
  const [simData, setSimData] = useState<LeagueSimData | null>(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [managerHistory, setManagerHistory] = useState<Record<string, ManagerAllTimeStats>>({});
  const [sosTeams, setSosTeams] = useState<TeamSOS[]>([]);
  const [playoffOdds, setPlayoffOdds] = useState<Record<string, number>>({});
  const [divisionOdds, setDivisionOdds] = useState<Record<string, number>>({});
  const [avgPointsFor, setAvgPointsFor] = useState<Record<string, number>>({});
  const [needBaseline, setNeedBaseline] = useState<Record<PlayerPos, number> | null>(null);
  const [seasonToDatePPG, setSeasonToDatePPG] = useState<Record<string, number>>({});
  const [remainingWeeks, setRemainingWeeks] = useState<number[]>([]);
  const [transactions, setTransactions] = useState<TickerEvent[]>([]);
  const [valueFor, setValueFor] = useState<TradeValueLookup | null>(null);
  const [loading, setLoading] = useState(true);

  // Trade activity has two scopes - this season (already crawled above as
  // part of `transactions`) and all-time (a real multi-season crawl across
  // the league's previous_league_id chain, lazily fetched and cached per
  // manager only once the toggle is actually switched to it).
  const [tradeScope, setTradeScope] = useState<"season" | "allTime">("season");
  const [allTimeTradesByUser, setAllTimeTradesByUser] = useState<Record<string, TradeEvent[]>>({});
  const [allTimeTradesLoading, setAllTimeTradesLoading] = useState(false);

  const [extras, setExtras] = useState<CurrentSeasonExtras | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, settings, values, playersDataRes, history, sim, txs, nflStateRes] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          getLeagueValueSettings(leagueID),
          backend.fetchAllPlayerValues(),
          backend.fetchPlayers(leagueID),
          getManagerHistory(leagueID),
          buildLeagueSimData(leagueID),
          buildLeagueTransactions(leagueID),
          sleeper.getNflState(),
        ]);
        if (cancelled) return;

        const userList = usersRes.data.map((u: any) => ({
          id: u.user_id,
          name: u.display_name,
          avatar: u.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : undefined,
        }));
        setUsers(userList);
        setValueSettings(settings);
        setValuesBySleeperId(values);
        setPlayersData(playersDataRes);
        setManagerHistory(history);
        setSimData(sim);
        setTransactions(txs);

        const lookup = await buildTradeValueLookup(settings, values);
        if (cancelled) return;
        setValueFor(() => lookup);

        const week: number = nflStateRes.data.season_type === "post" ? 18 : nflStateRes.data.display_week || 1;
        setCurrentWeek(week);
        setSosTeams(computeStrengthOfSchedule(sim, week));

        const sim1000 = runMonteCarlo(
          sim.teamIds,
          sim.managerInfo,
          sim.matchupData,
          sim.projectionCache,
          sim.playoffStartWeek,
          sim.playoffSpots,
          sim.divisionsCount,
          {},
          1000
        );
        setPlayoffOdds(sim1000.playoffOdds);
        setDivisionOdds(sim1000.divisionOdds);
        setAvgPointsFor(sim1000.avgPointsFor);

        if (settings.isDynasty) {
          setNeedBaseline(computeLeagueNeedBaseline(sim.managerInfo, playersDataRes, values, settings));
        } else {
          const playedWeeks = sim.weekNumbers.filter((w) => w < week);
          const remaining = sim.weekNumbers.filter((w) => w >= week);
          const ppg = buildSeasonToDatePPG(sim.matchupData, playedWeeks);
          setSeasonToDatePPG(ppg);
          setRemainingWeeks(remaining);
          setNeedBaseline(computeLeagueRedraftNeedBaseline(sim.managerInfo, playersDataRes, ppg, remaining));
        }

        const initial = paramUserId && userList.some((u: any) => u.id === paramUserId) ? paramUserId : userList[0]?.id ?? null;
        setSelectedId((prev) => prev ?? initial);
      } catch (error) {
        console.error("Error loading team breakdown data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueID]);

  useEffect(() => {
    if (!leagueID || !selectedId) return;
    let cancelled = false;
    setExtrasLoading(true);
    getCurrentSeasonExtras(leagueID, selectedId)
      .then((e) => {
        if (!cancelled) setExtras(e);
      })
      .catch((error) => console.error("Error loading GM scout extras:", error))
      .finally(() => !cancelled && setExtrasLoading(false));
    return () => {
      cancelled = true;
    };
  }, [leagueID, selectedId]);

  useEffect(() => {
    if (tradeScope !== "allTime" || !leagueID || !selectedId || allTimeTradesByUser[selectedId]) return;
    let cancelled = false;
    setAllTimeTradesLoading(true);
    buildAllSeasonsTradesForUser(leagueID, selectedId)
      .then((trades) => {
        if (!cancelled) setAllTimeTradesByUser((prev) => ({ ...prev, [selectedId]: trades }));
      })
      .catch((error) => console.error("Error loading all-time trades:", error))
      .finally(() => !cancelled && setAllTimeTradesLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeScope, leagueID, selectedId]);

  const selectedUser = users.find((u) => u.id === selectedId);
  const roster = selectedId ? simData?.managerInfo[selectedId]?.rosterPlayerIds ?? [] : [];
  const history = selectedId ? managerHistory[selectedId] : undefined;
  const sos = selectedId ? sosTeams.find((t) => t.userId === selectedId) : undefined;
  const tier = extras?.tier ?? null;
  const rankOf = extras?.allRankings.length ?? users.length;

  const weeklyValues = useMemo(() => {
    if (!simData || !selectedId) return [];
    return simData.weekNumbers
      .filter((w) => w < currentWeek)
      .map((w) => parseFloat(simData.matchupData[w]?.[selectedId]?.team_points || "0"))
      .filter((v) => v > 0);
  }, [simData, selectedId, currentWeek]);

  const leagueAvgPpg = useMemo(() => {
    if (!simData) return 0;
    let total = 0;
    let games = 0;
    for (const w of simData.weekNumbers.filter((x) => x < currentWeek)) {
      for (const id of simData.teamIds) {
        const pts = parseFloat(simData.matchupData[w]?.[id]?.team_points || "0");
        if (pts > 0) {
          total += pts;
          games += 1;
        }
      }
    }
    return games > 0 ? total / games : 0;
  }, [simData, currentWeek]);

  const positionBars = useMemo(() => {
    if (!valueSettings || !needBaseline || !selectedId) return null;
    const mine = valueSettings.isDynasty
      ? bestValueByPosition(roster, playersData, valuesBySleeperId, valueSettings)
      : bestRedraftScoreByPosition(roster, playersData, seasonToDatePPG, remainingWeeks);
    return POSITIONS.map((pos) => ({ pos, value: mine[pos], baseline: needBaseline[pos] }));
  }, [valueSettings, needBaseline, roster, playersData, valuesBySleeperId, seasonToDatePPG, remainingWeeks, selectedId]);

  const gradedTrades = useMemo(() => {
    if (!selectedId || !valueFor) return [];
    return transactions
      .filter((t): t is TradeEvent => (t.kind === "trade2" || t.kind === "tradeMulti") && eventInvolvesUser(t, selectedId))
      .map((event) => ({ event, grade: gradeTrade(event, valueFor) }))
      .sort((a, b) => b.event.timestamp - a.event.timestamp);
  }, [transactions, selectedId, valueFor]);
  const gradedAllTimeTrades = useMemo(() => {
    if (!selectedId || !valueFor) return [];
    const trades = allTimeTradesByUser[selectedId] ?? [];
    return trades.map((event) => ({ event, grade: gradeTrade(event, valueFor) }));
  }, [allTimeTradesByUser, selectedId, valueFor]);
  const activeGradedTrades = tradeScope === "allTime" ? gradedAllTimeTrades : gradedTrades;
  const tradeTally = useMemo(() => {
    let won = 0,
      lost = 0,
      fair = 0;
    for (const { grade } of activeGradedTrades) {
      if (!grade.winner) fair++;
      else if (grade.winner.userId === selectedId) won++;
      else lost++;
    }
    return { won, lost, fair };
  }, [activeGradedTrades, selectedId]);

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  const tierMeta = tier ? TIER_META[tier.tier] : null;
  const sosTierColor = sos ? SOS_TIER_COLOR[sos.tier] : "#6b7280";
  const myPlayoffOdds = selectedId ? playoffOdds[selectedId] ?? 0 : 0;
  const myDivisionOdds = selectedId ? divisionOdds[selectedId] ?? 0 : 0;
  const myAvgPointsFor = selectedId ? avgPointsFor[selectedId] ?? 0 : 0;

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <View className="mb-1">
        <Text className="text-[11px] font-bold tracking-widest text-brand">TEAM BREAKDOWN</Text>
        <Text className="text-white text-[21px] font-bold mt-0.5">Every Angle, One Team</Text>
        <Text className="text-gray-500 text-[12px] mt-1">Real power rating, schedule, playoff odds, and history - pick a team.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 mt-3 pb-1">
        {users.map((u) => {
          const active = u.id === selectedId;
          const uTier = extras && u.id === selectedId ? extras.tier?.tier : undefined;
          const ringColor = active ? (tierMeta?.color ?? "#af1222") : "transparent";
          return (
            <Pressable key={u.id} onPress={() => setSelectedId(u.id)} style={{ width: 64 }} className="items-center">
              <View style={{ borderColor: ringColor }} className="w-14 h-14 rounded-full border-2 items-center justify-center bg-[#141416]">
                <Image source={u.avatar ? { uri: u.avatar } : helmet} className="w-[46px] h-[46px] rounded-full" />
              </View>
              <Text numberOfLines={1} className={`text-[10px] mt-1 text-center ${active ? "text-white font-bold" : "text-gray-500"}`}>
                {u.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {selectedId && (
        <>
          {/* Hero */}
          <View
            style={{ borderColor: `${tierMeta?.color ?? "#af1222"}33` }}
            className="bg-[#141416] border rounded-2xl p-4 mt-3 flex-row items-center gap-3.5"
          >
            <View style={{ borderColor: tierMeta?.color ?? "#af1222" }} className="w-[58px] h-[58px] rounded-full border-2 items-center justify-center">
              <Image source={selectedUser?.avatar ? { uri: selectedUser.avatar } : helmet} className="w-[48px] h-[48px] rounded-full" />
            </View>
            <View className="flex-1">
              <Pressable onPress={() => router.push(`/profile/manager/${selectedId}`)}>
                <Text numberOfLines={1} className="text-white text-[17px] font-bold">
                  {selectedUser?.name}
                </Text>
              </Pressable>
              <View className="flex-row items-center gap-2 mt-1 flex-wrap">
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white/80 text-[12px] font-semibold">
                  {history ? `${history.wins}-${history.losses}${history.ties ? `-${history.ties}` : ""}` : "-"}
                </Text>
                {sos?.streak && (
                  <View className="px-1.5 py-0.5 rounded bg-white/10">
                    <Text style={{ color: sos.streak.includes("W") ? "#22c55e" : "#ef4444" }} className="text-[10px] font-bold">
                      {sos.streak}
                    </Text>
                  </View>
                )}
                {tierMeta && tier && (
                  <View style={{ backgroundColor: `${tierMeta.color}22` }} className="flex-row items-center gap-1 px-2 py-0.5 rounded-full">
                    <Feather name={tierMeta.icon} size={9} color={tierMeta.color} />
                    <Text style={{ color: tierMeta.color }} className="text-[10px] font-bold">
                      {tier.tier}
                    </Text>
                  </View>
                )}
              </View>
              {tierMeta && <Text className="text-gray-500 text-[11px] mt-1">{tierMeta.blurb}</Text>}
            </View>
            {tier && (
              <View className="items-center">
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[20px] font-extrabold">
                  #{tier.rank}
                </Text>
                <Text className="text-gray-500 text-[9px] font-bold">OF {rankOf}</Text>
              </View>
            )}
          </View>

          {/* Power rating */}
          {tier && (
            <Section title="POWER RATING" icon="activity">
              <View className="flex-row items-center gap-4">
                <RadialGauge value={tier.powerScore} color={tierMeta?.color ?? "#af1222"} sublabel="POWER SCORE" />
                <View className="flex-1">
                  <HBar label="Roster Strength" value={tier.strengthScore} max={100} color="#3b82f6" valueLabel={`${Math.round(tier.strengthScore)}th pct`} />
                  <HBar label="Record" value={tier.recordScore} max={100} color="#22c55e" valueLabel={`${Math.round(tier.recordScore)}th pct`} />
                  {tier.assetScore !== null && (
                    <HBar label="Dynasty Assets" value={tier.assetScore} max={100} color="#eab308" valueLabel={`${Math.round(tier.assetScore)}th pct`} />
                  )}
                </View>
              </View>
            </Section>
          )}

          {/* Scoring trend */}
          <Section title="SCORING TREND" icon="trending-up">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-gray-500 text-[10px]">
                {weeklyValues.length} game{weeklyValues.length === 1 ? "" : "s"} played · dashed line is league average
              </Text>
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[12px] font-bold">
                {weeklyValues.length > 0 ? (weeklyValues.reduce((a, b) => a + b, 0) / weeklyValues.length).toFixed(1) : "-"} PPG
              </Text>
            </View>
            <TrendChart values={weeklyValues} avg={leagueAvgPpg} color={tierMeta?.color ?? "#af1222"} />
          </Section>

          {/* Playoff odds */}
          <Section title="PLAYOFF OUTLOOK" icon="flag">
            <View className="flex-row items-center gap-4">
              <RadialGauge value={myPlayoffOdds} color="#22c55e" sublabel="PLAYOFF ODDS" suffix="%" />
              {(simData?.divisionsCount ?? 0) > 0 && <RadialGauge value={myDivisionOdds} color="#3b82f6" sublabel="DIVISION ODDS" suffix="%" />}
              <View className="flex-1 items-center">
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[20px] font-extrabold">
                  {myAvgPointsFor.toFixed(0)}
                </Text>
                <Text className="text-gray-500 text-[9px] font-bold text-center mt-0.5">PROJ. SEASON{"\n"}POINTS FOR</Text>
              </View>
            </View>
          </Section>

          {/* Schedule outlook */}
          {sos && (
            <Section title="SCHEDULE OUTLOOK" icon="calendar">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-gray-400 text-[11px]">Rest-of-season difficulty</Text>
                <View style={{ backgroundColor: `${sosTierColor}22` }} className="px-2.5 py-1 rounded-full">
                  <Text style={{ color: sosTierColor }} className="text-[11px] font-bold">
                    {sos.tier}
                  </Text>
                </View>
              </View>
              {sos.gauntlet && sos.gauntlet.avgStrength >= 65 && (
                <View className="flex-row items-center gap-1.5 mb-3 bg-red-500/10 border border-red-500/25 rounded-lg px-2.5 py-2">
                  <Feather name="alert-triangle" size={12} color="#ef4444" />
                  <Text className="text-red-400 text-[11px] font-semibold flex-1">
                    Gauntlet stretch: weeks {sos.gauntlet.startWeek}-{sos.gauntlet.endWeek}
                  </Text>
                </View>
              )}
              {sos.remaining.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {sos.remaining.slice(0, 6).map((opp) => (
                    <View key={opp.week} style={{ width: 84 }} className="items-center bg-white/5 rounded-xl py-2.5">
                      <Text className="text-gray-500 text-[9px] font-bold">WK {opp.week}</Text>
                      <Image source={opp.opponentAvatar ? { uri: opp.opponentAvatar } : helmet} className="w-8 h-8 rounded-full my-1" />
                      <Text numberOfLines={1} className="text-white text-[10px] font-semibold px-1 text-center">
                        {opp.opponentName}
                      </Text>
                      <View style={{ backgroundColor: `${SOS_TIER_COLOR["Tough Matchup"]}00` }} className="mt-1">
                        <Text style={{ color: opp.strength >= 60 ? "#ef4444" : opp.strength <= 30 ? "#22c55e" : "#eab308" }} className="text-[9px] font-bold">
                          {Math.round(opp.strength)} PCT
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text className="text-gray-600 text-[11px]">Regular season complete.</Text>
              )}
            </Section>
          )}

          {/* Roster strength by position */}
          {positionBars && (
            <Section title={valueSettings?.isDynasty ? "ROSTER VALUE BY POSITION" : "ROSTER STRENGTH BY POSITION"} icon="bar-chart-2">
              {(() => {
                const max = Math.max(...positionBars.map((p) => Math.max(p.value, p.baseline)), 1) * 1.1;
                return positionBars.map((p) => (
                  <HBar
                    key={p.pos}
                    label={p.pos}
                    value={p.value}
                    max={max}
                    color={p.value >= p.baseline ? "#22c55e" : "#ef4444"}
                    valueLabel={valueSettings?.isDynasty ? formatValue(p.value) : p.value.toFixed(1)}
                    markerPct={(p.baseline / max) * 100}
                  />
                ));
              })()}
              <Text className="text-gray-600 text-[9px] mt-1">White tick marks the league&apos;s own average at that position.</Text>
            </Section>
          )}

          {/* Top performers */}
          {sos && sos.bestPlayers.length > 0 && (
            <Section title="TOP PERFORMERS" icon="star">
              <View className="gap-2">
                {sos.bestPlayers.slice(0, 5).map((p, i) => (
                  <View key={p.id} className="flex-row items-center gap-2.5">
                    <Text className="text-gray-600 text-[11px] font-bold w-4">{i + 1}</Text>
                    <Image
                      source={p.avatar ? { uri: p.avatar } : { uri: `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg` }}
                      className="w-7 h-7 rounded-full bg-white/10"
                    />
                    <Text numberOfLines={1} className="text-white text-[12px] font-semibold flex-1">
                      {p.name}
                      {p.pos ? ` · ${p.pos}` : ""}
                    </Text>
                    <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white/80 text-[12px] font-bold">
                      {p.avgPoints.toFixed(1)} PPG
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {/* Career / all-time */}
          {history && (
            <Section title="ALL-TIME CAREER" icon="clock">
              <View className="flex-row flex-wrap">
                <MiniStat label="RECORD" value={`${history.wins}-${history.losses}${history.ties ? `-${history.ties}` : ""}`} />
                <MiniStat label="WIN %" value={`${(history.winPct * 100).toFixed(0)}%`} />
                <MiniStat label="BEST FINISH" value={history.bestFinish ?? "-"} />
                <MiniStat label="PLAYOFF APPS" value={String(history.playoffAppearances)} />
                <MiniStat label="TRANSACTIONS" value={String(history.totalTransactions)} />
                <MiniStat label="TRADES" value={String(history.totalTrades)} />
                {valueSettings?.isDynasty && (
                  <MiniStat label="PICK FLOW" value={`${history.picksGained - history.picksLost >= 0 ? "+" : ""}${history.picksGained - history.picksLost}`} />
                )}
                <MiniStat label="SEASONS" value={String(history.seasonsPlayed)} />
              </View>
              {history.badges.length > 0 && (
                <View className="flex-row flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/10">
                  {history.badges.map((b) => (
                    <View key={b} className="flex-row items-center gap-1 bg-brand/10 border border-brand/25 rounded-full px-2.5 py-1">
                      <Feather name="award" size={10} color="#af1222" />
                      <Text className="text-brand text-[10px] font-bold">{b}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Section>
          )}

          {/* GM Scout - dynasty only */}
          {extras?.isDynasty && (extras.avgRosterAge || extras.rookieOnRoster || extras.recentlyAcquired) && (
            <Section title="GM SCOUT" icon="search">
              {extrasLoading ? (
                <ActivityIndicator color="#af1222" />
              ) : (
                <View className="gap-2.5">
                  {extras.avgRosterAge !== null && (
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 text-[12px]">Average roster age</Text>
                      <Text className="text-white text-[12px] font-bold">{extras.avgRosterAge} yrs</Text>
                    </View>
                  )}
                  {extras.rookieOnRoster && (
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 text-[12px]">Rookie on roster</Text>
                      <Text className="text-white text-[12px] font-bold">
                        {extras.rookieOnRoster.fn} {extras.rookieOnRoster.ln} · {extras.rookieOnRoster.pos}
                      </Text>
                    </View>
                  )}
                  {extras.recentlyAcquired && (
                    <View className="flex-row items-center justify-between">
                      <Text className="text-gray-400 text-[12px]">Most recent add</Text>
                      <Text className="text-white text-[12px] font-bold">
                        {extras.recentlyAcquired.fn} {extras.recentlyAcquired.ln} · {extras.recentlyAcquired.pos}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Section>
          )}

          {/* Trade activity */}
          <Section title="TRADE ACTIVITY" icon="repeat">
            <View className="flex-row gap-2 mb-3">
              <Pressable
                onPress={() => setTradeScope("season")}
                className={`flex-1 items-center py-2 rounded-xl border ${tradeScope === "season" ? "bg-brand/15 border-brand" : "border-white/10"}`}
              >
                <Text className={`text-[11px] font-bold ${tradeScope === "season" ? "text-brand" : "text-gray-400"}`}>THIS SEASON</Text>
              </Pressable>
              <Pressable
                onPress={() => setTradeScope("allTime")}
                className={`flex-1 items-center py-2 rounded-xl border ${tradeScope === "allTime" ? "bg-brand/15 border-brand" : "border-white/10"}`}
              >
                <Text className={`text-[11px] font-bold ${tradeScope === "allTime" ? "text-brand" : "text-gray-400"}`}>ALL-TIME</Text>
              </Pressable>
            </View>

            {tradeScope === "allTime" && allTimeTradesLoading && activeGradedTrades.length === 0 ? (
              <ActivityIndicator color="#af1222" />
            ) : activeGradedTrades.length === 0 ? (
              <Text className="text-gray-600 text-[11px]">
                {tradeScope === "allTime" ? "No trades on record for this manager in this league." : "No trades yet this season."}
              </Text>
            ) : (
              <>
                <View className="flex-row gap-2 mb-3">
                  <TallyChip label="WON" value={tradeTally.won} color="#22c55e" />
                  <TallyChip label="FAIR" value={tradeTally.fair} color="#6b7280" />
                  <TallyChip label="LOST" value={tradeTally.lost} color="#ef4444" />
                </View>
                <View className="gap-2.5">
                  {activeGradedTrades.map(({ event, grade }: { event: TradeEvent; grade: TradeGrade }) => (
                    <TradeHistoryCard key={event.id} event={event} grade={grade} />
                  ))}
                </View>
              </>
            )}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "33.33%" }} className="items-center py-2">
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[14px] font-bold">
        {value}
      </Text>
      <Text className="text-gray-500 text-[9px] font-bold tracking-wide mt-0.5 text-center">{label}</Text>
    </View>
  );
}

function TallyChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ backgroundColor: `${color}18`, borderColor: `${color}44` }} className="flex-1 items-center border rounded-xl py-2">
      <Text style={{ color }} className="text-[16px] font-extrabold">
        {value}
      </Text>
      <Text style={{ color }} className="text-[9px] font-bold tracking-wide">
        {label}
      </Text>
    </View>
  );
}
