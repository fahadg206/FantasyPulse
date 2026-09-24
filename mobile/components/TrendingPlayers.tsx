import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, Pressable } from "react-native";
import { backend } from "../lib/api";
import { getTeamLogo } from "../lib/nflTeams";
import { usePlayerDetail } from "./PlayerDetailProvider";

// Only ever stepped a count down to "K" - a genuinely large count (into
// the millions) just kept dividing by 1,000 with no further tier, so
// 7,560,000 rendered as "7560K" instead of "7.6M".
function formatAddCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return String(count);
}

interface TrendingItem {
  playerId: string;
  name: string;
  pos?: string;
  team?: string;
  count: number;
}

// Sleeper's trending endpoint aggregates add/drop activity across every
// league on the platform in the last 24h - a nice "what's the league-wide
// buzz right now" widget that has nothing to do with this specific league,
// distinct from the local "League Buzz" headlines.
export default function TrendingPlayers({ leagueID }: { leagueID: string }) {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const playerDetail = usePlayerDetail();

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [trending, playersData] = await Promise.all([
          fetch("https://api.sleeper.app/v1/players/nfl/trending/add?limit=10").then((r) => r.json()),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        const resolved: TrendingItem[] = trending.map((t: any) => {
          const p = playersData?.[t.player_id];
          const name = p?.pos === "DEF" ? `${p.t ?? t.player_id} D/ST` : p ? `${p.fn} ${p.ln}` : t.player_id;
          return { playerId: t.player_id, name, pos: p?.pos, team: p?.t, count: t.count };
        });
        setItems(resolved);
      } catch (error) {
        console.error("Error loading trending players:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (items.length === 0) return null;

  return (
    <View className="w-full">
      <Text className="px-4 mb-3 text-[17px] font-bold text-white">
        Trending <Text className="text-gray-500 font-normal">: Hot Waiver Adds League-Wide</Text>
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 gap-2.5">
        {items.map((item, i) => {
          const isDef = item.pos === "DEF";
          const photoUri = isDef
            ? getTeamLogo(item.team) ?? undefined
            : `https://sleepercdn.com/content/nfl/players/thumb/${item.playerId}.jpg`;
          return (
            <Pressable
              key={item.playerId}
              onPress={() => playerDetail?.openPlayer({ playerId: item.playerId, name: item.name, position: item.pos ?? "", team: item.team })}
              style={{ width: 92 }}
              className="items-center bg-[#141416] border border-white/10 rounded-2xl p-3"
            >
              <Text className="text-brand text-[9px] font-bold mb-1">#{i + 1} ADD</Text>
              <Image
                source={photoUri ? { uri: photoUri } : undefined}
                resizeMode={isDef ? "contain" : "cover"}
                className={isDef ? "w-[38px] h-[38px] mb-1.5" : "w-[38px] h-[38px] rounded-full bg-white/10 mb-1.5"}
              />
              <Text numberOfLines={1} className="text-white text-[10px] font-semibold text-center">
                {item.name}
              </Text>
              <Text className="text-gray-500 text-[9px] mt-0.5">
                {formatAddCount(item.count)} adds
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
