import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { sleeper, backend } from "../../../lib/api";
import { getTeamLogo } from "../../../lib/nflTeams";
import PlayerCard from "../../../components/PlayerCard";

const defaultPfp = require("../../../assets/images/rookie_pfp.png");

const POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  WR: "#3b82f6",
  RB: "#22c55e",
  TE: "#eab308",
};

// Matches the deployed web app's card style: a plain dark card with the
// player photo on the left and a normal-sized team logo badge on the right -
// not the full team-color-bleed treatment used in Trade Calculator.
function DraftPickCard({ pick }: { pick: DraftPlayer }) {
  const logo = getTeamLogo(pick.team);
  return (
    <View className="flex-row items-center bg-[#1c1c1e] rounded-2xl p-3 gap-3">
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${pick.player_id}.jpg` }}
        className="w-[64px] h-[64px] rounded-xl bg-[#2c2c2e]"
        resizeMode="cover"
      />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-white font-bold text-[15px]">
          {pick.player}
        </Text>
        <Text className="text-[12px] mt-0.5">
          <Text style={{ color: POSITION_COLOR[pick.position] ?? "#9ca3af" }} className="font-bold">
            {pick.position}
          </Text>
          <Text className="text-gray-300"> - {pick.team}</Text>
        </Text>
        <Text className="text-[11px] text-gray-500 mt-2">
          Round {pick.round}, Pick {pick.pick}
        </Text>
      </View>
      {logo && <Image source={{ uri: logo }} className="w-[40px] h-[40px]" resizeMode="contain" />}
    </View>
  );
}

interface Pick {
  picked_by: string;
  metadata: { first_name: string; last_name: string; team: string; position: string; username?: string };
  round: number;
  pick_no: number;
  player_id: string;
  draft_slot: number;
}

interface DraftPlayer {
  player: string;
  player_id: string;
  team: string;
  position: string;
  round: number;
  pick: number;
  slot: number;
  value: number;
}

interface DraftSlotInfo {
  slot: number;
  name: string;
  avatar: string;
}

const BOARD_CELL_WIDTH = 104;
const BOARD_CELL_HEIGHT = 118;
const BOARD_LABEL_WIDTH = 32;

function DraftBoard({
  slots,
  rounds,
  grid,
  failedImages,
  onImageError,
}: {
  slots: DraftSlotInfo[];
  rounds: number[];
  grid: Record<string, DraftPlayer>;
  failedImages: Set<string>;
  onImageError: (uri: string) => void;
}) {
  return (
    <View className="flex-row mb-8">
      <View style={{ width: BOARD_LABEL_WIDTH }}>
        <View style={{ height: BOARD_CELL_HEIGHT }} />
        {rounds.map((r) => (
          <View
            key={r}
            style={{ height: BOARD_CELL_HEIGHT }}
            className="items-center justify-center border-b border-white/5"
          >
            <Text className="text-gray-500 text-[10px] font-bold">R{r}</Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View className="flex-row">
            {slots.map((s) => (
              <View
                key={s.slot}
                style={{ width: BOARD_CELL_WIDTH, height: BOARD_CELL_HEIGHT }}
                className="items-center justify-center border-b border-white/10 px-1"
              >
                <Image
                  source={failedImages.has(s.avatar) || !s.avatar ? defaultPfp : { uri: s.avatar }}
                  onError={() => onImageError(s.avatar)}
                  className="w-[30px] h-[30px] rounded-full mb-1"
                />
                <Text numberOfLines={1} className="text-white text-[9px] font-bold text-center">
                  {s.name}
                </Text>
              </View>
            ))}
          </View>
          {rounds.map((r) => (
            <View key={r} className="flex-row">
              {slots.map((s) => {
                const pick = grid[`${r}-${s.slot}`];
                return (
                  <View
                    key={s.slot}
                    style={{ width: BOARD_CELL_WIDTH, height: BOARD_CELL_HEIGHT }}
                    className="items-center justify-center border border-white/5 p-1"
                  >
                    {pick ? (
                      <View style={{ width: BOARD_CELL_WIDTH - 8 }}>
                        <PlayerCard
                          variant="tile"
                          playerId={pick.player_id}
                          name={pick.player}
                          position={pick.position}
                          team={pick.team}
                          bottomSlot={<Text className="text-white/70 text-[8px] mt-0.5">Pick {pick.pick}</Text>}
                        />
                      </View>
                    ) : (
                      <Text className="text-gray-700 text-[10px]">-</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

interface DraftUser {
  user_id: string;
  user: string;
  avatar: string;
  picks: DraftPlayer[];
  bestValuePicks: DraftPlayer[];
  draftGrade: string;
  summary: string;
  projectedRecord: string;
  weeklyPoints: number[];
  projectedWins: number;
}

const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e", A: "#22c55e", "A-": "#22c55e",
  "B+": "#3b82f6", B: "#3b82f6", "B-": "#3b82f6",
  "C+": "#eab308", C: "#eab308", "C-": "#eab308",
  D: "#f97316", F: "#ef4444",
};

const ALL_POSITION_COLOR: Record<string, string> = {
  QB: "#ef4444",
  WR: "#3b82f6",
  RB: "#22c55e",
  TE: "#eab308",
  K: "#a855f7",
  DEF: "#94a3b8",
};

function GradeBadge({ grade }: { grade: string }) {
  const color = GRADE_COLOR[grade] ?? "#6b7280";
  return (
    <View
      style={{ borderColor: color }}
      className="w-[52px] h-[52px] rounded-full border-[3px] items-center justify-center bg-[#1c1c1e]"
    >
      <Text style={{ color }} className="text-[20px] font-bold">
        {grade}
      </Text>
    </View>
  );
}

function PositionBreakdown({ picks }: { picks: DraftPlayer[] }) {
  const counts: Record<string, number> = {};
  for (const p of picks) counts[p.position] = (counts[p.position] || 0) + 1;
  const total = picks.length || 1;
  const positions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  return (
    <View className="mb-4">
      <View className="flex-row h-2 rounded-full overflow-hidden bg-white/10 mb-2">
        {positions.map((pos) => (
          <View
            key={pos}
            style={{ width: `${(counts[pos] / total) * 100}%`, backgroundColor: ALL_POSITION_COLOR[pos] ?? "#6b7280" }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {positions.map((pos) => (
          <View key={pos} className="flex-row items-center gap-1">
            <View style={{ backgroundColor: ALL_POSITION_COLOR[pos] ?? "#6b7280" }} className="w-[7px] h-[7px] rounded-full" />
            <Text className="text-[10px] text-gray-400">
              {pos} <Text className="text-gray-300 font-bold">{counts[pos]}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function gradeFromValue(adjustedValue: number): string {
  const ranges: [string, number, number][] = [
    ["F", 100000, 109999], ["D", 110000, 114999], ["C-", 115000, 119999],
    ["C", 120000, 129999], ["C+", 130000, 139999], ["B-", 140000, 144999],
    ["B", 145000, 149999], ["B+", 150000, 154999], ["A-", 155000, 159999],
    ["A", 160000, 164999], ["A+", 165000, Infinity],
  ];
  for (const [grade, min, max] of ranges) if (adjustedValue >= min && adjustedValue <= max) return grade;
  return "F";
}

function calculatePositionalNeeds(picks: DraftPlayer[], rosterPositions: string[]): number {
  const weights: Record<string, number> = { QB: 2, RB: 1.5, WR: 1.5, TE: 1 };
  const counts: Record<string, number> = {};
  for (const pos of rosterPositions) counts[pos] = 0;
  for (const p of picks) if (counts[p.position] !== undefined) counts[p.position]++;

  let needs = 0;
  for (const pos of rosterPositions) {
    const required = rosterPositions.filter((p) => p === pos).length;
    const deficit = required - (counts[pos] || 0);
    if (deficit > 0) needs += deficit * (weights[pos] || 1);
  }
  return needs;
}

// Fetches with at most `limit` requests in flight at once, so a large draft
// (100+ picks) doesn't fire hundreds of simultaneous requests at the API.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default function Draft() {
  const { leagueID } = useLocalSearchParams<{ leagueID: string }>();
  const [draftData, setDraftData] = useState<DraftUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [viewMode, setViewMode] = useState<"manager" | "board">("manager");

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: league } = await sleeper.getLeague(leagueID);
        const totalRosters: number = league.total_rosters;
        const rosterPositions: string[] = league.roster_positions;

        const [playersData, draftsRes, { data: usersRes }, { data: rostersRes }] = await Promise.all([
          backend.fetchPlayers(leagueID),
          fetch(`https://api.sleeper.app/v1/league/${leagueID}/drafts`).then((r) => r.json()),
          sleeper.getLeagueUsers(leagueID),
          sleeper.getLeagueRosters(leagueID),
        ]);
        if (cancelled) return;

        const draftId = draftsRes?.[0]?.draft_id;
        if (!draftId) {
          if (!cancelled) {
            setError("No draft found for this league yet.");
            setLoading(false);
          }
          return;
        }
        const scoringType: string = draftsRes[0]?.metadata?.scoring_type || "";
        const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
        const picks: Pick[] = await picksRes.json();
        if (!Array.isArray(picks) || picks.length === 0) {
          if (!cancelled) {
            setError("This draft doesn't have any picks yet.");
            setLoading(false);
          }
          return;
        }
        const sortedPicks = [...picks].sort((a, b) => a.pick_no - b.pick_no);

        const rosterToUser: Record<number, string> = {};
        for (const roster of rostersRes) {
          const manager = usersRes.find((u: any) => u.user_id === roster.owner_id);
          if (manager) rosterToUser[roster.roster_id] = manager.user_id;
        }
        const managersMap: Record<string, any> = {};
        for (const u of usersRes) managersMap[u.user_id] = u;

        const weeklyMatchups: Record<number, any[]> = {};
        const weekResults = await Promise.all(
          Array.from({ length: 14 }, (_, i) => i + 1).map((w) => sleeper.getMatchups(leagueID, w))
        );
        weekResults.forEach((res, i) => (weeklyMatchups[i + 1] = res.data ?? []));

        const users: Record<string, DraftUser> = {};
        let maxRound = 1;

        // Only picks through round 15 feed the grade calc - no need to fetch
        // a value for every late-round bench pick too.
        const values = await mapWithConcurrency(sortedPicks, 8, (pick) =>
          (pick.round || 1) <= 15
            ? backend
                .fetchPlayerValue(pick.player_id, scoringType)
                .then((r) => r.value ?? 500)
                .catch(() => 500)
            : Promise.resolve(0)
        );
        if (cancelled) return;

        sortedPicks.forEach((pick, i) => {
          const round = pick.round || 1;
          if (round > maxRound) maxRound = round;
          const player: DraftPlayer = {
            player: `${pick.metadata.first_name} ${pick.metadata.last_name}`,
            player_id: pick.player_id,
            team: pick.metadata.team,
            position: pick.metadata.position,
            round,
            pick: pick.pick_no,
            slot: pick.draft_slot,
            value: values[i],
          };
          if (!users[pick.picked_by]) {
            const manager = managersMap[pick.picked_by];
            users[pick.picked_by] = {
              user_id: pick.picked_by,
              user: manager?.display_name || pick.metadata.username || "Unknown",
              avatar: manager?.avatar ? `https://sleepercdn.com/avatars/thumbs/${manager.avatar}` : "",
              picks: [],
              bestValuePicks: [],
              draftGrade: "",
              summary: "",
              projectedRecord: "",
              weeklyPoints: [],
              projectedWins: 0,
            };
          }
          users[pick.picked_by].picks.push(player);
          if (round <= 15) users[pick.picked_by].bestValuePicks.push(player);
        });

        for (let week = 1; week <= 14; week++) {
          for (const matchup of weeklyMatchups[week]) {
            const userId = rosterToUser[matchup.roster_id];
            if (!users[userId]) continue;
            let weeklyPoints = 0;
            for (const playerId of matchup.starters as string[]) {
              weeklyPoints += parseFloat(playersData[playerId]?.wi?.[week]?.p || "0");
            }
            users[userId].weeklyPoints.push(weeklyPoints);
          }
        }

        for (let week = 1; week <= 14; week++) {
          for (const matchup of weeklyMatchups[week]) {
            const userId = rosterToUser[matchup.roster_id];
            if (!users[userId]) continue;
            const opponentMatchup = weeklyMatchups[week].find(
              (m) => m.matchup_id === matchup.matchup_id && m.roster_id !== matchup.roster_id
            );
            const opponentUserId = opponentMatchup ? rosterToUser[opponentMatchup.roster_id] : undefined;
            const opponentPoints = opponentUserId ? users[opponentUserId]?.weeklyPoints[week - 1] ?? 0 : 0;
            if ((users[userId].weeklyPoints[week - 1] ?? 0) > opponentPoints) users[userId].projectedWins++;
          }
        }

        for (const userId in users) {
          const u = users[userId];
          u.projectedRecord = `${u.projectedWins}-${14 - u.projectedWins}`;

          const draftValue = u.bestValuePicks.reduce((sum, p) => sum + (isNaN(p.value) ? 0 : p.value), 0);
          const positionalNeeds = calculatePositionalNeeds(u.bestValuePicks, rosterPositions);
          const synergy = u.bestValuePicks.reduce((sum, p) => {
            const proj = parseFloat(playersData[p.player_id]?.wi?.[0]?.p || "0");
            return sum + proj;
          }, 0);

          let adjusted = draftValue * 2 + synergy - positionalNeeds * 10;
          if (!scoringType.includes("dynasty")) {
            adjusted += u.projectedWins * totalRosters * 6;
            adjusted -= (14 - u.projectedWins) * totalRosters * 6;
          }
          const winRatio = u.projectedWins / 14;
          if (winRatio >= 0.7) adjusted += totalRosters * 20;
          else if (winRatio >= 0.5) adjusted += totalRosters * 10;
          else if (winRatio < 0.4) adjusted -= totalRosters * 35;

          u.draftGrade = gradeFromValue(adjusted);
          u.bestValuePicks = u.bestValuePicks.slice(0, 3);
        }

        if (!cancelled) {
          setDraftData(Object.values(users));
          setLoading(false);
        }

        const summaryTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Summary request timed out")), 12000)
        );
        Promise.race([
          backend.fetchSummaries(leagueID, scoringType, Object.values(users).map((u) => ({ user: u.user, picks: u.picks }))),
          summaryTimeout,
        ])
          .then((summaries: any) => {
            if (cancelled || !Array.isArray(summaries)) return;
            setDraftData((prev) =>
              prev.map((u, i) => {
                // Match by name in the returned title rather than raw index -
                // the model can reorder or drop an entry, which would
                // otherwise silently attribute one manager's summary to
                // another.
                const match =
                  summaries.find(
                    (s: any) => typeof s?.title === "string" && s.title.toLowerCase().includes(u.user.toLowerCase())
                  ) ?? summaries[i];
                return { ...u, summary: match?.description || "No summary available." };
              })
            );
          })
          .catch((e) => {
            // Expected and already handled by the fallback message below -
            // console.error would pop Expo's red LogBox screen for a case
            // that isn't actually broken, so this stays at log level.
            console.log("Summaries didn't respond in time, showing fallback message:", e);
            if (cancelled) return;
            setDraftData((prev) => prev.map((u) => ({ ...u, summary: u.summary || "Couldn't generate a summary right now." })));
          });
      } catch (e) {
        console.error("Error loading draft data:", e);
        if (!cancelled) {
          setError("Couldn't load draft data. Check your connection and try again.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueID, reloadKey]);

  const boardData = useMemo(() => {
    const slots: DraftSlotInfo[] = [];
    const grid: Record<string, DraftPlayer> = {};
    const roundSet = new Set<number>();

    for (const user of draftData) {
      const firstPick = user.picks[0];
      if (firstPick) slots.push({ slot: firstPick.slot, name: user.user, avatar: user.avatar });
      for (const pick of user.picks) {
        grid[`${pick.round}-${pick.slot}`] = pick;
        roundSet.add(pick.round);
      }
    }
    slots.sort((a, b) => a.slot - b.slot);
    const rounds = Array.from(roundSet).sort((a, b) => a - b);
    return { slots, rounds, grid };
  }, [draftData]);

  if (!leagueID) return null;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0c0c0e]">
        <ActivityIndicator color="#af1222" size="large" />
        <Text className="mt-2 text-gray-400">Loading Draft Data…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6 bg-[#0c0c0e]">
        <Text className="text-center text-gray-500 mb-4">{error}</Text>
        <Pressable
          onPress={() => setReloadKey((k) => k + 1)}
          className="border-2 border-brand rounded-lg px-4 py-2.5"
        >
          <Text className="text-brand font-semibold">Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-[#0c0c0e]" contentContainerClassName="p-4">
      <View className="flex-row bg-[#1c1c1e] rounded-full p-1 mb-5 self-center">
        {(["manager", "board"] as const).map((mode) => (
          <Pressable
            key={mode}
            onPress={() => setViewMode(mode)}
            className={`px-5 py-2 rounded-full ${viewMode === mode ? "bg-brand" : ""}`}
          >
            <Text className={`text-[12px] font-bold ${viewMode === mode ? "text-white" : "text-gray-400"}`}>
              {mode === "manager" ? "By Manager" : "Draft Board"}
            </Text>
          </Pressable>
        ))}
      </View>

      {viewMode === "board" ? (
        <DraftBoard
          slots={boardData.slots}
          rounds={boardData.rounds}
          grid={boardData.grid}
          failedImages={failedImages}
          onImageError={(uri) => setFailedImages((s) => new Set(s).add(uri))}
        />
      ) : (
        draftData.map((user) => {
        const rounds = Array.from(new Set(user.picks.map((p) => p.round))).sort((a, b) => a - b);
        return (
          <View key={user.user_id} className="mb-8 bg-[#131315] rounded-2xl p-4">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-3">
                <Image
                  source={failedImages.has(user.avatar) || !user.avatar ? defaultPfp : { uri: user.avatar }}
                  onError={() => setFailedImages((s) => new Set(s).add(user.avatar))}
                  className="w-[48px] h-[48px] rounded-full"
                />
                <View>
                  <Text className="text-white font-bold text-[16px]">{user.user}</Text>
                  <Text className="text-gray-500 text-[11px]">{user.picks.length} picks</Text>
                </View>
              </View>
              <GradeBadge grade={user.draftGrade} />
            </View>

            <PositionBreakdown picks={user.picks} />

            {rounds.map((round) => (
              <View key={round} className="mb-3">
                <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2">ROUND {round}</Text>
                <View className="gap-2">
                  {user.picks
                    .filter((p) => p.round === round)
                    .map((pick, i) => (
                      <DraftPickCard key={i} pick={pick} />
                    ))}
                </View>
              </View>
            ))}

            <View className="flex-row gap-2 mt-2">
              <View className="flex-1 bg-white/5 rounded-lg p-3">
                <Text className="font-bold mb-1 text-white text-[13px]">Summary</Text>
                <Text className="text-[12px] text-gray-300">{user.summary || "Generating…"}</Text>
              </View>
              <View className="items-center justify-center bg-white/5 rounded-lg p-3 w-[110px]">
                <Text className="font-bold text-center text-white text-[12px]">Proj. Record</Text>
                <Text className="text-2xl font-bold mt-1 text-white">{user.projectedRecord}</Text>
              </View>
            </View>
          </View>
        );
        })
      )}
    </ScrollView>
  );
}
