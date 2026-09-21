import { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { MotiView } from "moti";
import { Easing } from "react-native-reanimated";
import { getTeamLogo } from "../lib/nflTeams";
import { buildLeagueTransactions, TxAsset, AddDropEvent, TradeEvent } from "../lib/leagueTransactions";

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  WR: "#3b82f6",
  RB: "#22c55e",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

export function AssetChip({ asset }: { asset: TxAsset }) {
  if (asset.isPick) {
    return <Text className="text-white text-[12px] font-semibold">{asset.label}</Text>;
  }
  const isDef = asset.pos === "DEF";
  const photoUri = isDef
    ? getTeamLogo(asset.team) ?? undefined
    : `https://sleepercdn.com/content/nfl/players/thumb/${asset.id}.jpg`;
  const teamLogo = !isDef ? getTeamLogo(asset.team) : null;

  return (
    <View className="flex-row items-center gap-1">
      <Image
        source={photoUri ? { uri: photoUri } : undefined}
        resizeMode={isDef ? "contain" : "cover"}
        className={isDef ? "w-[18px] h-[18px]" : "w-[20px] h-[20px] rounded-full bg-white/10"}
      />
      <Text className="text-white text-[12px] font-semibold">{asset.label}</Text>
      {asset.pos && (
        <Text style={{ color: POSITION_COLOR[asset.pos] ?? "#9ca3af" }} className="text-[10px] font-bold">
          {asset.pos}
        </Text>
      )}
      {teamLogo && <Image source={{ uri: teamLogo }} className="w-[14px] h-[14px]" resizeMode="contain" />}
    </View>
  );
}

function AssetChips({ assets }: { assets: TxAsset[] }) {
  return (
    <View className="flex-row items-center gap-2">
      {assets.map((a, i) => (
        <View key={a.id ?? `${a.label}-${i}`} className="flex-row items-center">
          <AssetChip asset={a} />
          {i < assets.length - 1 && <Text className="text-gray-500 text-[12px] mx-1.5">,</Text>}
        </View>
      ))}
    </View>
  );
}

function AddDropRow({ event }: { event: AddDropEvent }) {
  const isAdd = event.kind === "add";
  return (
    <View className="flex-row items-center gap-2">
      <Text style={{ color: isAdd ? "#22c55e" : "#ef4444" }} className="text-[16px] font-extrabold">
        {isAdd ? "+" : "−"}
      </Text>
      <Text className="text-gray-300 text-[12px] font-semibold">
        {event.team.name} {isAdd ? "added" : "dropped"}
      </Text>
      <AssetChip asset={event.asset} />
    </View>
  );
}

// Trades read as a single "sends ... to ... for ..." sentence with real
// player chips, in their own ticker so they're not lost between waiver
// moves scrolling by.
function TradeRow({ event }: { event: TradeEvent }) {
  if (event.kind === "trade2") {
    return (
      <View className="flex-row items-center gap-2">
        <Text className="text-brand text-[12px] font-extrabold">TRADE:</Text>
        <Text className="text-gray-300 text-[12px] font-semibold">{event.teamA.name} sends</Text>
        <AssetChips assets={event.aGives} />
        <Text className="text-gray-300 text-[12px] font-semibold">to {event.teamB.name} for</Text>
        <AssetChips assets={event.aGets} />
      </View>
    );
  }
  const parts = event.parts;
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-brand text-[12px] font-extrabold">TRADE:</Text>
      {parts.map((part, i) => (
        <View key={i} className="flex-row items-center gap-2">
          <Text className="text-gray-300 text-[12px] font-semibold">{part.team.name} gets</Text>
          <AssetChips assets={part.receives} />
          {i < parts.length - 1 && <Text className="text-gray-500 text-[12px]">/</Text>}
        </View>
      ))}
    </View>
  );
}

function ScrollingContent<T>({
  events,
  renderRow,
  emptyText,
}: {
  events: T[];
  renderRow: (event: T) => React.ReactNode;
  emptyText: string;
}) {
  if (events.length === 0) {
    return <Text className="text-gray-400 text-[12px]">{emptyText}</Text>;
  }
  return (
    <View className="flex-row items-center">
      {events.map((event, i) => (
        <View key={i} className="flex-row items-center">
          {renderRow(event)}
          <Text className="text-gray-600 text-[12px] mx-5">•</Text>
        </View>
      ))}
    </View>
  );
}

// A continuously auto-scrolling news-ticker bar, styled like a sports
// broadcast's bottom-line feed - loops two copies of the same content back
// to back so the scroll never visibly resets.
function ScrollingBar<T>({
  label,
  events,
  renderRow,
  emptyText,
}: {
  label: string;
  events: T[];
  renderRow: (event: T) => React.ReactNode;
  emptyText: string;
}) {
  const [contentWidth, setContentWidth] = useState(0);
  const duration = Math.max(12000, contentWidth * 22);

  return (
    <View className="border-y border-white/10 bg-[#141416] py-2.5 overflow-hidden">
      <View className="flex-row items-center">
        <View className="bg-brand px-2.5 py-1 rounded ml-4 mr-3">
          <Text className="text-white text-[9px] font-bold tracking-wider">{label}</Text>
        </View>
        <View className="flex-1 overflow-hidden" style={{ height: 22 }}>
          {contentWidth > 0 && (
            <MotiView
              from={{ translateX: 0 }}
              animate={{ translateX: -contentWidth }}
              transition={{ type: "timing", duration, easing: Easing.linear, loop: true }}
              style={{ flexDirection: "row" }}
            >
              <ScrollingContent events={events} renderRow={renderRow} emptyText={emptyText} />
              <ScrollingContent events={events} renderRow={renderRow} emptyText={emptyText} />
            </MotiView>
          )}
          {/* Invisible measuring copy - lays out once to get the real width
              of the content before the loop starts. */}
          <View onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)} className="absolute opacity-0 flex-row">
            <ScrollingContent events={events} renderRow={renderRow} emptyText={emptyText} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default function TransactionsTicker({ leagueID }: { leagueID: string }) {
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [addDrops, setAddDrops] = useState<AddDropEvent[]>([]);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    buildLeagueTransactions(leagueID)
      .then((events) => {
        if (cancelled) return;
        setTrades(events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti"));
        setAddDrops(events.filter((e): e is AddDropEvent => e.kind === "add" || e.kind === "drop"));
      })
      .catch((error) => console.error("Error loading transactions ticker:", error));

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  return (
    <View>
      {trades.length > 0 && (
        <ScrollingBar
          label="TRADES"
          events={trades}
          renderRow={(event) => <TradeRow event={event} />}
          emptyText="No trades yet this season"
        />
      )}
      <ScrollingBar
        label="TRANSACTIONS"
        events={addDrops}
        renderRow={(event) => <AddDropRow event={event} />}
        emptyText="No waiver moves yet this season"
      />
    </View>
  );
}
