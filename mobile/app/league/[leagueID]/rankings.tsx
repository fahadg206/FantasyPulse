import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, Pressable, TextInput, ActivityIndicator, FlatList } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper, backend } from "../../../lib/api";
import { getLeagueValueSettings, LeagueValueSettings, RawPlayerValue } from "../../../lib/playerValue";
import { scoreArbitraryPlayers, StartSitPlayer, getSourceLogo } from "../../../lib/startSit";
import { getTeamColor, getTeamLogo, getPositionColor } from "../../../lib/nflTeams";
import { usePlayerDetail } from "../../../components/PlayerDetailProvider";

const POSITIONS = ["QB", "RB", "WR", "TE", "DEF", "K"];
const POSITION_LABEL: Record<string, string> = { DEF: "D/ST" };

// Priority order for source columns - Sleeper and ESPN cover every
// position, KTC/FantasyCalc only price the four skill positions (verified
// live - neither has a real market for K/DEF), so those two columns
// simply never appear on those tabs.
const SOURCE_ORDER = ["Sleeper", "ESPN", "KTC", "FantasyCalc"];

function playerPhotoUri(playerId: string, pos: string | undefined, team: string | undefined): string | undefined {
  if (pos === "DEF") return getTeamLogo(team) ?? undefined;
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
}

export default function WeeklyRankingsScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const playerDetail = usePlayerDetail();

  const [week, setWeek] = useState(1);
  const [pos, setPos] = useState("QB");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [rankingsByPos, setRankingsByPos] = useState<Record<string, StartSitPlayer[]>>({});

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      try {
        const [league, settings, playersData, nflState] = await Promise.all([
          sleeper.getLeague(leagueID).then((r) => r.data),
          getLeagueValueSettings(leagueID),
          backend.fetchPlayers(leagueID),
          sleeper.getNflState().then((r) => r.data),
        ]);
        if (cancelled) return;

        const currentWeek = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        setWeek(currentWeek);

        let valuesBySleeperId: Record<string, RawPlayerValue> | undefined;
        if (settings.isDynasty) {
          valuesBySleeperId = await backend.fetchAllPlayerValues();
          if (cancelled) return;
        }

        // Score every real fantasy-relevant player in the league once, up
        // front - the same real Sleeper/ESPN/KTC/FantasyCalc consensus
        // engine Start/Sit uses, just run over the whole player pool
        // instead of one roster, so flipping position tabs afterward is
        // instant (no rescoring, just filtering what's already in memory).
        const allIds = Object.keys(playersData);
        const scored = await scoreArbitraryPlayers({
          playerIds: allIds,
          week: currentWeek,
          season: league.season,
          playersData,
          isDynasty: settings.isDynasty,
          leagueValueSettings: settings,
          valuesBySleeperId,
        });
        if (cancelled) return;

        const byPos: Record<string, StartSitPlayer[]> = {};
        for (const p of scored) {
          if (!POSITIONS.includes(p.pos)) continue;
          (byPos[p.pos] ??= []).push(p);
        }
        for (const list of Object.values(byPos)) {
          list.sort((a, b) => {
            const ar = a.consensusRank ?? Infinity;
            const br = b.consensusRank ?? Infinity;
            if (ar !== br) return ar - br;
            return b.projectedPoints - a.projectedPoints;
          });
        }
        setRankingsByPos(byPos);
      } catch (error) {
        console.error("Error loading weekly rankings:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  const list = rankingsByPos[pos] ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const sourceColumns = useMemo(() => {
    const present = new Set<string>();
    for (const p of list) for (const s of p.sources) present.add(s.label);
    return SOURCE_ORDER.filter((s) => present.has(s));
  }, [list]);

  if (!leagueID) return null;

  return (
    <View className="flex-1 bg-[#0c0c0e]">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">WEEK {week} RANKINGS</Text>
        <Text className="text-white text-[21px] font-bold">Player Rankings</Text>
        <Text className="text-gray-500 text-[12px] mt-1.5">
          Sleeper, ESPN, KTC, and FantasyCalc, averaged into one consensus rank for every real player in the league.
        </Text>
      </View>

      <View className="flex-row px-4 pb-3 gap-1.5">
        {POSITIONS.map((p) => {
          const active = p === pos;
          const color = getPositionColor(p);
          return (
            <Pressable
              key={p}
              onPress={() => setPos(p)}
              style={{ backgroundColor: active ? color : "transparent", borderColor: color }}
              className="flex-1 items-center py-2 rounded-full border"
            >
              <Text style={{ color: active ? "#fff" : color }} className="text-[12px] font-extrabold">
                {POSITION_LABEL[p] ?? p}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5 mx-4 mb-3">
        <Feather name="search" size={14} color="#6b7280" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${POSITION_LABEL[pos] ?? pos}s…`}
          placeholderTextColor="#6b7280"
          className="flex-1 text-white text-[13px]"
        />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : (
        <>
          <View className="flex-row items-center px-4 pb-2 border-b border-white/10">
            <Text className="text-gray-500 text-[10px] font-bold w-[26px]">#</Text>
            <Text className="text-gray-500 text-[10px] font-bold flex-1">PLAYER</Text>
            {sourceColumns.map((label) => (
              <View key={label} className="w-[38px] items-center">
                {getSourceLogo(label) && (
                  <Image source={{ uri: getSourceLogo(label)! }} style={{ width: 14, height: 14 }} resizeMode="contain" />
                )}
              </View>
            ))}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(p) => p.playerId}
            renderItem={({ item: p, index }) => (
              <Pressable
                onPress={() => playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })}
                className="flex-row items-center px-4 py-2.5 border-b border-white/5"
              >
                <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-bold w-[26px]">
                  {index + 1}
                </Text>
                <View style={{ backgroundColor: getTeamColor(p.team) }} className="w-8 h-8 rounded-full items-center justify-center overflow-hidden mr-2.5">
                  <Image
                    source={{ uri: playerPhotoUri(p.playerId, p.pos, p.team) }}
                    resizeMode={p.pos === "DEF" ? "contain" : "cover"}
                    style={p.pos === "DEF" ? { width: 20, height: 20 } : { width: 32, height: 32, borderRadius: 16 }}
                  />
                </View>
                <View className="flex-1 mr-1">
                  <Text numberOfLines={1} className="text-white text-[13px] font-semibold">
                    {p.name}
                  </Text>
                  <Text className="text-gray-500 text-[10px] mt-0.5">
                    {p.team}
                    {p.opponent ? ` (${p.opponent.isHome ? "vs" : "@"} ${p.opponent.team})` : ""}
                  </Text>
                </View>
                {sourceColumns.map((label) => {
                  const source = p.sources.find((s) => s.label === label);
                  return (
                    <Text key={label} style={{ fontVariant: ["tabular-nums"] }} className="text-gray-300 text-[12px] font-semibold w-[38px] text-center">
                      {source ? Math.round(source.rank) : "—"}
                    </Text>
                  );
                })}
              </Pressable>
            )}
            ListEmptyComponent={
              <Text className="text-gray-500 text-[13px] text-center py-10">No players found.</Text>
            }
          />
        </>
      )}
    </View>
  );
}
