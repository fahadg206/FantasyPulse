import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { TradeEvent } from "../../../lib/leagueTransactions";
import { TradeHistoryCard } from "../../../components/TradeHistory";
import CommentsSection from "../../../components/CommentsSection";
import { announceLeagueTransactions, tradeLabel } from "../../../lib/announceTransactions";
import { getLeagueValueSettings } from "../../../lib/playerValue";
import { backend } from "../../../lib/api";
import { buildTradeValueLookup, TradeValueLookup } from "../../../lib/tradeValue";
import { gradeTrade } from "../../../lib/tradeGrade";

function TradeCard({ event, leagueId, valueFor }: { event: TradeEvent; leagueId: string; valueFor: TradeValueLookup | null }) {
  const [showComments, setShowComments] = useState(false);
  const grade = valueFor ? gradeTrade(event, valueFor) : undefined;

  return (
    <View className="border-b border-white/10 px-4 pt-3">
      <TradeHistoryCard event={event} grade={grade} />

      <Pressable
        onPress={() => setShowComments((c) => !c)}
        className="flex-row items-center gap-1.5 -mt-1.5 mb-3"
      >
        <Feather name="message-circle" size={13} color="#9ca3af" />
        <Text className="text-gray-400 text-[12px] font-semibold">
          {showComments ? "Hide comments" : "Comments"}
        </Text>
      </Pressable>

      {showComments && (
        <View className="-mx-4">
          <CommentsSection targetType="trade" targetId={event.id} leagueId={leagueId} targetLabel={tradeLabel(event)} />
        </View>
      )}
    </View>
  );
}

export default function Trades({ hideHeader }: { hideHeader?: boolean } = {}) {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [valueFor, setValueFor] = useState<TradeValueLookup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    Promise.all([
      announceLeagueTransactions(leagueID),
      getLeagueValueSettings(leagueID),
      backend.fetchAllPlayerValues(),
    ])
      .then(async ([events, settings, values]) => {
        if (cancelled) return;
        setTrades(events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti"));
        // Real trade value - dynasty's own KTC dynasty market, or (for
        // redraft) FantasyCalc's real external redraft market. See
        // lib/tradeValue.ts - the same source Trade Calculator and Trade
        // Finder already grade trades against.
        const lookup = await buildTradeValueLookup(settings, values);
        if (!cancelled) setValueFor(() => lookup);
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
      {!hideHeader && (
        <View className="px-4 pt-4 pb-3 border-b border-white/10">
          <Text className="text-white text-[17px] font-bold">Trades</Text>
          <Text className="text-gray-500 text-[12px] mt-0.5">This season - a letter grade, who won, and comments on every trade</Text>
        </View>
      )}

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
            <TradeCard key={event.id} event={event} leagueId={leagueID} valueFor={valueFor} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
