import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue } from "../../../lib/playerValue";
import { computePowerRankings, percentileRank, PowerRankingResult, PowerRankingTier } from "../../../lib/powerRankings";
import { buildLeagueSimData } from "../../../lib/leagueSimData";

const helmet = require("../../../assets/images/helmet2.png");

interface TeamDisplay {
  userId: string;
  name: string;
  avatar: string | number;
}

// Grouped into tier sections (Contenders down to Rebuild/No Chance) rather
// than one flat numbered list - the same "clustered into buckets, not just
// ranked 1-N" shape real power rankings pages (ESPN, The Athletic, Dynasty
// Daddy) use, since the interesting read is "who's in which tier," not
// just strict ordering. Order here is the display order - best tier first.
const TIER_ORDER: PowerRankingTier[] = [
  "Contender",
  "Playoff Contender",
  "Middle of the Pack",
  "Rebuild",
  "No Chance",
];

const TIER_META: Record<
  PowerRankingTier,
  { icon: keyof typeof Feather.glyphMap; color: string; bg: string; border: string; blurb: string }
> = {
  Contender: {
    icon: "award",
    color: "#22c55e",
    bg: "bg-green-500/10",
    border: "border-green-500/25",
    blurb: "Built to win now",
  },
  "Playoff Contender": {
    icon: "shield",
    color: "#3b82f6",
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
    blurb: "In the mix for October",
  },
  "Middle of the Pack": {
    icon: "minus",
    color: "#eab308",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/25",
    blurb: "Could go either way",
  },
  Rebuild: {
    icon: "tool",
    color: "#ef4444",
    bg: "bg-red-500/10",
    border: "border-red-500/25",
    blurb: "Playing for next year",
  },
  "No Chance": {
    icon: "trending-down",
    color: "#ef4444",
    bg: "bg-red-500/10",
    border: "border-red-500/25",
    blurb: "Out of it this season",
  },
};

function SubStat({ label, value }: { label: string; value: number }) {
  return (
    <View className="items-center">
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-bold">
        {value}
      </Text>
      <Text className="text-gray-500 text-[9px] font-semibold tracking-wide mt-0.5">{label}</Text>
    </View>
  );
}

// Real week-by-week scoring strength, not a faked retroactive power score -
// re-deriving the full power-rankings formula for a past week would need
// that week's actual roster and that week's actual player values, neither
// of which this app keeps a snapshot of. What IS fully real: how this
// team's actual score that week ranked against the rest of the league,
// week by week - an honest trend instead of an approximated one.
function WeeklyTrendChart({ values }: { values: number[] }) {
  const w = 300;
  const h = 70;
  const pad = 6;
  if (values.length < 2) {
    return (
      <Text className="text-gray-600 text-[11px] text-center py-4">Not enough weeks played yet for a trend.</Text>
    );
  }
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => ({ x: pad + i * stepX, y: pad + (1 - v / 100) * (h - pad * 2) }));
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const last = pts[pts.length - 1];
  const areaD = `${lineD} L${last.x},${h - pad} L${pts[0].x},${h - pad} Z`;
  const trendingUp = values[values.length - 1] >= values[0];
  const color = trendingUp ? "#22c55e" : "#ef4444";
  const gradientId = trendingUp ? "trendUp" : "trendDown";

  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.3} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={areaD} fill={`url(#${gradientId})`} />
      <Path d={lineD} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

function RankingRow({
  item,
  display,
  record,
  trend,
  expanded,
  onToggleExpand,
}: {
  item: PowerRankingResult;
  display?: TeamDisplay;
  record?: { wins: number; losses: number };
  trend?: number[];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const meta = TIER_META[item.tier];
  const router = useRouter();

  return (
    <View className={`mb-2.5 rounded-2xl bg-[#141416] border ${meta.border} overflow-hidden`}>
      <Pressable
        onPress={() => router.push(`/profile/manager/${item.userId}`)}
        className="flex-row items-center gap-3 p-3.5"
      >
        <View
          style={{ borderColor: meta.color }}
          className="w-9 h-9 rounded-full border-2 items-center justify-center"
        >
          <Text style={{ color: meta.color }} className="font-bold text-[14px]">
            {item.rank}
          </Text>
        </View>

        <Image
          source={typeof display?.avatar === "string" ? { uri: display.avatar } : display?.avatar || helmet}
          className="w-11 h-11 rounded-full bg-white/10"
        />

        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text numberOfLines={1} className="text-white text-[15px] font-bold flex-1">
              {display?.name || "Unknown Manager"}
            </Text>
            {record && (
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[12px] font-semibold">
                {record.wins}-{record.losses}
              </Text>
            )}
          </View>
          <View className="flex-row items-center gap-2 mt-1.5">
            <View className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <View style={{ width: `${item.powerScore}%`, backgroundColor: meta.color }} className="h-full rounded-full" />
            </View>
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[11px] font-bold w-6 text-right">
              {item.powerScore}
            </Text>
          </View>
          {item.starterRank !== item.rank && (
            <Text className="text-gray-600 text-[10px] mt-1">
              {item.starterRank < item.rank ? "Lineup punches above its record - " : "Record's ahead of the lineup - "}
              starting 7 ranks #{item.starterRank}
            </Text>
          )}
        </View>

        <View className="items-end gap-2 pl-1">
          <View className={`px-2 py-1 rounded-full ${meta.bg}`}>
            <Feather name={meta.icon} size={12} color={meta.color} />
          </View>
          <View className="flex-row gap-2.5">
            <SubStat label="STR" value={item.strengthScore} />
            <SubStat label="REC" value={item.recordScore} />
            {item.assetScore !== null && <SubStat label="VAL" value={item.assetScore} />}
          </View>
        </View>
      </Pressable>

      {trend && trend.length >= 2 && (
        <>
          <Pressable
            onPress={onToggleExpand}
            className="flex-row items-center justify-center gap-1.5 py-2 border-t border-white/10"
          >
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={12} color="#9ca3af" />
            <Text className="text-gray-400 text-[11px] font-semibold">
              {expanded ? "Hide" : "Show"} weekly strength trend
            </Text>
          </Pressable>
          {expanded && (
            <View className="px-3.5 pb-3 pt-1">
              <WeeklyTrendChart values={trend} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function PowerRankings() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<PowerRankingResult[]>([]);
  const [teamsById, setTeamsById] = useState<Record<string, TeamDisplay>>({});
  const [recordById, setRecordById] = useState<Record<string, { wins: number; losses: number }>>({});
  const [leagueSettings, setLeagueSettings] = useState<LeagueValueSettings | null>(null);
  const [trendByUser, setTrendByUser] = useState<Record<string, number[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    const isInitial = refreshKey === 0;

    (async () => {
      try {
        const [usersRes, rostersRes, nflStateRes, settings, playersData, sim] = await Promise.all([
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
          sleeper.getNflState(),
          getLeagueValueSettings(leagueID),
          backend.fetchPlayers(leagueID),
          buildLeagueSimData(leagueID),
        ]);
        if (cancelled) return;

        const teamsDisplay: Record<string, TeamDisplay> = {};
        usersRes.data.forEach((user: any) => {
          teamsDisplay[user.user_id] = {
            userId: user.user_id,
            name: user.display_name,
            avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : helmet,
          };
        });

        let playerValuesBySleeperId: Record<string, RawPlayerValue> = {};
        if (settings.isDynasty) {
          playerValuesBySleeperId = await backend.fetchAllPlayerValues();
        }

        const currentWeek: number = nflStateRes.data.week || 1;
        const records: Record<string, { wins: number; losses: number }> = {};
        const teamsInput = rostersRes.data
          .filter((roster: any) => teamsDisplay[roster.owner_id])
          .map((roster: any) => {
            const wins = parseInt(roster.settings?.wins || "0");
            const losses = parseInt(roster.settings?.losses || "0");
            records[roster.owner_id] = { wins, losses };
            return {
              rosterId: Number(roster.roster_id),
              userId: roster.owner_id,
              wins,
              losses,
              rosterSleeperIds: roster.players || [],
              starterSleeperIds: roster.starters || [],
            };
          });

        const result = computePowerRankings({
          teams: teamsInput,
          leagueSettings: settings,
          upcomingWeeks: [currentWeek, currentWeek + 1, currentWeek + 2],
          playerValuesBySleeperId,
          getWeeklyStarterProjection: (starterIds, week) =>
            starterIds.reduce((sum: number, playerId: string) => {
              const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
              return sum + (proj !== undefined ? parseFloat(proj) : 0);
            }, 0),
        });

        // Real weekly scoring-strength trend, per team - this week's real
        // score percentile-ranked against the rest of the league, for
        // every week actually played. Honest, not a retroactive re-run of
        // the full power-rankings formula (which would need a roster/value
        // snapshot from each past week that this app doesn't keep).
        const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
        const trends: Record<string, number[]> = {};
        for (const userId of sim.teamIds) trends[userId] = [];
        for (const week of playedWeeks) {
          const scores = sim.teamIds.map((id) => parseFloat(sim.matchupData[week]?.[id]?.team_points || "0"));
          sim.teamIds.forEach((id, i) => {
            if (scores[i] > 0) trends[id].push(percentileRank(scores, scores[i]));
          });
        }

        if (cancelled) return;
        setTeamsById(teamsDisplay);
        setRecordById(records);
        setLeagueSettings(settings);
        setRankings(result);
        setTrendByUser(trends);
        if (isInitial) setLoading(false);
        else setRefreshing(false);
      } catch (error) {
        console.error("Error computing power rankings:", error);
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

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
        <Text className="mt-2 text-gray-400 text-xs">Loading Power Rankings…</Text>
      </View>
    );
  }

  const sections = TIER_ORDER.map((tier) => ({
    tier,
    teams: rankings.filter((r) => r.tier === tier),
  })).filter((s) => s.teams.length > 0);

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-4 pb-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] font-bold tracking-widest text-brand">POWER RANKINGS</Text>
          {leagueSettings && (
            <View className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
              <Text className="text-[10px] font-semibold text-gray-300">
                {leagueSettings.isDynasty ? "Dynasty" : "Redraft"}
                {leagueSettings.isSuperflex ? " · Superflex" : ""}
              </Text>
            </View>
          )}
        </View>
        <Text className="text-[12px] text-gray-500 mt-1.5">
          {leagueSettings?.isDynasty
            ? "Blends this season's roster strength and record with the whole roster's long-term dynasty value."
            : "Based entirely on this season's roster strength and record - nothing carries over in redraft."}
        </Text>
      </View>

      <ScrollView
        contentContainerClassName="px-4 pb-8"
        showsVerticalScrollIndicator={false}
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
        {sections.map(({ tier, teams }) => {
          const meta = TIER_META[tier];
          return (
            <View key={tier} className="mb-3">
              <View className="flex-row items-center gap-2 mb-2.5 mt-1.5">
                <View className={`w-6 h-6 rounded-full items-center justify-center ${meta.bg}`}>
                  <Feather name={meta.icon} size={12} color={meta.color} />
                </View>
                <Text className="text-white text-[14px] font-bold">{tier}</Text>
                <Text className="text-gray-600 text-[12px]">· {meta.blurb}</Text>
                <View className="flex-1 h-px bg-white/10 ml-1" />
              </View>
              {teams.map((item) => (
                <RankingRow
                  key={item.userId}
                  item={item}
                  display={teamsById[item.userId]}
                  record={recordById[item.userId]}
                  trend={trendByUser[item.userId]}
                  expanded={expandedId === item.userId}
                  onToggleExpand={() => setExpandedId((p) => (p === item.userId ? null : item.userId))}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
