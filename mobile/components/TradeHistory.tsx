import { useEffect, useState } from "react";
import { View, Text, Image, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getTeamLogo } from "../lib/nflTeams";
import { buildLeagueTransactions, buildAllSeasonsTradesBetween, TradeEvent, TxAsset } from "../lib/leagueTransactions";

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

function TeamAvatar({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {avatar && <Image source={{ uri: avatar }} className="w-[22px] h-[22px] rounded-full" />}
      <Text numberOfLines={1} className="text-black dark:text-white font-bold text-[13px]">
        {name}
      </Text>
    </View>
  );
}

function TradeHistoryCard({ event }: { event: TradeEvent }) {
  if (event.kind === "trade2") {
    return (
      <View className="bg-[#f0eeee] dark:bg-[#1a1414] rounded-2xl p-4 mb-3">
        <View className="flex-row items-center justify-between mb-1">
          <TeamAvatar name={event.teamA.name} avatar={event.teamA.avatar} />
          <Feather name="repeat" size={14} color="#af1222" />
          <TeamAvatar name={event.teamB.name} avatar={event.teamB.avatar} />
        </View>
        <Text className="text-gray-500 text-[10px] mb-3 text-center">{formatDate(event.timestamp)}</Text>
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
      </View>
    );
  }

  const parts = event.parts;
  return (
    <View className="bg-[#f0eeee] dark:bg-[#1a1414] rounded-2xl p-4 mb-3">
      <Text numberOfLines={1} className="text-black dark:text-white font-bold text-[13px] mb-1">
        {parts.map((p) => p.team.name).join(" ⇄ ")}
      </Text>
      <Text className="text-gray-500 text-[10px] mb-3">{formatDate(event.timestamp)}</Text>
      <View className="gap-3">
        {parts.map((part, i) => (
          <View key={i} className="gap-2">
            <Text className="text-[9px] font-bold tracking-wide text-gray-500">
              {part.team.name.toUpperCase()} RECEIVES
            </Text>
            {part.receives.map((a, j) => (
              <TradeAssetChip key={j} asset={a} />
            ))}
          </View>
        ))}
      </View>
    </View>
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
