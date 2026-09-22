import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import type { FantasyProfileStats } from "../lib/fantasyProfile";
import { getTopRosteredPlayers, getRecentAcquisitions, getWeeklyMatchups, TopRosteredPlayer, RecentAcquisition, WeeklyMatchup } from "../lib/profileActivity";
import { formatTwitterTimestamp } from "../lib/formatTime";
import Avatar from "./Avatar";

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2.5">{children}</Text>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View className="bg-[#141416] rounded-2xl border border-white/10 p-4 mb-4">{children}</View>;
}

// Everything that brings a Fantasy Profile to life beyond a bare record:
// this week's matchups, top rostered players, recent pickups, and the
// leagues themselves (tappable through to the real league). Shared by both
// the signed-in user's own profile and anyone else's public profile page,
// so the two never drift apart visually.
export default function ProfileActivity({ sleeperUserId, stats }: { sleeperUserId: string; stats: FantasyProfileStats }) {
  const router = useRouter();
  const [matchups, setMatchups] = useState<WeeklyMatchup[] | null>(null);
  const [topPlayers, setTopPlayers] = useState<TopRosteredPlayer[] | null>(null);
  const [acquisitions, setAcquisitions] = useState<RecentAcquisition[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const leagues = stats.leagues.map((l) => ({ leagueId: l.leagueId, leagueName: l.leagueName }));

    getWeeklyMatchups(sleeperUserId, leagues)
      .then((r) => !cancelled && setMatchups(r))
      .catch(console.error);
    getTopRosteredPlayers(sleeperUserId, leagues, 3)
      .then((r) => !cancelled && setTopPlayers(r))
      .catch(console.error);
    getRecentAcquisitions(sleeperUserId, leagues, 5)
      .then((r) => !cancelled && setAcquisitions(r))
      .catch(console.error);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeperUserId, stats.leagues.map((l) => l.leagueId).join(",")]);

  return (
    <View>
      {/* This Week's Matchups */}
      {matchups === null ? (
        <View className="items-center py-6">
          <ActivityIndicator color="#af1222" />
        </View>
      ) : matchups.length > 0 ? (
        <View className="mb-1">
          <SectionLabel>WEEK {matchups[0].week} MATCHUPS</SectionLabel>
          {matchups.map((m) => (
            <Pressable
              key={m.leagueId}
              onPress={() =>
                m.hasOpponent
                  ? router.push({
                      pathname: "/league/[leagueID]/matchup",
                      params: { leagueID: m.leagueId, week: String(m.week), matchupID: m.matchupId },
                    } as any)
                  : router.push(`/league/${m.leagueId}` as any)
              }
              className="bg-[#141416] rounded-2xl border border-white/10 p-3.5 mb-2.5"
            >
              <Text numberOfLines={1} className="text-gray-500 text-[10px] font-bold mb-2">
                {m.leagueName.toUpperCase()}
              </Text>
              <View className="flex-row items-center justify-between">
                <MatchupSide name={m.myTeamName} score={m.myScore} leading={m.myScore >= m.oppScore} />
                <Text className="text-gray-600 text-[11px] mx-2">vs</Text>
                <MatchupSide
                  name={m.oppTeamName}
                  score={m.oppScore}
                  leading={m.oppScore > m.myScore}
                  avatar={m.oppAvatar}
                  align="right"
                />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Top Rostered Players */}
      {topPlayers === null ? null : topPlayers.length > 0 ? (
        <Card>
          <SectionLabel>TOP ROSTERED PLAYERS</SectionLabel>
          <View className="gap-2.5">
            {topPlayers.map((p) => (
              <View key={p.playerId} className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Text
                    style={{ color: POSITION_COLOR[p.pos ?? ""] ?? "#9ca3af" }}
                    className="text-[10px] font-extrabold w-7"
                  >
                    {p.pos ?? "-"}
                  </Text>
                  <Text numberOfLines={1} className="text-white text-[13px] font-semibold flex-1">
                    {p.name}
                  </Text>
                </View>
                <Text className="text-gray-500 text-[11px]">
                  {p.leagueCount} of {stats.totals.leaguesCount} leagues
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Recent Acquisitions */}
      {acquisitions === null ? null : acquisitions.length > 0 ? (
        <Card>
          <SectionLabel>RECENTLY ACQUIRED</SectionLabel>
          <View className="gap-2.5">
            {acquisitions.map((a, i) => (
              <View key={`${a.playerId}_${a.leagueId}_${i}`} className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Feather name={a.via === "trade" ? "repeat" : "trending-up"} size={12} color="#af1222" />
                  <Text numberOfLines={1} className="text-white text-[13px] font-semibold flex-1">
                    {a.name}
                    {a.pos ? <Text className="text-gray-500"> · {a.pos}</Text> : null}
                  </Text>
                </View>
                <Text className="text-gray-500 text-[11px]">{formatTwitterTimestamp(a.timestamp)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Leagues */}
      <SectionLabel>{stats.season} SEASON · {stats.totals.leaguesCount} LEAGUES</SectionLabel>
      {stats.leagues.map((l) => (
        <Pressable
          key={l.leagueId}
          onPress={() => router.push(`/league/${l.leagueId}` as any)}
          className="flex-row items-center justify-between bg-[#141416] rounded-xl border border-white/10 px-4 py-3 mb-2"
        >
          <View className="flex-row items-center flex-1 mr-2">
            <Avatar url={l.avatar} name={l.leagueName} size={28} kind="league" />
            <View className="ml-2.5 flex-1">
              <Text numberOfLines={1} className="text-white font-semibold text-[13px]">
                {l.leagueName}
              </Text>
              <Text className="text-gray-500 text-[11px]">
                Rank #{l.rank} of {l.totalTeams}
              </Text>
            </View>
          </View>
          <View className="items-end mr-1">
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
              {l.wins}-{l.losses}
            </Text>
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-500 text-[11px]">
              {l.pointsFor.toFixed(1)} pts
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color="#6b7280" />
        </Pressable>
      ))}
    </View>
  );
}

function MatchupSide({
  name,
  score,
  leading,
  avatar,
  align = "left",
}: {
  name: string;
  score: number;
  leading: boolean;
  avatar?: string;
  align?: "left" | "right";
}) {
  return (
    <View className={`flex-1 items-${align === "right" ? "end" : "start"}`}>
      <View className={`flex-row items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <Avatar url={avatar} name={name} size={22} />
        <Text
          numberOfLines={1}
          className={`text-[12px] max-w-[90px] ${leading ? "text-white font-bold" : "text-gray-500 font-semibold"}`}
        >
          {name}
        </Text>
      </View>
      <Text
        style={{ fontVariant: ["tabular-nums"] }}
        className={`text-[17px] mt-0.5 ${leading ? "text-white font-extrabold" : "text-gray-500 font-bold"}`}
      >
        {score.toFixed(1)}
      </Text>
    </View>
  );
}
