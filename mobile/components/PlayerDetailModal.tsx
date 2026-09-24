import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, Modal, ScrollView, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getTeamColor, getTeamLogo } from "../lib/nflTeams";
import { sleeper } from "../lib/api";
import { getPlayerGameLog, GameLogEntry } from "../lib/playerBoxScore";

interface Props {
  visible: boolean;
  onClose: () => void;
  leagueID: string;
  playerId?: string;
  name: string;
  position: string;
  team?: string;
  photoUri?: string;
}

// The "Enhanced Player Card" - a real game log and season trend, not just
// the name/position/team tile PlayerCard shows inline everywhere. Opens
// as its own self-contained modal (own fetch, own loading state) so any
// of PlayerCard's many call sites can wire it in with nothing more than
// an onExpand handler - the same pattern used throughout this app for
// tap-to-drill-down (WeekOpponentModal, TeamAnalyticsModal, ...).
export default function PlayerDetailModal({ visible, onClose, leagueID, playerId, name, position, team, photoUri }: Props) {
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<GameLogEntry[]>([]);

  useEffect(() => {
    if (!visible || !playerId || !leagueID) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [{ data: league }, { data: nflState }] = await Promise.all([
          sleeper.getLeague(leagueID),
          sleeper.getNflState(),
        ]);
        if (cancelled) return;
        const throughWeek = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const entries = await getPlayerGameLog(playerId, position, league.season, throughWeek, league.scoring_settings || {});
        if (!cancelled) setLog(entries);
      } catch (error) {
        console.error("Error loading player game log:", error);
        if (!cancelled) setLog([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, playerId, leagueID, position]);

  const color = getTeamColor(team);
  const logo = getTeamLogo(team);
  const resolvedPhoto =
    photoUri ?? (position === "DEF" ? logo ?? undefined : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`);

  const gamesPlayed = log.length;
  const totalPoints = log.reduce((s, g) => s + g.points, 0);
  const ppg = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
  const best = log.reduce((max, g) => (g.points > (max?.points ?? -Infinity) ? g : max), undefined as GameLogEntry | undefined);
  const maxPoints = Math.max(1, ...log.map((g) => g.points));
  const trend = [...log].reverse(); // oldest-to-newest, the natural way to read a trend left to right

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable className="bg-[#0c0c0e] rounded-t-3xl overflow-hidden" style={{ maxHeight: "85%" }} onPress={() => {}}>
          <View className="items-center pt-3 pb-1">
            <View className="w-9 h-1 rounded-full bg-white/15" />
          </View>

          <View style={{ backgroundColor: color }} className="overflow-hidden">
            {logo && (
              <Image
                source={{ uri: logo }}
                resizeMode="contain"
                style={{ position: "absolute", width: 150, height: 150, opacity: 0.28, right: -30, top: -30 }}
              />
            )}
            <View className="items-center px-5 pt-2 pb-5">
              <Image
                source={resolvedPhoto ? { uri: resolvedPhoto } : undefined}
                className={position === "DEF" ? "w-[64px] h-[64px] mb-2" : "w-[72px] h-[72px] rounded-full mb-2 bg-white/20"}
                resizeMode={position === "DEF" ? "contain" : "cover"}
              />
              <Text className="text-white text-[19px] font-bold">{name}</Text>
              <Text className="text-white/85 text-[12px] font-semibold mt-0.5">
                {position}
                {team ? ` · ${team}` : ""}
              </Text>
            </View>
          </View>

          {loading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#af1222" />
            </View>
          ) : (
            <ScrollView contentContainerClassName="px-5 pb-8 pt-4" showsVerticalScrollIndicator={false}>
              <View className="flex-row bg-[#141416] border border-white/10 rounded-2xl p-3 mb-5">
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">GP</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{gamesPlayed}</Text>
                </View>
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">PPG</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{ppg.toFixed(1)}</Text>
                </View>
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">TOTAL</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{totalPoints.toFixed(1)}</Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-gray-500 text-[10px]">BEST</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{best ? best.points.toFixed(1) : "-"}</Text>
                </View>
              </View>

              {trend.length > 1 && (
                <View className="mb-5">
                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">SEASON TREND</Text>
                  <View className="flex-row items-end gap-1.5 h-[70px]">
                    {trend.map((g) => (
                      <View key={g.week} className="flex-1 items-center">
                        <View
                          style={{ height: Math.max(4, (g.points / maxPoints) * 60), backgroundColor: "#af1222" }}
                          className="w-full rounded-t-sm opacity-80"
                        />
                        <Text className="text-gray-600 text-[8px] font-bold mt-1">{g.week}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-2">GAME LOG</Text>
              {log.length === 0 ? (
                <Text className="text-gray-500 text-[13px]">No games played yet this season.</Text>
              ) : (
                <View className="bg-[#141416] border border-white/10 rounded-2xl overflow-hidden">
                  {log.map((g, i) => (
                    <View
                      key={g.week}
                      className={`flex-row items-center px-3.5 py-3 ${i !== 0 ? "border-t border-white/5" : ""}`}
                    >
                      <Text className="text-gray-400 text-[11px] font-bold w-[46px]">WK {g.week}</Text>
                      <Text numberOfLines={1} className="flex-1 text-gray-400 text-[11px] mr-2">
                        {g.boxScoreLine ?? "—"}
                      </Text>
                      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
                        {g.points.toFixed(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          <Pressable onPress={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/30 items-center justify-center">
            <Feather name="x" size={16} color="#fff" />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
