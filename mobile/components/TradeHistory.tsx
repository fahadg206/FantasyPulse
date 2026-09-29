import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getTeamLogo } from "../lib/nflTeams";
import { buildLeagueTransactions, buildAllSeasonsTradesBetween, TradeEvent, TxAsset, TxTeam } from "../lib/leagueTransactions";
import type { TradeGrade } from "../lib/tradeGrade";

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  WR: "#3b82f6",
  RB: "#22c55e",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

function formatDate(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// A light/dark-aware asset chip, distinct from the ticker's dark-only one -
// this section lives on a page that otherwise supports both themes.
function TradeAssetChip({ asset }: { asset: TxAsset }) {
  if (asset.isPick) {
    return <Text className="text-black dark:text-white text-[12px] font-semibold">{asset.label}</Text>;
  }
  const isDef = asset.pos === "DEF";
  const photoUri = isDef
    ? getTeamLogo(asset.team) ?? undefined
    : `https://sleepercdn.com/content/nfl/players/thumb/${asset.id}.jpg`;
  const teamLogo = !isDef ? getTeamLogo(asset.team) : null;

  return (
    <View className="flex-row items-center gap-1.5">
      <Image
        source={photoUri ? { uri: photoUri } : undefined}
        resizeMode={isDef ? "contain" : "cover"}
        className={isDef ? "w-[22px] h-[22px]" : "w-[24px] h-[24px] rounded-full bg-gray-200 dark:bg-white/10"}
      />
      <Text className="text-black dark:text-white text-[12px] font-semibold">{asset.label}</Text>
      {asset.pos && (
        <Text style={{ color: POSITION_COLOR[asset.pos] ?? "#9ca3af" }} className="text-[10px] font-bold">
          {asset.pos}
        </Text>
      )}
      {teamLogo && <Image source={{ uri: teamLogo }} className="w-[16px] h-[16px]" resizeMode="contain" />}
    </View>
  );
}

function TeamAvatar({ name, avatar, isWinner }: { name: string; avatar?: string; isWinner?: boolean }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {avatar && (
        <View>
          <Image
            source={{ uri: avatar }}
            style={isWinner ? { borderWidth: 2, borderColor: "#22c55e" } : undefined}
            className="w-[22px] h-[22px] rounded-full"
          />
          {isWinner && (
            <View className="absolute -bottom-[1px] -right-[1px] w-[11px] h-[11px] rounded-full bg-[#22c55e] items-center justify-center border border-white dark:border-[#1a1414]">
              <Feather name="check" size={7} color="#fff" />
            </View>
          )}
        </View>
      )}
      <Text numberOfLines={1} className="text-black dark:text-white font-bold text-[13px]">
        {name}
      </Text>
    </View>
  );
}

export function TradeHistoryCard({ event, grade, onPress }: { event: TradeEvent; grade?: TradeGrade; onPress?: () => void }) {
  const isWinner = (team: TxTeam) => !!grade?.winner?.userId && grade.winner.userId === team.userId;

  if (event.kind === "trade2") {
    return (
      <Pressable onPress={onPress} className="bg-[#f0eeee] dark:bg-[#1a1414] rounded-2xl p-4 mb-3">
        <View className="flex-row items-center justify-between mb-1">
          <TeamAvatar name={event.teamA.name} avatar={event.teamA.avatar} isWinner={isWinner(event.teamA)} />
          <Feather name="repeat" size={14} color="#af1222" />
          <TeamAvatar name={event.teamB.name} avatar={event.teamB.avatar} isWinner={isWinner(event.teamB)} />
        </View>
        {grade?.summary && (
          <View className="flex-row items-center justify-center gap-1.5 mb-1.5">
            {isWinner(event.teamA) && <Feather name="arrow-left" size={12} color={grade.verdict.color} />}
            <Text style={{ color: grade.verdict.color }} className="text-[11px] font-bold text-center">
              {grade.summary}
            </Text>
            {isWinner(event.teamB) && <Feather name="arrow-right" size={12} color={grade.verdict.color} />}
          </View>
        )}
        <Text className="text-gray-500 text-[10px] text-center mb-3">{formatDate(event.timestamp)}</Text>
        <View className="flex-row">
          <View className="flex-1 gap-2">
            <Text className="text-[9px] font-bold tracking-wide text-gray-500">
              {event.teamA.name.toUpperCase()} RECEIVES
            </Text>
            {event.aGets.map((a, i) => (
              <TradeAssetChip key={i} asset={a} />
            ))}
          </View>
          <View style={{ width: 1 }} className="bg-gray-300 dark:bg-white/10 mx-3" />
          <View className="flex-1 gap-2">
            <Text className="text-[9px] font-bold tracking-wide text-gray-500">
              {event.teamB.name.toUpperCase()} RECEIVES
            </Text>
            {event.aGives.map((a, i) => (
              <TradeAssetChip key={i} asset={a} />
            ))}
          </View>
        </View>
      </Pressable>
    );
  }

  const parts = event.parts;
  return (
    <Pressable onPress={onPress} className="bg-[#f0eeee] dark:bg-[#1a1414] rounded-2xl p-4 mb-3">
      <Text numberOfLines={1} className="text-black dark:text-white font-bold text-[13px] mb-1">
        {parts.map((p) => p.team.name).join(" ⇄ ")}
      </Text>
      {grade?.summary && (
        <Text style={{ color: grade.verdict.color }} className="text-[11px] font-bold mb-1.5">
          {grade.summary}
        </Text>
      )}
      <Text className="text-gray-500 text-[10px] mb-3">{formatDate(event.timestamp)}</Text>
      <View className="gap-3">
        {parts.map((part, i) => (
          <View key={i} className="gap-2">
            <View className="flex-row items-center gap-1.5">
              {isWinner(part.team) && (
                <View className="w-3.5 h-3.5 rounded-full bg-[#22c55e] items-center justify-center">
                  <Feather name="check" size={8} color="#fff" />
                </View>
              )}
              <Text className="text-[9px] font-bold tracking-wide text-gray-500">
                {part.team.name.toUpperCase()} RECEIVES
              </Text>
            </View>
            {part.receives.map((a, j) => (
              <TradeAssetChip key={j} asset={a} />
            ))}
          </View>
        ))}
      </View>
    </Pressable>
  );
}

// A fuller, non-scrolling companion to the Dashboard's trade ticker. When
// two managers are selected in the Trade Calculator, this searches every
// season they've both been in this league (not just the current one) for
// trades directly between them - answers "have these two ever traded
// before?" going back through the league's whole history.
export default function TradeHistory({
  leagueID,
  userIds,
}: {
  leagueID: string;
  userIds?: [string, string];
}) {
  const [trades, setTrades] = useState<TradeEvent[] | null>(null);
  const userIdsKey = userIds?.join(",");

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    const load = userIds
      ? buildAllSeasonsTradesBetween(leagueID, userIds)
      : buildLeagueTransactions(leagueID).then((events) =>
          events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti")
        );

    load
      .then((result) => {
        if (!cancelled) setTrades(result);
      })
      .catch((error) => {
        console.error("Error loading trade history:", error);
        if (!cancelled) setTrades([]);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueID, userIdsKey]);

  const emptyMessage = userIds
    ? "These two managers haven't made a trade with each other in any season yet."
    : "No trades have happened in this league yet.";

  return (
    <View className="mt-6">
      <Text className="font-bold mb-3 text-black dark:text-white text-[15px]">
        {userIds ? "All-Time Trade History Between These Teams" : "Trade History"}
      </Text>
      {trades === null ? (
        <ActivityIndicator color="#af1222" />
      ) : trades.length === 0 ? (
        <Text className="text-gray-500 text-[13px]">{emptyMessage}</Text>
      ) : (
        trades.map((t, i) => <TradeHistoryCard key={i} event={t} />)
      )}
    </View>
  );
}
