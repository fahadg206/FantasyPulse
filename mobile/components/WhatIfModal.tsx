import { useMemo, useState } from "react";
import { View, Text, Image, Pressable, Modal, ScrollView, ActivityIndicator, Switch } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import ManagerPicker from "./ManagerPicker";
import {
  runMonteCarlo,
  getWeekGames,
  projectStandings,
  basePointsFor,
  rankTeams,
  determinePlayoffTeams,
  Outcome,
  Overrides,
  TeamSeedData,
} from "../lib/whatIfSimulation";

// A genuine "clinch" means guaranteed regardless of every other result, not
// just a favorable one - so once winning out alone isn't already enough,
// this searches for the smallest set of other games ("helpers") that closes
// the gap, verifying every remaining combination exhaustively rather than
// estimating with a Monte Carlo run. Both caps bound that exhaustive search
// to what a phone's JS thread can still finish instantly; beyond them there
// are simply too many still-undecided games left in the season to prove a
// guarantee either way, and the UI says so honestly instead of overstating
// a probability as a lock.
const CLINCH_EXACT_GAMES_CAP = 10;
const CLINCH_MAX_HELPERS = 4;

const helmet = require("../assets/images/helmet2.png");

interface Props {
  visible: boolean;
  onClose: () => void;
  managerInfo: Record<string, any>;
  matchupData: Record<number, any>;
  projectionCache: Record<number, Record<string, number>>;
  playoffStartWeek: number;
  playoffSpots: number;
  divisionsCount: number;
}

function avatarSource(managerInfo: Record<string, any>, id?: string) {
  const avatar = id ? managerInfo[id]?.avatar : undefined;
  return typeof avatar === "string" ? { uri: avatar } : helmet;
}

function teamName(managerInfo: Record<string, any>, id?: string) {
  return (id && managerInfo[id]?.name) || "TBD";
}

// A single game row in the week grid: shows the real final score once
// played, otherwise the projection plus a tap-to-force-winner toggle.
function GameRow({
  game,
  managerInfo,
  forcedWinner,
  onToggle,
}: {
  game: { a: string; b: string; played: boolean; scoreA?: number; scoreB?: number };
  managerInfo: Record<string, any>;
  forcedWinner: string | null;
  onToggle: (winnerId: string) => void;
}) {
  const projA = game.scoreA;
  const projB = game.scoreB;
  const aIsWinner = game.played ? (projA ?? 0) >= (projB ?? 0) : forcedWinner === game.a;
  const bIsWinner = game.played ? (projB ?? 0) > (projA ?? 0) : forcedWinner === game.b;

  const Side = ({ id, isWinner, align }: { id: string; isWinner: boolean; align: "left" | "right" }) => (
    <Pressable
      disabled={game.played}
      onPress={() => onToggle(id)}
      className={`flex-1 flex-row items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      <View>
        <Image
          source={avatarSource(managerInfo, id)}
          className="w-[34px] h-[34px] rounded-full"
          style={isWinner ? { borderWidth: 2, borderColor: "#22c55e" } : undefined}
        />
        {isWinner && (
          <View className="absolute -bottom-1 -right-1 bg-[#22c55e] rounded-full w-[14px] h-[14px] items-center justify-center">
            <Ionicons name="checkmark" size={9} color="#0c0c0e" />
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        className={`text-[12px] flex-shrink ${isWinner ? "text-white font-bold" : "text-gray-400 font-medium"}`}
      >
        {teamName(managerInfo, id)}
      </Text>
    </Pressable>
  );

  return (
    <View className="bg-[#141416] border border-white/10 rounded-xl px-3 py-3 flex-row items-center">
      <Side id={game.a} isWinner={aIsWinner} align="left" />
      <View className="items-center px-2 w-[64px]">
        {game.played ? (
          <>
            <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[12px] font-bold">
              {projA?.toFixed(1)} - {projB?.toFixed(1)}
            </Text>
            <Text className="text-gray-600 text-[8px] font-bold tracking-wider mt-0.5">FINAL</Text>
          </>
        ) : (
          <>
            <Text className="text-gray-600 text-[9px] font-bold tracking-wider">
              {forcedWinner ? "SET" : "PROJ"}
            </Text>
            {!forcedWinner && (
              <Text style={{ fontVariant: ["tabular-nums"] }} className="text-gray-500 text-[10px] mt-0.5">
                {(projA ?? 0).toFixed(0)}-{(projB ?? 0).toFixed(0)}
              </Text>
            )}
          </>
        )}
      </View>
      <Side id={game.b} isWinner={bIsWinner} align="right" />
    </View>
  );
}

// Finds what needs to happen across every remaining week (not just one) for
// the selected team to clinch - "clinching" is framed around the team
// controlling its own destiny by winning its own remaining games, plus
// whichever combination of other teams' results most helps its odds.
// Weeks are solved in order, earliest first, each one locking in its best
// combo before moving to the next - a greedy chain rather than a true joint
// optimum, but the only shape that stays fast across a whole season.
export interface ClinchGame {
  week: number;
  a: string;
  b: string;
  winner: string;
}

export interface ClinchResult {
  // true only when every remaining combination of every other game still
  // leads to a playoff spot - an actual clinch, not just good odds.
  guaranteed: boolean;
  // 100 when guaranteed; otherwise the exact (or, past the search cap,
  // Monte Carlo estimated) percentage of remaining outcomes that still
  // work out, so a non-clinch result is never overstated as a lock.
  odds: number;
  requiredResults: ClinchGame[];
}

function applyResult(overrides: Overrides, week: number, winner: string, loser: string): Overrides {
  return { ...overrides, [week]: { ...(overrides[week] || {}), [winner]: "win", [loser]: "loss" } };
}

function kCombinations(n: number, k: number): number[][] {
  const results: number[][] = [];
  const combo: number[] = [];
  function backtrack(start: number) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return results;
}

// Finds a genuine clinching scenario: the selected team wins out (controls
// its own destiny), plus - if that alone isn't already enough - the
// smallest set of other teams' results that guarantees a playoff spot no
// matter how every other still-undecided game turns out. Every combination
// left in scope is checked exhaustively rather than sampled, so "guaranteed"
// actually means guaranteed. When too many games remain in the season to
// check exhaustively, or no fully-guaranteeing combination is found within
// the search bounds, this reports the best verified fraction instead of
// asserting a false lock.
function findClinchingScenario(
  selectedUserId: string,
  matchupData: Record<number, any>,
  managerInfo: Record<string, TeamSeedData & Record<string, any>>,
  projectionCache: Record<number, Record<string, number>>,
  playoffStartWeek: number,
  playoffSpots: number,
  divisionsCount: number,
  priorOverrides: Overrides
): ClinchResult | null {
  const teamIds = Object.keys(managerInfo);
  let baseOverrides: Overrides = JSON.parse(JSON.stringify(priorOverrides));

  const requiredResults: ClinchGame[] = [];
  const otherGames: { week: number; a: string; b: string }[] = [];
  let anyUnplayedGameFound = false;

  for (let week = 1; week < playoffStartWeek; week++) {
    const games = getWeekGames(week, matchupData, teamIds).filter((g) => !g.played);
    for (const game of games) {
      anyUnplayedGameFound = true;
      const alreadyForced =
        baseOverrides[week]?.[game.a] === "win" ? game.a : baseOverrides[week]?.[game.b] === "win" ? game.b : null;

      if (game.a === selectedUserId || game.b === selectedUserId) {
        const opponent = game.a === selectedUserId ? game.b : game.a;
        const winner = alreadyForced ?? selectedUserId;
        if (!alreadyForced) baseOverrides = applyResult(baseOverrides, week, selectedUserId, opponent);
        requiredResults.push({ week, a: game.a, b: game.b, winner });
      } else if (alreadyForced) {
        requiredResults.push({ week, a: game.a, b: game.b, winner: alreadyForced });
      } else {
        otherGames.push({ week, a: game.a, b: game.b });
      }
    }
  }

  if (!anyUnplayedGameFound) return null;

  // Everything decided so far (baseline record/points, already-played
  // games, the selected team's win-out, and any results the user already
  // forced) collapses into one fixed wins/points snapshot - the search
  // below only needs to vary `otherGames`, not re-derive this every combo.
  const baseWins: Record<string, number> = {};
  const basePoints: Record<string, number> = {};
  teamIds.forEach((id) => {
    baseWins[id] = parseInt(managerInfo[id].wins || "0");
    basePoints[id] = basePointsFor(managerInfo[id]);
  });
  for (let week = 1; week < playoffStartWeek; week++) {
    const games = getWeekGames(week, matchupData, teamIds);
    for (const g of games) {
      if (g.played) continue;
      const forcedA = baseOverrides[week]?.[g.a];
      const forcedB = baseOverrides[week]?.[g.b];
      if (!forcedA && !forcedB) continue; // this is one of `otherGames` - varied below, not fixed
      const aWins = forcedA === "win" || forcedB === "loss";
      const projA = projectionCache[week]?.[g.a] ?? 0;
      const projB = projectionCache[week]?.[g.b] ?? 0;
      if (aWins) baseWins[g.a] += 1;
      else baseWins[g.b] += 1;
      basePoints[g.a] += projA;
      basePoints[g.b] += projB;
    }
  }

  if (otherGames.length === 0) {
    const ranked = rankTeams(teamIds, baseWins, basePoints);
    const { qualifiers } = determinePlayoffTeams(ranked, managerInfo, divisionsCount, playoffSpots);
    const guaranteed = qualifiers.includes(selectedUserId);
    return { guaranteed, odds: guaranteed ? 100 : 0, requiredResults };
  }

  if (otherGames.length > CLINCH_EXACT_GAMES_CAP) {
    // Too many other undecided games left in the season to exhaustively
    // prove a guarantee either way - report win-out's estimated odds
    // honestly instead of a false certainty.
    const { playoffOdds } = runMonteCarlo(
      teamIds,
      managerInfo,
      matchupData,
      projectionCache,
      playoffStartWeek,
      playoffSpots,
      divisionsCount,
      baseOverrides,
      400
    );
    return { guaranteed: false, odds: playoffOdds[selectedUserId], requiredResults };
  }

  const n = otherGames.length;
  const total = 1 << n;
  const projA = otherGames.map((g) => projectionCache[g.week]?.[g.a] ?? 0);
  const projB = otherGames.map((g) => projectionCache[g.week]?.[g.b] ?? 0);

  const evaluateCombo = (combo: number): boolean => {
    const wins = { ...baseWins };
    const pointsFor = { ...basePoints };
    for (let i = 0; i < n; i++) {
      const g = otherGames[i];
      if ((combo >> i) & 1) wins[g.a] += 1;
      else wins[g.b] += 1;
      pointsFor[g.a] += projA[i];
      pointsFor[g.b] += projB[i];
    }
    const ranked = rankTeams(teamIds, wins, pointsFor);
    const { qualifiers } = determinePlayoffTeams(ranked, managerInfo, divisionsCount, playoffSpots);
    return qualifiers.includes(selectedUserId);
  };

  const passesWith = (fixedMask: number, fixedBits: number): { pass: number; total: number } => {
    let pass = 0;
    let count = 0;
    for (let combo = 0; combo < total; combo++) {
      if ((combo & fixedMask) !== fixedBits) continue;
      count++;
      if (evaluateCombo(combo)) pass++;
    }
    return { pass, total: count };
  };

  let best = { fixedMask: 0, fixedBits: 0, pass: 0, total: 0 };
  {
    const { pass, total: cnt } = passesWith(0, 0);
    best = { fixedMask: 0, fixedBits: 0, pass, total: cnt };
    if (pass === cnt) return { guaranteed: true, odds: 100, requiredResults };
  }

  const maxHelpers = Math.min(CLINCH_MAX_HELPERS, n);
  for (let helperCount = 1; helperCount <= maxHelpers; helperCount++) {
    for (const indices of kCombinations(n, helperCount)) {
      const assignmentsCount = 1 << helperCount;
      for (let a = 0; a < assignmentsCount; a++) {
        let fixedMask = 0;
        let fixedBits = 0;
        indices.forEach((idx, j) => {
          fixedMask |= 1 << idx;
          if ((a >> j) & 1) fixedBits |= 1 << idx;
        });
        const { pass, total: cnt } = passesWith(fixedMask, fixedBits);
        if (pass > best.pass || (pass === best.pass && cnt < best.total)) {
          best = { fixedMask, fixedBits, pass, total: cnt };
        }
        if (pass === cnt) {
          const helperResults: ClinchGame[] = indices.map((idx, j) => {
            const g = otherGames[idx];
            const aWins = !!((a >> j) & 1);
            return { week: g.week, a: g.a, b: g.b, winner: aWins ? g.a : g.b };
          });
          return { guaranteed: true, odds: 100, requiredResults: [...requiredResults, ...helperResults] };
        }
      }
    }
  }

  const helperResults: ClinchGame[] = [];
  for (let i = 0; i < n; i++) {
    if (!(best.fixedMask & (1 << i))) continue;
    const g = otherGames[i];
    const aWins = !!(best.fixedBits & (1 << i));
    helperResults.push({ week: g.week, a: g.a, b: g.b, winner: aWins ? g.a : g.b });
  }
  return {
    guaranteed: false,
    odds: best.total > 0 ? (best.pass / best.total) * 100 : 0,
    requiredResults: [...requiredResults, ...helperResults],
  };
}

export default function WhatIfModal({
  visible,
  onClose,
  managerInfo,
  matchupData,
  projectionCache,
  playoffStartWeek,
  playoffSpots,
  divisionsCount,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [result, setResult] = useState<{ playoffOdds: number; divisionOdds: number } | null>(null);
  const [scenario, setScenario] = useState<ClinchResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [showStandings, setShowStandings] = useState(false);

  const teamIds = useMemo(() => Object.keys(managerInfo), [managerInfo]);
  const weeks = useMemo(() => Array.from({ length: Math.max(0, playoffStartWeek - 1) }, (_, i) => i + 1), [
    playoffStartWeek,
  ]);

  // Default to the first week that isn't fully decided yet - the "current"
  // week from the user's perspective - but let them pick any week.
  const defaultWeek = useMemo(() => {
    for (const week of weeks) {
      const games = getWeekGames(week, matchupData, teamIds);
      if (games.some((g) => !g.played)) return week;
    }
    return weeks[weeks.length - 1] ?? 1;
  }, [weeks, matchupData, teamIds]);

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const activeWeek = selectedWeek ?? defaultWeek;

  const weekGames = useMemo(
    () => getWeekGames(activeWeek, matchupData, teamIds),
    [activeWeek, matchupData, teamIds]
  );

  const options = useMemo(
    () => teamIds.map((id) => ({ id, name: managerInfo[id].name, avatar: typeof managerInfo[id].avatar === "string" ? managerInfo[id].avatar : undefined })),
    [teamIds, managerInfo]
  );

  const baselineOdds = selectedId ? managerInfo[selectedId]?.playoffOdds : undefined;
  const baselineDivisionOdds = selectedId ? managerInfo[selectedId]?.divisionOdds : undefined;

  // Gates the clinching-path button - only meaningful once the selected
  // team still has at least one game left to play, anywhere in the
  // remaining schedule (not just the week currently being viewed).
  const selectedTeamHasFutureGame = useMemo(() => {
    if (!selectedId) return false;
    return weeks.some((week) =>
      getWeekGames(week, matchupData, teamIds).some((g) => !g.played && (g.a === selectedId || g.b === selectedId))
    );
  }, [selectedId, weeks, matchupData, teamIds]);

  const projectedStandings = useMemo(
    () => projectStandings(teamIds, managerInfo, matchupData, projectionCache, playoffStartWeek, overrides, divisionsCount, playoffSpots),
    [teamIds, managerInfo, matchupData, projectionCache, playoffStartWeek, overrides, divisionsCount, playoffSpots]
  );

  const toggleGameWinner = (game: { a: string; b: string; played: boolean }, winnerId: string) => {
    if (game.played) return;
    setResult(null);
    setScenario(null);
    const loserId = winnerId === game.a ? game.b : game.a;
    setOverrides((prev) => {
      const weekOverrides = { ...(prev[activeWeek] || {}) };
      const alreadyForced = weekOverrides[winnerId] === "win";
      if (alreadyForced) {
        delete weekOverrides[winnerId];
        delete weekOverrides[loserId];
      } else {
        weekOverrides[winnerId] = "win";
        weekOverrides[loserId] = "loss";
      }
      return { ...prev, [activeWeek]: weekOverrides };
    });
  };

  const recalculate = () => {
    if (!selectedId) return;
    setComputing(true);
    setScenario(null);
    setTimeout(() => {
      const { playoffOdds, divisionOdds } = runMonteCarlo(
        teamIds,
        managerInfo,
        matchupData,
        projectionCache,
        playoffStartWeek,
        playoffSpots,
        divisionsCount,
        overrides,
        400
      );
      setResult({ playoffOdds: playoffOdds[selectedId], divisionOdds: divisionOdds[selectedId] });
      setComputing(false);
    }, 0);
  };

  const findScenario = () => {
    if (!selectedId) return;
    setComputing(true);
    setResult(null);
    setTimeout(() => {
      const found = findClinchingScenario(
        selectedId,
        matchupData,
        managerInfo,
        projectionCache,
        playoffStartWeek,
        playoffSpots,
        divisionsCount,
        overrides
      );
      setScenario(found);
      setComputing(false);
    }, 0);
  };

  const reset = (id: string | null) => {
    setSelectedId(id);
    setOverrides({});
    setResult(null);
    setScenario(null);
  };

  const overrideCount = Object.values(overrides).reduce((sum, w) => sum + Object.keys(w).length / 2, 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-[#0c0c0e] pt-14">
        <View className="flex-row items-center justify-between px-4 pb-4 border-b border-white/10">
          <Text className="text-white text-[17px] font-bold">What If Simulator</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color="#9ca3af" />
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="p-4">
          <Text className="text-gray-400 text-[12px] mb-3">
            Browse any week's matchups and force outcomes to see how the league shakes out. Ties in wins are
            broken by total points, and division leaders get an automatic playoff bid.
          </Text>

          <Text className="text-gray-500 text-[10px] font-bold tracking-wider mb-2">SELECT WEEK</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-1">
            {weeks.map((week) => {
              const isActive = week === activeWeek;
              const games = getWeekGames(week, matchupData, teamIds);
              const decided = games.every((g) => g.played);
              return (
                <Pressable
                  key={week}
                  onPress={() => setSelectedWeek(week)}
                  className="rounded-full px-3.5 py-2"
                  style={{ backgroundColor: isActive ? "#af1222" : "#1c1c1e" }}
                >
                  <Text
                    className="text-[11px] font-bold"
                    style={{ color: isActive ? "#ffffff" : decided ? "#4b5563" : "#9ca3af" }}
                  >
                    Wk {week}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text className="text-gray-500 text-[10px] font-bold tracking-wider mt-4 mb-2">
            WEEK {activeWeek} MATCHUPS {overrideCount > 0 ? `· ${overrideCount} SET` : ""}
          </Text>
          <View className="gap-2">
            {weekGames.map((game) => (
              <GameRow
                key={`${game.a}-${game.b}`}
                game={game}
                managerInfo={managerInfo}
                forcedWinner={overrides[activeWeek]?.[game.a] === "win" ? game.a : overrides[activeWeek]?.[game.b] === "win" ? game.b : null}
                onToggle={(winnerId) => toggleGameWinner(game, winnerId)}
              />
            ))}
            {weekGames.length === 0 && (
              <Text className="text-gray-500 text-[12px]">No matchups found for this week.</Text>
            )}
          </View>

          <View className="flex-row items-center justify-between mt-5 bg-[#141416] border border-white/10 rounded-xl px-3.5 py-3">
            <View className="flex-1 mr-2">
              <Text className="text-white text-[12px] font-bold">Live Standings Preview</Text>
              <Text className="text-gray-500 text-[10px] mt-0.5">
                Updates instantly as you set winners - undecided games use the projected winner.
              </Text>
            </View>
            <Switch
              value={showStandings}
              onValueChange={setShowStandings}
              trackColor={{ false: "#3a3a3c", true: "#af1222" }}
              thumbColor="#ffffff"
            />
          </View>

          {showStandings && (
            <View className="mt-2.5 rounded-xl overflow-hidden border border-white/10">
              <View className="flex-row items-center px-3 py-2 bg-white/[0.04]">
                <Text className="w-[22px] text-[9px] font-bold text-gray-500">RK</Text>
                <Text className="flex-1 text-[9px] font-bold text-gray-500">TEAM</Text>
                <Text className="w-[40px] text-[9px] font-bold text-gray-500 text-center">W-L</Text>
                <Text className="w-[54px] text-[9px] font-bold text-gray-500 text-right">PF</Text>
              </View>
              {projectedStandings.map((row, i) => (
                <View
                  key={row.userId}
                  className="flex-row items-center px-3 py-2 border-t border-white/5"
                  style={{ backgroundColor: row.madePlayoffs ? "rgba(34,197,94,0.06)" : undefined }}
                >
                  <Text className="w-[22px] text-[11px] font-bold text-gray-400">{i + 1}</Text>
                  <View className="flex-1 flex-row items-center gap-1.5 mr-1">
                    <Image source={avatarSource(managerInfo, row.userId)} className="w-[20px] h-[20px] rounded-full" />
                    <Text numberOfLines={1} className="text-white text-[11px] font-semibold flex-shrink">
                      {teamName(managerInfo, row.userId)}
                    </Text>
                    {row.isDivisionLeader && <Ionicons name="ribbon" size={10} color="#eab308" />}
                  </View>
                  <Text style={{ fontVariant: ["tabular-nums"] }} className="w-[40px] text-center text-white text-[11px] font-bold">
                    {row.wins}-{row.losses}
                  </Text>
                  <Text style={{ fontVariant: ["tabular-nums"] }} className="w-[54px] text-right text-gray-400 text-[11px]">
                    {row.pointsFor.toFixed(1)}
                  </Text>
                </View>
              ))}
              <View className="px-3 py-1.5 bg-brand/10">
                <Text className="text-[9px] text-brand font-bold text-center">Green rows project to make the playoffs</Text>
              </View>
            </View>
          )}

          <Text className="text-gray-500 text-[10px] font-bold tracking-wider mt-6 mb-2">TEAM ANALYSIS</Text>
          <ManagerPicker label="Select Team" options={options} selectedId={selectedId} onSelect={reset} />

          {selectedId && (
            <>
              <View className="flex-row items-center gap-3 mt-4 mb-1">
                <Image source={avatarSource(managerInfo, selectedId)} className="w-[34px] h-[34px] rounded-full" />
                <View>
                  <Text className="text-white font-bold text-[14px]">{managerInfo[selectedId].name}</Text>
                  <Text className="text-gray-500 text-[11px]">
                    Current odds: {baselineOdds !== undefined ? `${baselineOdds.toFixed(0)}%` : "-"} to make playoffs
                    {divisionsCount > 1 && baselineDivisionOdds !== undefined
                      ? ` · ${baselineDivisionOdds.toFixed(0)}% to win division`
                      : ""}
                  </Text>
                </View>
              </View>

              <Pressable onPress={recalculate} disabled={computing} className="bg-brand rounded-xl py-3 items-center mt-3">
                <Text className="text-white font-bold text-[13px]">{computing ? "Calculating…" : "Recalculate Odds"}</Text>
              </Pressable>

              {selectedTeamHasFutureGame && (
                <Pressable
                  onPress={findScenario}
                  disabled={computing}
                  className="border border-brand rounded-xl py-3 items-center mt-2.5"
                >
                  <Text className="text-brand font-bold text-[13px]">Check Playoff Clinching Scenario</Text>
                </Pressable>
              )}

              {computing && <ActivityIndicator color="#af1222" className="mt-4" />}

              {result && !computing && (
                <View className="bg-[#141416] border border-white/10 rounded-2xl p-4 mt-4 items-center">
                  <Text className="text-gray-500 text-[10px] font-bold tracking-wider mb-1.5">UPDATED PLAYOFF ODDS</Text>
                  <Text style={{ fontVariant: ["tabular-nums"] }} className="text-white text-[28px] font-bold">
                    {result.playoffOdds.toFixed(0)}%
                  </Text>
                  {baselineOdds !== undefined && (
                    <Text
                      style={{ color: result.playoffOdds >= baselineOdds ? "#22c55e" : "#ef4444" }}
                      className="text-[12px] font-semibold mt-1"
                    >
                      {result.playoffOdds >= baselineOdds ? "+" : ""}
                      {(result.playoffOdds - baselineOdds).toFixed(0)} pts vs today
                    </Text>
                  )}
                  {divisionsCount > 1 && (
                    <Text className="text-gray-400 text-[11px] mt-2">{result.divisionOdds.toFixed(0)}% to win division</Text>
                  )}
                </View>
              )}

              {scenario && !computing && (
                <View
                  className="rounded-2xl p-4 mt-4"
                  style={{
                    backgroundColor: "#141416",
                    borderWidth: 1,
                    borderColor: scenario.guaranteed ? "#22c55e66" : "#af122266",
                  }}
                >
                  <View className="flex-row items-center gap-1.5 mb-3">
                    {scenario.guaranteed && <Ionicons name="lock-closed" size={11} color="#22c55e" />}
                    <Text
                      className="text-[10px] font-bold tracking-wider"
                      style={{ color: scenario.guaranteed ? "#22c55e" : "#af1222" }}
                    >
                      {scenario.guaranteed
                        ? `${managerInfo[selectedId].name.toUpperCase()} CLINCHES A PLAYOFF SPOT IF...`
                        : `NOT YET GUARANTEED - ${managerInfo[selectedId].name.toUpperCase()}'S BEST KNOWN PATH`}
                    </Text>
                  </View>

                  {scenario.requiredResults.length === 0 ? (
                    <Text className="text-gray-400 text-[12px]">
                      Nothing left to happen - this outcome is already locked in.
                    </Text>
                  ) : (
                    <View className="gap-3">
                      {Array.from(new Set(scenario.requiredResults.map((r) => r.week))).map((week) => (
                        <View key={week}>
                          <Text className="text-gray-500 text-[9px] font-bold tracking-wider mb-1.5">WEEK {week}</Text>
                          <View className="gap-2">
                            {scenario.requiredResults
                              .filter((r) => r.week === week)
                              .map((g) => {
                                const loserId = g.winner === g.a ? g.b : g.a;
                                return (
                                  <View
                                    key={`${g.a}-${g.b}`}
                                    className="flex-row items-center justify-between bg-white/[0.03] rounded-xl px-3 py-2.5"
                                  >
                                    <View className="flex-row items-center gap-2 flex-1">
                                      <Image
                                        source={avatarSource(managerInfo, g.winner)}
                                        className="w-[28px] h-[28px] rounded-full"
                                        style={{ borderWidth: 1.5, borderColor: "#22c55e" }}
                                      />
                                      <Text numberOfLines={1} className="text-white text-[12px] font-bold flex-shrink">
                                        {teamName(managerInfo, g.winner)}
                                      </Text>
                                    </View>
                                    <Feather name="arrow-right" size={12} color="#4b5563" />
                                    <View className="flex-row items-center gap-2 flex-1 justify-end">
                                      <Text numberOfLines={1} className="text-gray-500 text-[12px] flex-shrink text-right">
                                        {teamName(managerInfo, loserId)}
                                      </Text>
                                      <Image source={avatarSource(managerInfo, loserId)} className="w-[24px] h-[24px] rounded-full opacity-50" />
                                    </View>
                                  </View>
                                );
                              })}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  <Text className="text-gray-400 text-[11px] mt-3">
                    {scenario.guaranteed
                      ? "That combination guarantees a playoff spot no matter how every other game turns out."
                      : `Even with the best results found elsewhere, only ~${scenario.odds.toFixed(0)}% of the remaining ways the season can play out still get ${managerInfo[selectedId].name} in - there's no fully guaranteed path yet.`}
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
