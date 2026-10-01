// Luck Index - the real "all-play" record every serious fantasy site
// tracks and this app never had: how many of the OTHER teams you'd have
// beaten in each real week you played, not just the one opponent Sleeper's
// schedule happened to pair you against. Summed up and compared to a
// team's real record, the gap is a genuine signal - not vibes - for
// whether a record is backed by real scoring or inflated/deflated by
// matchup timing.
import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import { buildLeagueSimData } from "../../../lib/leagueSimData";

const helmet = require("../../../assets/images/helmet2.png");

interface LuckRow {
  userId: string;
  name: string;
  avatar?: string;
  wins: number;
  losses: number;
  allPlayWins: number;
  allPlayLosses: number;
  luck: number;
}

function luckMeta(luck: number): { label: string; color: string } {
  if (luck >= 0.75) return { label: "LUCKY", color: "#22c55e" };
  if (luck <= -0.75) return { label: "UNLUCKY", color: "#ef4444" };
  return { label: "ABOUT RIGHT", color: "#6b7280" };
}

export default function LuckIndex() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [rows, setRows] = useState<LuckRow[] | null>(null);
  const [weeksPlayed, setWeeksPlayed] = useState(0);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: nflState }, sim] = await Promise.all([sleeper.getNflState(), buildLeagueSimData(leagueID)]);
        if (cancelled) return;

        const currentWeek: number = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
        setWeeksPlayed(playedWeeks.length);

        const allPlayWinsByTeam: Record<string, number> = {};
        const gamesByTeam: Record<string, number> = {};
        sim.teamIds.forEach((id) => {
          allPlayWinsByTeam[id] = 0;
          gamesByTeam[id] = 0;
        });

        for (const week of playedWeeks) {
          const scores = sim.teamIds
            .map((id) => ({ id, pts: parseFloat(sim.matchupData[week]?.[id]?.team_points || "0") }))
            .filter((s) => s.pts > 0);
          if (scores.length < 2) continue;
          for (const team of scores) {
            let beats = 0;
            let ties = 0;
            for (const opp of scores) {
              if (opp.id === team.id) continue;
              if (team.pts > opp.pts) beats++;
              else if (team.pts === opp.pts) ties++;
            }
            allPlayWinsByTeam[team.id] += beats + ties * 0.5;
            gamesByTeam[team.id] += scores.length - 1;
          }
        }

        const result: LuckRow[] = sim.teamIds
          .map((id) => {
            const info = sim.managerInfo[id];
            const wins = parseInt(info?.wins || "0");
            const losses = parseInt(info?.losses || "0");
            const actualGames = wins + losses;
            const allPlayWinPct = gamesByTeam[id] > 0 ? allPlayWinsByTeam[id] / gamesByTeam[id] : 0.5;
            const allPlayWins = allPlayWinPct * actualGames;
            return {
              userId: id,
              name: info?.name ?? "Unknown Team",
              avatar: info?.avatar,
              wins,
              losses,
              allPlayWins,
              allPlayLosses: actualGames - allPlayWins,
              luck: wins - allPlayWins,
            };
          })
          .sort((a, b) => b.luck - a.luck);

        if (!cancelled) setRows(result);
      } catch (error) {
        console.error("Error computing luck index:", error);
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (!rows) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  const maxAbsLuck = Math.max(0.5, ...rows.map((r) => Math.abs(r.luck)));

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
      <Text className="text-[11px] font-bold tracking-widest text-brand">LUCK INDEX</Text>
      <Text className="text-white text-[21px] font-bold mt-0.5">Who&apos;s Actually Good?</Text>
      <Text className="text-gray-500 text-[12px] mt-1">
        Your real record vs. your &quot;all-play&quot; record - how many of the OTHER {rows.length - 1 >= 0 ? rows.length - 1 : 0}{" "}
        teams you&apos;d have beaten each week, not just the one Sleeper scheduled you against. {weeksPlayed} week
        {weeksPlayed === 1 ? "" : "s"} of real scores.
      </Text>

      {rows.length === 0 ? (
        <Text className="text-gray-600 text-[13px] mt-6">Not enough games played yet for a real read.</Text>
      ) : (
        <View className="mt-4 gap-2.5">
          {rows.map((r) => {
            const meta = luckMeta(r.luck);
            const barPct = Math.min(100, (Math.abs(r.luck) / maxAbsLuck) * 100);
            return (
              <View key={r.userId} className="bg-[#141416] border border-white/10 rounded-2xl p-3.5">
                <View className="flex-row items-center gap-3">
                  <Image source={r.avatar ? { uri: r.avatar } : helmet} className="w-10 h-10 rounded-full bg-white/10" />
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} className="text-white text-[14px] font-bold">
                      {r.name}
                    </Text>
                    <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-400 text-[11px] mt-0.5">
                      {r.wins}-{r.losses} real · {r.allPlayWins.toFixed(1)}-{r.allPlayLosses.toFixed(1)} all-play
                    </Text>
                  </View>
                  <View className="items-end">
                    <View style={{ backgroundColor: `${meta.color}22` }} className="px-2.5 py-1 rounded-full">
                      <Text style={{ color: meta.color }} className="text-[10px] font-bold">
                        {meta.label}
                      </Text>
                    </View>
                    <Text style={{ color: meta.color, fontVariant: ["tabular-nums"] }} className="text-[13px] font-extrabold mt-1">
                      {r.luck >= 0 ? "+" : ""}
                      {r.luck.toFixed(1)}
                    </Text>
                  </View>
                </View>
                <View className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-3">
                  <View
                    style={{
                      width: `${barPct}%`,
                      backgroundColor: meta.color,
                      marginLeft: r.luck < 0 ? `${100 - barPct}%` : 0,
                    }}
                    className="h-full rounded-full"
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View className="flex-row items-start gap-2 mt-4 px-1">
        <Feather name="info" size={12} color="#6b7280" style={{ marginTop: 1 }} />
        <Text className="text-gray-600 text-[11px] flex-1">
          Positive luck means your record is better than your weekly scoring alone would predict - negative means the
          opposite. Not a judgment on your team, just your schedule.
        </Text>
      </View>
    </ScrollView>
  );
}
