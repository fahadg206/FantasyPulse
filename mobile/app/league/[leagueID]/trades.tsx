import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather, FontAwesome } from "@expo/vector-icons";
import { TradeEvent, TxTeam } from "../../../lib/leagueTransactions";
import { AssetChips } from "../../../components/TransactionsTicker";
import { formatTwitterTimestamp } from "../../../lib/formatTime";
import CommentsSection from "../../../components/CommentsSection";
import { announceLeagueTransactions, tradeLabel } from "../../../lib/announceTransactions";
import { getLeagueValueSettings } from "../../../lib/playerValue";
import { backend } from "../../../lib/api";
import { buildTradeValueLookup, TradeValueLookup } from "../../../lib/tradeValue";
import { gradeTrade } from "../../../lib/tradeGrade";

function formatValue(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

// Same star scale Trade Calculator already grades players by - one full
// star per 2000 real trade value, so a "grade" here means the same thing
// it does there.
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
      {full === 0 && partial === 0 && <Text className="text-gray-600 text-[10px] italic">no valued players</Text>}
    </View>
  );
}

function TeamNameLink({ team }: { team: TxTeam }) {
  const router = useRouter();
  return (
    <Pressable
      disabled={!team.userId}
      onPress={(e) => {
        e.stopPropagation();
        if (team.userId) router.push(`/profile/manager/${team.userId}`);
      }}
      hitSlop={4}
    >
      <Text className="text-white font-bold text-[13px]">{team.name}</Text>
    </Pressable>
  );
}

function TradeCard({ event, leagueId, valueFor }: { event: TradeEvent; leagueId: string; valueFor: TradeValueLookup | null }) {
  const [showGrade, setShowGrade] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const grade = valueFor ? gradeTrade(event, valueFor) : null;
  const maxSideValue = grade ? Math.max(1, ...grade.sides.map((s) => s.value)) : 1;

  return (
    <Pressable onPress={() => setShowGrade((s) => !s)} className="border-b border-white/10">
      <View className="px-4 py-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-gray-500 text-[11px]">{formatTwitterTimestamp(event.timestamp)} ago</Text>
          <Feather name={showGrade ? "chevron-up" : "chevron-down"} size={14} color="#6b7280" />
        </View>
        {event.kind === "trade2" ? (
          <View className="gap-1.5">
            <View className="flex-row items-center flex-wrap gap-1.5">
              <TeamNameLink team={event.teamA} />
              <Text className="text-gray-400 text-[13px]">sends</Text>
            </View>
            <AssetChips assets={event.aGives} />
            <View className="flex-row items-center flex-wrap gap-1.5 mt-1">
              <TeamNameLink team={event.teamB} />
              <Text className="text-gray-400 text-[13px]">sends</Text>
            </View>
            <AssetChips assets={event.aGets} />
          </View>
        ) : (
          <View className="gap-2">
            {event.parts.map((part, i) => (
              <View key={i}>
                <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
                  <TeamNameLink team={part.team} />
                  <Text className="text-white text-[13px] font-bold">receives</Text>
                </View>
                <AssetChips assets={part.receives} />
              </View>
            ))}
          </View>
        )}

        {showGrade && grade && (
          <View className="mt-3 bg-white/5 rounded-xl p-3 gap-2.5">
            {grade.sides.map((side, i) => (
              <View key={i} className="gap-1">
                <View className="flex-row items-center justify-between">
                  <Text numberOfLines={1} className="text-white text-[12px] font-bold flex-1 mr-2">
                    {side.team.name}
                  </Text>
                  <Text className="text-gray-400 text-[11px] font-bold">{formatValue(side.value)}</Text>
                </View>
                <View className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <View
                    style={{ width: `${Math.max(4, (side.value / maxSideValue) * 100)}%`, backgroundColor: grade.winner?.userId === side.team.userId ? "#22c55e" : "#4b5563" }}
                    className="h-full rounded-full"
                  />
                </View>
                <Stars value={side.value} />
              </View>
            ))}

            <View
              style={{ backgroundColor: `${grade.verdict.color}18`, borderColor: grade.verdict.color }}
              className="self-center mt-1 px-3 py-1 rounded-full border"
            >
              <Text style={{ color: grade.verdict.color }} className="text-[11px] font-bold">
                {grade.verdict.text}
                {grade.winner ? ` · Favors ${grade.winner.name}` : ""}
              </Text>
            </View>
          </View>
        )}

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            setShowComments((c) => !c);
          }}
          className="flex-row items-center gap-1.5 mt-3"
        >
          <Feather name="message-circle" size={13} color="#9ca3af" />
          <Text className="text-gray-400 text-[12px] font-semibold">
            {showComments ? "Hide comments" : "Comments"}
          </Text>
        </Pressable>
      </View>

      {showComments && (
        <Pressable onPress={(e) => e.stopPropagation()}>
          <CommentsSection targetType="trade" targetId={event.id} leagueId={leagueId} targetLabel={tradeLabel(event)} />
        </Pressable>
      )}
    </Pressable>
  );
}

export default function Trades() {
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
      <View className="px-4 pt-4 pb-3 border-b border-white/10">
        <Text className="text-white text-[17px] font-bold">Trades</Text>
        <Text className="text-gray-500 text-[12px] mt-0.5">This season - tap a trade to grade it, or to comment</Text>
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
            <TradeCard key={event.id} event={event} leagueId={leagueID} valueFor={valueFor} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
