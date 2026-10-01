// A real injury feed scoped to the signed-in manager's OWN roster, not a
// leaguewide news wall nobody asked for. Sleeper's own injury_status field
// is already in the players payload this app fetches everywhere else
// (backend.fetchPlayers) - it just never surfaced in any UI until now (see
// lib/playerBio.ts's injuryBadge). Only renders for a manager whose
// Firebase account is actually linked to a real Sleeper user id (see
// lib/socialAuth.ts's UserProfile.sleeperUserId) - with nothing to key
// "your roster" off, this stays silent rather than guessing.
import { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { onAuthChange, getUserProfile } from "../lib/socialAuth";
import { sleeper, backend } from "../lib/api";
import { injuryBadge } from "../lib/playerBio";

interface InjuredPlayer {
  id: string;
  name: string;
  pos: string;
  team?: string;
  status: string;
}

export default function InjuryReport({ leagueID }: { leagueID: string }) {
  const [players, setPlayers] = useState<InjuredPlayer[] | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    const unsubscribe = onAuthChange(async (user) => {
      if (!user) {
        if (!cancelled) setPlayers([]);
        return;
      }
      try {
        const profile = await getUserProfile(user.uid);
        if (!profile?.sleeperUserId) {
          if (!cancelled) setPlayers([]);
          return;
        }
        const [{ data: rosters }, playersData] = await Promise.all([
          sleeper.getLeagueRosters(leagueID),
          backend.fetchPlayers(leagueID),
        ]);
        if (cancelled) return;

        const myRoster = rosters.find((r: any) => r.owner_id === profile.sleeperUserId);
        const injured: InjuredPlayer[] = (myRoster?.players ?? [])
          .map((id: string) => {
            const p = playersData?.[id];
            if (!p?.is) return null;
            return { id, name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim() || "Unknown", pos: p.pos, team: p.t, status: p.is as string };
          })
          .filter((p: InjuredPlayer | null): p is InjuredPlayer => p !== null);

        if (!cancelled) setPlayers(injured);
      } catch (error) {
        console.error("Error loading injury report:", error);
        if (!cancelled) setPlayers([]);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [leagueID]);

  if (!players || players.length === 0) return null;

  return (
    <View className="px-4 pt-5">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Feather name="alert-circle" size={11} color="#ef4444" />
        <Text className="text-gray-500 text-[10px] font-bold tracking-widest">YOUR ROSTER · INJURY REPORT</Text>
      </View>
      <View className="bg-[#141416] border border-white/10 rounded-2xl overflow-hidden">
        {players.map((p, i) => {
          const badge = injuryBadge(p.status)!;
          return (
            <View
              key={p.id}
              className={`flex-row items-center justify-between px-3.5 py-2.5 ${i !== 0 ? "border-t border-white/5" : ""}`}
            >
              <View className="flex-row items-center gap-2.5 flex-1" style={{ minWidth: 0 }}>
                <Image
                  source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg` }}
                  className="w-8 h-8 rounded-full bg-white/10"
                />
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} className="text-white text-[13px] font-semibold">
                    {p.name}
                  </Text>
                  <Text className="text-gray-500 text-[11px]">
                    {p.pos}
                    {p.team ? ` · ${p.team}` : ""}
                  </Text>
                </View>
              </View>
              <View style={{ backgroundColor: badge.color }} className="px-2 py-1 rounded-md">
                <Text className="text-white text-[10px] font-extrabold">{badge.label}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
