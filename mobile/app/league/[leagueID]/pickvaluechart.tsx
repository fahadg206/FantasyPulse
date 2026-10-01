// A real, standalone reference chart for future draft picks - the same
// "trade value chart" format dynasty communities have passed around for
// years (a poster of 1sts/2nds/3rds/4ths by year and draft slot), except
// every number here is this league's own real, format-adjusted KTC value
// instead of a generic PDF nobody updates. Reuses the exact pricing
// lib/draftPicks.ts's Trade Calculator picks already use - a pick's value
// here always matches what it's worth if you actually tried to trade it.
import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getLeagueValueSettings, LeagueValueSettings } from "../../../lib/playerValue";
import { getPickValueChart, PickValueChartCell, PickTier } from "../../../lib/draftPicks";

const TIER_COLOR: Record<PickTier, string> = { Early: "#af1222", Mid: "#eab308", Late: "#6b7280" };
const TIERS: PickTier[] = ["Early", "Mid", "Late"];

function formatValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

export default function PickValueChart() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [cells, setCells] = useState<PickValueChartCell[] | null>(null);
  const [settings, setSettings] = useState<LeagueValueSettings | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [chart, valueSettings] = await Promise.all([getPickValueChart(leagueID), getLeagueValueSettings(leagueID)]);
        if (cancelled) return;
        setCells(chart);
        setSettings(valueSettings);
      } catch (error) {
        console.error("Error loading pick value chart:", error);
        if (!cancelled) setCells([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (!cells) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  const seasons = Array.from(new Set(cells.map((c) => c.season)));
  const rounds = Array.from(new Set(cells.map((c) => c.round))).sort((a, b) => a - b);
  const maxValue = Math.max(1, ...cells.map((c) => c.value));
  const cellAt = (season: string, tier: PickTier, round: number) =>
    cells.find((c) => c.season === season && c.tier === tier && c.round === round);

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <Text className="text-[11px] font-bold tracking-widest text-brand">DRAFT PICK VALUE CHART</Text>
      <Text className="text-white text-[21px] font-bold mt-0.5">What a Pick Is Really Worth</Text>
      <Text className="text-gray-500 text-[12px] mt-1">
        Real KTC market values, adjusted for this league&apos;s own format - not a generic chart. A 1st from a team about to
        finish last (&quot;Early&quot;) is worth far more than one from the reigning champs (&quot;Late&quot;).
      </Text>
      {settings && (
        <View className="self-start mt-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
          <Text className="text-[10px] font-semibold text-gray-300">
            {settings.isDynasty ? "Dynasty" : "Redraft"}
            {settings.isSuperflex ? " · Superflex" : ""}
          </Text>
        </View>
      )}

      {seasons.map((season) => (
        <View key={season} className="bg-[#141416] border border-white/10 rounded-2xl p-4 mt-4">
          <Text className="text-white text-[15px] font-bold mb-3">{season} Rookie Draft</Text>

          <View className="flex-row mb-1.5 pl-[52px]">
            {TIERS.map((tier) => (
              <View key={tier} style={{ flex: 1 }} className="items-center">
                <Text style={{ color: TIER_COLOR[tier] }} className="text-[10px] font-bold tracking-wide">
                  {tier.toUpperCase()}
                </Text>
              </View>
            ))}
          </View>

          {rounds.map((round) => (
            <View key={round} className="flex-row items-center mb-1.5">
              <View style={{ width: 52 }}>
                <Text className="text-gray-500 text-[11px] font-bold">RD {round}</Text>
              </View>
              {TIERS.map((tier) => {
                const cell = cellAt(season, tier, round);
                const intensity = cell ? Math.max(0.12, cell.value / maxValue) : 0.08;
                return (
                  <View key={tier} style={{ flex: 1 }} className="px-1">
                    <View
                      style={{ backgroundColor: `${TIER_COLOR[tier]}${Math.round(intensity * 255).toString(16).padStart(2, "0")}` }}
                      className="rounded-lg py-2 items-center"
                    >
                      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-extrabold">
                        {cell && cell.value > 0 ? formatValue(cell.value) : "-"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
