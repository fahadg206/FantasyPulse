import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Trades from "./trades";
import TradeCalculator from "./tradecalculator";
import TradeFinderScreen from "./tradefinder";

type Tab = "history" | "calculator" | "finder";

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "history", label: "History", icon: "clock" },
  { key: "calculator", label: "Calculator", icon: "sliders" },
  { key: "finder", label: "Finder", icon: "search" },
];

export default function TradeCenter() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [tab, setTab] = useState<Tab>("calculator");

  if (!leagueID) return null;

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">TRADE CENTER</Text>
        <Text className="text-white text-[21px] font-bold">Everything Trades</Text>
        <Text className="text-gray-500 text-[12px] mt-1.5">
          What happened, what you're building, and who else in the league would say yes - all in one place.
        </Text>
      </View>

      <View className="flex-row px-4 pb-3 gap-2">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-full ${
                active ? "bg-brand" : "bg-white/5 border border-white/10"
              }`}
            >
              <Feather name={t.icon} size={13} color={active ? "#fff" : "#9ca3af"} />
              <Text className={`text-[12px] font-bold ${active ? "text-white" : "text-gray-400"}`}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-1">
        {tab === "history" && <Trades hideHeader />}
        {tab === "calculator" && <TradeCalculator hideHeader />}
        {tab === "finder" && <TradeFinderScreen hideHeader />}
      </View>
    </View>
  );
}
