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

interface LeagueMeta {
  season: string;
  isDynasty: boolean;
  leagueValueSettings: LeagueValueSettings;
  playersData: Record<string, any>;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
  maxWeek: number;
}

// Sleeper's own "LV"/"OAK" alias (see fetchPlayers.js) points both ids at
// the literal same defense - without this, that one real team shows up
// as two identical rows and inflates the whole DEF group's Sleeper-derived
// ranks by one phantom "player".
const SKIP_PLAYER_IDS = new Set(["OAK"]);

export default function WeeklyRankingsScreen() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const playerDetail = usePlayerDetail();

  const [week, setWeek] = useState(1);
  const [pos, setPos] = useState("QB");
  const [query, setQuery] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [leagueMeta, setLeagueMeta] = useState<LeagueMeta | null>(null);
  const [rankingsByPos, setRankingsByPos] = useState<Record<string, StartSitPlayer[]>>({});

  // League-wide data + the real current fantasy week, once.
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
        const maxWeek = (league.settings?.playoff_week_start ?? 15) + 3; // real regular season + real playoffs, same bound Trade Calculator's win-impact projection uses
        setWeek(currentWeek);

        let valuesBySleeperId: Record<string, RawPlayerValue> | undefined;
        if (settings.isDynasty) {
          valuesBySleeperId = await backend.fetchAllPlayerValues();
          if (cancelled) return;
        }

        setLeagueMeta({ season: league.season, isDynasty: settings.isDynasty, leagueValueSettings: settings, playersData, valuesBySleeperId, maxWeek });
      } catch (error) {
        console.error("Error loading league data for rankings:", error);
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  // Score every real fantasy-relevant player in the league once per week -
  // the same real Sleeper/ESPN/KTC/FantasyCalc consensus engine Start/Sit
  // uses, just run over the whole player pool instead of one roster, so
  // flipping position tabs afterward is instant (no rescoring, just
  // filtering what's already in memory). Re-runs whenever the selected
  // week changes - Sleeper's projections and ESPN's rankings are real
  // per-week numbers, not just a label swap.
  useEffect(() => {
    if (!leagueMeta) return;
    let cancelled = false;
    setLoadingWeek(true);

    (async () => {
      try {
        const allIds = Object.keys(leagueMeta.playersData).filter((id) => !SKIP_PLAYER_IDS.has(id));
        const scored = await scoreArbitraryPlayers({
          playerIds: allIds,
          week,
          season: leagueMeta.season,
          playersData: leagueMeta.playersData,
          isDynasty: leagueMeta.isDynasty,
          leagueValueSettings: leagueMeta.leagueValueSettings,
          valuesBySleeperId: leagueMeta.valuesBySleeperId,
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
        if (!cancelled) setLoadingWeek(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueMeta, week]);

  const loading = loadingMeta || loadingWeek;
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
        <View className="flex-row items-center justify-between">
          <Text className="text-[11px] font-bold tracking-widest text-brand">WEEK {week} RANKINGS</Text>
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => setWeek((w) => Math.max(1, w - 1))}
              disabled={week <= 1}
              hitSlop={8}
              style={{ opacity: week <= 1 ? 0.3 : 1 }}
              className="w-6 h-6 rounded-full bg-white/10 items-center justify-center"
            >
              <Feather name="chevron-left" size={13} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setWeek((w) => Math.min(leagueMeta?.maxWeek ?? 18, w + 1))}
              disabled={week >= (leagueMeta?.maxWeek ?? 18)}
              hitSlop={8}
              style={{ opacity: week >= (leagueMeta?.maxWeek ?? 18) ? 0.3 : 1 }}
              className="w-6 h-6 rounded-full bg-white/10 items-center justify-center"
            >
              <Feather name="chevron-right" size={13} color="#fff" />
            </Pressable>
          </View>
        </View>
        <Text className="text-white text-[21px] font-bold mt-0.5">Player Rankings</Text>
        <Text className="text-gray-500 text-[12px] mt-1.5">
          Sleeper and ESPN are real Week {week} rankings; KTC and FantasyCalc reflect current{" "}
          {leagueMeta?.isDynasty ? "dynasty" : "redraft"} trade value, not this week's matchup - all four averaged into
          one consensus rank.
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
            renderItem={({ item: p, index }) => {
              const logo = getTeamLogo(p.team);
              return (
                <Pressable
                  onPress={() => playerDetail?.openPlayer({ playerId: p.playerId, name: p.name, position: p.pos, team: p.team })}
                  className={`flex-row items-center px-4 py-2.5 border-b border-white/5 ${index % 2 === 1 ? "bg-brand/5" : ""}`}
                >
                  <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[13px] font-bold w-[26px]">
                    {index + 1}
                  </Text>
                  <View style={{ backgroundColor: getTeamColor(p.team) }} className="w-8 h-8 rounded-full items-center justify-center overflow-hidden mr-2.5">
                    {logo && p.pos !== "DEF" && (
                      <Image source={{ uri: logo }} resizeMode="contain" style={{ position: "absolute", width: 26, height: 26, opacity: 0.4 }} />
                    )}
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
              );
            }}
            ListEmptyComponent={
              <Text className="text-gray-500 text-[13px] text-center py-10">No players found.</Text>
            }
          />
        </>
      )}
    </View>
  );
}
