import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { sleeper } from "../../../lib/api";
import { buildLeagueSimData } from "../../../lib/leagueSimData";
import { computeStrengthOfSchedule, TeamSOS, WeeklyOpponent, PlayerCard, SOSTier } from "../../../lib/strengthOfSchedule";
import { ensureScheduleStorylinePost } from "../../../lib/boogieAnalyst";

const helmet = require("../../../assets/images/helmet2.png");

const TIER_META: Record<SOSTier, { color: string; bg: string }> = {
  Brutal: { color: "#ef4444", bg: "bg-red-500/15" },
  Tough: { color: "#f97316", bg: "bg-orange-500/15" },
  Balanced: { color: "#eab308", bg: "bg-yellow-500/15" },
  Favorable: { color: "#4ade80", bg: "bg-green-400/15" },
  Cakewalk: { color: "#15803d", bg: "bg-green-800/20" },
};

function tierForStrength(strength: number): SOSTier {
  if (strength >= 80) return "Brutal";
  if (strength >= 60) return "Tough";
  if (strength >= 40) return "Balanced";
  if (strength >= 20) return "Favorable";
  return "Cakewalk";
}

function StreakBadge({ streak }: { streak: string }) {
  if (!streak || streak === "-") return null;
  // Sleeper's own roster.metadata.streak format, e.g. "2W" or "1L".
  const color = streak.includes("W") ? "#4ade80" : streak.includes("L") ? "#ef4444" : "#9ca3af";
  return (
    <View style={{ backgroundColor: `${color}22` }} className="px-1.5 py-0.5 rounded">
      <Text style={{ color }} className="text-[10px] font-bold">
        {streak}
      </Text>
    </View>
  );
}

function PlayerRow({ player }: { player: PlayerCard }) {
  return (
    <View className="flex-row items-center py-2 gap-2.5">
      <Image source={player.avatar ? { uri: player.avatar } : helmet} className="w-8 h-8 rounded-full bg-white/10" />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-white text-[13px] font-semibold">
          {player.name}
        </Text>
        <Text className="text-gray-500 text-[10px]">
          {player.pos ?? ""}
          {player.team ? ` · ${player.team}` : ""}
        </Text>
      </View>
      <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-bold text-[13px]">
        {player.avgPoints.toFixed(1)}
      </Text>
    </View>
  );
}

function WeekCell({ opp, onPress }: { opp: WeeklyOpponent; week: number; onPress: (e: any) => void }) {
  const meta = TIER_META[tierForStrength(opp.strength)];
  return (
    <Pressable onPress={onPress} className="items-center" style={{ width: 26 }}>
      <View style={{ backgroundColor: meta.color }} className="w-full h-6 rounded-md opacity-80" />
      <Text className="text-gray-600 text-[8px] font-bold mt-0.5">{opp.week}</Text>
    </Pressable>
  );
}

/** the popup a single week's heatmap cell opens: who you actually play that week, and where they stand. */
function WeekOpponentModal({ opp, onClose, onViewProfile }: { opp: WeeklyOpponent | null; onClose: () => void; onViewProfile: (userId: string) => void }) {
  const meta = opp ? TIER_META[tierForStrength(opp.strength)] : null;
  return (
    <Modal visible={!!opp} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable className="bg-[#141416] rounded-t-2xl overflow-hidden pb-6" onPress={() => {}}>
          <View className="items-center pt-3 pb-2">
            <View className="w-9 h-1 rounded-full bg-white/15" />
          </View>
          {opp && meta && (
            <View className="px-5 pt-2">
              <Text className="text-gray-500 text-[11px] font-bold tracking-widest text-center mb-3">WEEK {opp.week}</Text>
              <View className="items-center mb-3">
                <Image
                  source={opp.opponentAvatar ? { uri: opp.opponentAvatar } : helmet}
                  className="w-14 h-14 rounded-full bg-white/10 mb-2"
                />
                <Text className="text-white text-[16px] font-bold">{opp.opponentName}</Text>
                <View className="flex-row items-center gap-2 mt-1.5">
                  <Text className="text-gray-400 text-[12px]">
                    {opp.wins}-{opp.losses}
                  </Text>
                  <StreakBadge streak={opp.streak} />
                  <View className={`px-2 py-0.5 rounded-full ${meta.bg}`}>
                    <Text style={{ color: meta.color }} className="text-[11px] font-bold">
                      {tierForStrength(opp.strength)}
                    </Text>
                  </View>
                </View>
              </View>

              <View className="flex-row bg-[#0c0c0e] rounded-xl p-3 mb-3">
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">AVG PTS</Text>
                  <Text className="text-white font-bold text-[15px] mt-0.5">{opp.avgPoints.toFixed(1)}</Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-gray-500 text-[10px]">STRENGTH</Text>
                  <Text style={{ color: meta.color }} className="font-bold text-[15px] mt-0.5">
                    {opp.strength}
                  </Text>
                </View>
              </View>

              {opp.bestPlayers.length > 0 && (
                <View>
                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-1">THEIR BEST PLAYER</Text>
                  <PlayerRow player={opp.bestPlayers[0]} />
                </View>
              )}

              <Pressable
                onPress={() => {
                  onViewProfile(opp.opponentUserId);
                  onClose();
                }}
                className="flex-row items-center justify-center gap-2 mt-3 py-3 rounded-xl border border-white/10"
              >
                <Ionicons name="person-circle-outline" size={16} color="#e5e7eb" />
                <Text className="text-white text-[13px] font-semibold">View Their Profile</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** the deep-dive a team's card opens: their own record/streak/avg, best players, and the full remaining slate with each opponent's record/streak/avg. */
function TeamAnalyticsModal({
  team,
  onClose,
  onViewProfile,
  onSelectWeek,
}: {
  team: TeamSOS | null;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onSelectWeek: (opp: WeeklyOpponent) => void;
}) {
  const meta = team ? TIER_META[team.tier] : null;
  return (
    <Modal visible={!!team} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable className="bg-[#141416] rounded-t-3xl overflow-hidden" style={{ maxHeight: "88%" }} onPress={() => {}}>
          <View className="items-center pt-3 pb-1">
            <View className="w-9 h-1 rounded-full bg-white/15" />
          </View>
          {team && meta && (
            <ScrollView contentContainerClassName="px-5 pb-8 pt-2" showsVerticalScrollIndicator={false}>
              <View className="items-center mb-4">
                <Image
                  source={team.avatar ? { uri: team.avatar } : helmet}
                  className="w-16 h-16 rounded-full bg-white/10 mb-2"
                />
                <Text className="text-white text-[18px] font-bold">{team.name}</Text>
                <View className="flex-row items-center gap-2 mt-1.5">
                  <Text className="text-gray-400 text-[12px]">
                    {team.wins}-{team.losses}
                  </Text>
                  <StreakBadge streak={team.streak} />
                  <View className={`px-2 py-0.5 rounded-full ${meta.bg}`}>
                    <Text style={{ color: meta.color }} className="text-[11px] font-bold">
                      {team.tier} SOS
                    </Text>
                  </View>
                </View>
              </View>

              <View className="flex-row bg-[#0c0c0e] rounded-xl p-3 mb-4">
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">AVG PTS</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{team.avgPoints.toFixed(1)}</Text>
                </View>
                <View className="flex-1 items-center border-r border-white/10">
                  <Text className="text-gray-500 text-[10px]">SOS SCORE</Text>
                  <Text style={{ color: meta.color }} className="font-bold text-[16px] mt-0.5">
                    {team.sosScore}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-gray-500 text-[10px]">GAMES LEFT</Text>
                  <Text className="text-white font-bold text-[16px] mt-0.5">{team.remaining.length}</Text>
                </View>
              </View>

              {team.gauntlet && (
                <View className="bg-[#1c0a0a] border border-red-500/25 rounded-xl p-3 mb-4">
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <Ionicons name="flame" size={13} color="#ef4444" />
                    <Text className="text-red-400 text-[10px] font-bold tracking-widest">GAUNTLET</Text>
                  </View>
                  <Text className="text-gray-300 text-[12px]">
                    Toughest stretch: Weeks {team.gauntlet.startWeek}-{team.gauntlet.endWeek}
                  </Text>
                </View>
              )}

              {team.bestPlayers.length > 0 && (
                <View className="mb-4">
                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-1">BEST PLAYERS</Text>
                  <View className="bg-[#0c0c0e] rounded-xl px-3">
                    {team.bestPlayers.map((p, i) => (
                      <View key={p.id} className={i !== 0 ? "border-t border-white/5" : ""}>
                        <PlayerRow player={p} />
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {(team.toughest || team.easiest) && (
                <View className="flex-row gap-2 mb-4">
                  {team.toughest && (
                    <View className="flex-1 bg-[#0c0c0e] rounded-xl p-3">
                      <View className="flex-row items-center gap-1 mb-1">
                        <Feather name="trending-up" size={11} color="#ef4444" />
                        <Text className="text-gray-500 text-[9px] font-bold tracking-widest">TOUGHEST</Text>
                      </View>
                      <Text numberOfLines={1} className="text-white text-[12px] font-semibold">
                        {team.toughest.opponentName}
                      </Text>
                      <Text className="text-gray-500 text-[10px]">Week {team.toughest.week}</Text>
                    </View>
                  )}
                  {team.easiest && (
                    <View className="flex-1 bg-[#0c0c0e] rounded-xl p-3">
                      <View className="flex-row items-center gap-1 mb-1">
                        <Feather name="trending-down" size={11} color="#4ade80" />
                        <Text className="text-gray-500 text-[9px] font-bold tracking-widest">BEST MATCHUP</Text>
                      </View>
                      <Text numberOfLines={1} className="text-white text-[12px] font-semibold">
                        {team.easiest.opponentName}
                      </Text>
                      <Text className="text-gray-500 text-[10px]">Week {team.easiest.week}</Text>
                    </View>
                  )}
                </View>
              )}

              {team.remaining.length > 0 && (
                <View className="mb-4">
                  <Text className="text-gray-500 text-[10px] font-bold tracking-widest mb-1">REMAINING SCHEDULE</Text>
                  <View className="bg-[#0c0c0e] rounded-xl px-3">
                    {team.remaining.map((r, i) => {
                      const rowMeta = TIER_META[tierForStrength(r.strength)];
                      return (
                        <Pressable
                          key={r.week}
                          onPress={() => onSelectWeek(r)}
                          className={`flex-row items-center py-2.5 gap-2.5 ${i !== 0 ? "border-t border-white/5" : ""}`}
                        >
                          <Text className="text-gray-500 text-[11px] font-bold w-8">Wk{r.week}</Text>
                          <Image
                            source={r.opponentAvatar ? { uri: r.opponentAvatar } : helmet}
                            className="w-7 h-7 rounded-full bg-white/10"
                          />
                          <View className="flex-1">
                            <Text numberOfLines={1} className="text-white text-[12.5px] font-semibold">
                              {r.opponentName}
                            </Text>
                            <Text className="text-gray-500 text-[10px]">
                              {r.wins}-{r.losses} · {r.avgPoints.toFixed(1)} pts/g
                            </Text>
                          </View>
                          <View style={{ backgroundColor: rowMeta.color }} className="w-2.5 h-2.5 rounded-full" />
                          <Feather name="chevron-right" size={14} color="#4b5563" />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              <Pressable
                onPress={() => {
                  onViewProfile(team.userId);
                  onClose();
                }}
                className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-white/10"
              >
                <Ionicons name="person-circle-outline" size={16} color="#e5e7eb" />
                <Text className="text-white text-[13px] font-semibold">View Full Profile</Text>
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TeamSOSCard({
  team,
  rank,
  isGauntlet,
  onPress,
  onSelectWeek,
}: {
  team: TeamSOS;
  rank: number;
  isGauntlet: boolean;
  onPress: () => void;
  onSelectWeek: (opp: WeeklyOpponent) => void;
}) {
  const meta = TIER_META[team.tier];

  return (
    <Pressable onPress={onPress} style={{ borderColor: `${meta.color}44` }} className="bg-[#141416] border rounded-2xl p-4 mb-3">
      <View className="flex-row items-center mb-3">
        <View style={{ borderColor: meta.color }} className="w-8 h-8 rounded-full border-2 items-center justify-center mr-2.5">
          <Text style={{ color: meta.color }} className="font-bold text-[13px]">
            {rank}
          </Text>
        </View>
        <Image source={team.avatar ? { uri: team.avatar } : helmet} className="w-10 h-10 rounded-full bg-white/10 mr-2.5" />
        <View className="flex-1 mr-2">
          <Text numberOfLines={1} className="text-white font-bold text-[14px]">
            {team.name}
          </Text>
          <Text className="text-gray-500 text-[11px]">
            {team.wins}-{team.losses} · {team.avgPoints.toFixed(1)} pts/g
          </Text>
        </View>
        <View className="items-end">
          <View className={`flex-row items-center gap-1 px-2.5 py-1 rounded-full ${meta.bg}`}>
            {isGauntlet && <Ionicons name="flame" size={11} color={meta.color} />}
            <Text style={{ color: meta.color }} className="text-[11px] font-bold">
              {team.tier}
            </Text>
          </View>
          <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white font-extrabold text-[16px] mt-1">
            {team.sosScore}
          </Text>
        </View>
      </View>

      {team.remaining.length > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2.5">
            <View className="flex-row gap-1.5">
              {team.remaining.map((r) => (
                <WeekCell
                  key={r.week}
                  opp={r}
                  week={r.week}
                  onPress={(e) => {
                    e.stopPropagation();
                    onSelectWeek(r);
                  }}
                />
              ))}
            </View>
          </ScrollView>

          <View className="flex-row items-center justify-between">
            {team.toughest && (
              <View className="flex-row items-center gap-1 flex-1 mr-2">
                <Feather name="trending-up" size={10} color="#ef4444" />
                <Text numberOfLines={1} className="text-gray-500 text-[10px] flex-1">
                  Toughest: <Text className="text-gray-300 font-semibold">{team.toughest.opponentName}</Text> (Wk{" "}
                  {team.toughest.week})
                </Text>
              </View>
            )}
            {team.easiest && (
              <View className="flex-row items-center gap-1 flex-1">
                <Feather name="trending-down" size={10} color="#4ade80" />
                <Text numberOfLines={1} className="text-gray-500 text-[10px] flex-1">
                  Best: <Text className="text-gray-300 font-semibold">{team.easiest.opponentName}</Text> (Wk{" "}
                  {team.easiest.week})
                </Text>
              </View>
            )}
          </View>
          <Text className="text-gray-600 text-[9.5px] mt-2 text-center">Tap a week for that matchup · tap the card for full analytics</Text>
        </>
      )}
    </Pressable>
  );
}

export default function StrengthOfSchedule() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<TeamSOS[]>([]);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [selectedTeam, setSelectedTeam] = useState<TeamSOS | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeeklyOpponent | null>(null);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: nflState }, sim] = await Promise.all([sleeper.getNflState(), buildLeagueSimData(leagueID)]);
        if (cancelled) return;
        const week = nflState.season_type === "post" ? 18 : nflState.display_week || 1;
        setCurrentWeek(week);
        setTeams(computeStrengthOfSchedule(sim, week));
        // Reuses the sim just built above - no extra fetch - so visiting
        // this screen gets Boogie's storyline post up immediately instead
        // of waiting for a later Dashboard load to trigger it.
        ensureScheduleStorylinePost(leagueID, sim, week).catch((error) =>
          console.error("Error posting schedule storyline:", error)
        );
      } catch (error) {
        console.error("Error computing strength of schedule:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" />
        <Text className="mt-2 text-gray-400 text-xs">Scouting the rest of the schedule…</Text>
      </View>
    );
  }

  // The single worst 3-week stretch anyone in the league is staring down -
  // real signal (an actual run of tough games), not a flat season average,
  // which can hide a brutal patch behind a couple of easy byes elsewhere.
  const gauntletTeam = teams.reduce<TeamSOS | null>((worst, t) => {
    if (!t.gauntlet) return worst;
    if (!worst?.gauntlet || t.gauntlet.avgStrength > worst.gauntlet.avgStrength) return t;
    return worst;
  }, null);

  const goToProfile = (userId: string) => router.push(`/profile/manager/${userId}`);

  return (
    <>
      <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4 pb-10">
        <Text className="text-[11px] font-bold tracking-widest text-brand mb-1">STRENGTH OF SCHEDULE</Text>
        <Text className="text-white text-[21px] font-bold">Who's Got It Easy?</Text>
        <Text className="text-gray-500 text-[12px] mt-1.5">
          Real fantasy difficulty, not NFL matchups - the average strength of every opponent still left on each
          team's schedule (Week {currentWeek} on), off real weekly projections and this season's actual scoring.
        </Text>

        {gauntletTeam?.gauntlet && (
          <View className="bg-[#1c0a0a] border border-red-500/30 rounded-2xl p-4 mt-4 mb-1">
            <View className="flex-row items-center gap-2 mb-1.5">
              <Ionicons name="flame" size={16} color="#ef4444" />
              <Text className="text-red-400 text-[11px] font-bold tracking-widest">GAUNTLET ALERT</Text>
            </View>
            <Text className="text-white text-[13px] leading-5">
              <Text className="font-bold">{gauntletTeam.name}</Text> runs into the league's toughest stretch - three
              brutal games back to back, Weeks {gauntletTeam.gauntlet.startWeek}-{gauntletTeam.gauntlet.endWeek}.
            </Text>
          </View>
        )}

        <View className="flex-row items-center flex-wrap gap-x-3 gap-y-1.5 mt-5 mb-3">
          {(Object.keys(TIER_META) as SOSTier[]).map((tier) => (
            <View key={tier} className="flex-row items-center gap-1">
              <View style={{ backgroundColor: TIER_META[tier].color }} className="w-2.5 h-2.5 rounded-full" />
              <Text className="text-gray-500 text-[10px] font-semibold">{tier}</Text>
            </View>
          ))}
        </View>

        {teams.map((team, i) => (
          <TeamSOSCard
            key={team.userId}
            team={team}
            rank={i + 1}
            isGauntlet={team.userId === gauntletTeam?.userId}
            onPress={() => setSelectedTeam(team)}
            onSelectWeek={(opp) => setSelectedWeek(opp)}
          />
        ))}
      </ScrollView>

      <TeamAnalyticsModal
        team={selectedTeam}
        onClose={() => setSelectedTeam(null)}
        onViewProfile={goToProfile}
        onSelectWeek={(opp) => setSelectedWeek(opp)}
      />
      <WeekOpponentModal opp={selectedWeek} onClose={() => setSelectedWeek(null)} onViewProfile={goToProfile} />
    </>
  );
}
