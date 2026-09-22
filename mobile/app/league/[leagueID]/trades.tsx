import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { TradeEvent } from "../../../lib/leagueTransactions";
import { AssetChips } from "../../../components/TransactionsTicker";
import { formatTwitterTimestamp } from "../../../lib/formatTime";
import CommentsSection from "../../../components/CommentsSection";
import { announceLeagueTransactions, tradeLabel } from "../../../lib/announceTransactions";

function TradeCard({ event, leagueId }: { event: TradeEvent; leagueId: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View className="border-b border-white/10">
      <View className="px-4 py-3">
        <Text className="text-gray-500 text-[11px] mb-2">{formatTwitterTimestamp(event.timestamp)} ago</Text>
        {event.kind === "trade2" ? (
          <View className="gap-1.5">
            <View className="flex-row items-center flex-wrap gap-1.5">
              <Text className="text-white font-bold text-[13px]">{event.teamA.name}</Text>
              <Text className="text-gray-400 text-[13px]">sends</Text>
            </View>
            <AssetChips assets={event.aGives} />
            <View className="flex-row items-center flex-wrap gap-1.5 mt-1">
              <Text className="text-white font-bold text-[13px]">{event.teamB.name}</Text>
              <Text className="text-gray-400 text-[13px]">sends</Text>
            </View>
            <AssetChips assets={event.aGets} />
          </View>
        ) : (
          <View className="gap-2">
            {event.parts.map((part, i) => (
              <View key={i}>
                <Text className="text-white font-bold text-[13px] mb-1">{part.team.name} receives</Text>
                <AssetChips assets={part.receives} />
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={() => setExpanded((e) => !e)} className="flex-row items-center gap-1.5 mt-3">
          <Feather name="message-circle" size={13} color="#9ca3af" />
          <Text className="text-gray-400 text-[12px] font-semibold">
            {expanded ? "Hide comments" : "Comments"}
          </Text>
        </Pressable>
      </View>

      {expanded && (
        <CommentsSection
          targetType="trade"
          targetId={event.id}
          leagueId={leagueId}
          targetLabel={tradeLabel(event)}
        />
      )}
    </View>
  );
}

export default function Trades() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    announceLeagueTransactions(leagueID)
      .then((tradeEvents) => {
        if (cancelled) return;
        setTrades(tradeEvents);
      })
      .catch((error) => console.error("Error loading trades:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-4 pb-3 border-b border-white/10">
        <Text className="text-white text-[17px] font-bold">Trades</Text>
        <Text className="text-gray-500 text-[12px] mt-0.5">This season - tap a trade to comment</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : trades.length === 0 ? (
        <View className="items-center py-12 px-6">
          <Text className="text-gray-500 text-[13px] text-center">No trades yet this season.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {trades.map((event) => (
            <TradeCard key={event.id} event={event} leagueId={leagueID} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
