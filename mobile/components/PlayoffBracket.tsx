import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { getPlayoffBracket, Bracket, BracketMatch, BracketTeam } from "../lib/getPlayoffBracket";

const helmet = require("../assets/images/helmet2.png");

// A real single-elimination bracket layout, not just a row of columns:
// each match's vertical position is computed as the midpoint of the two
// earlier matches that feed into it (recursively, back to round 1), the
// same way an actual bracket graphic is built - so round 2 visually
// straddles the two round-1 games it came from, all the way up to the
// championship, connected by real elbow lines instead of just implying it
// with spacing. Byes (a team entering directly into a later round, no
// round-1 feeder) get their own same-size slot so the averaging still
// lines up visually.
const MATCH_WIDTH = 176;
const MATCH_HEIGHT = 60;
const LEAF_GAP = 14;
const ROUND_GAP = 46;
const LEAF_UNIT = MATCH_HEIGHT + LEAF_GAP;

const PLACEMENT_LABEL = (p: number): string => {
  if (p === 1) return "CHAMPIONSHIP";
  const suffix = p % 10 === 3 && p !== 13 ? "rd" : p % 10 === 5 ? "th" : "th";
  return `${p}${suffix} PLACE`.toUpperCase();
};

function TeamSlot({ team, isWinner }: { team: BracketTeam | null; isWinner: boolean }) {
  if (!team) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2 opacity-40" style={{ height: MATCH_HEIGHT / 2 }}>
        <View className="w-[22px] h-[22px] rounded-full bg-white/10" />
        <Text className="text-gray-500 text-[11px]">TBD</Text>
      </View>
    );
  }
  if (team.placeholderLabel) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2" style={{ height: MATCH_HEIGHT / 2 }}>
        <View className="w-[22px] h-[22px] rounded-full bg-white/5 border border-dashed border-white/20" />
        <Text numberOfLines={1} className="text-gray-500 text-[10px] italic flex-1">
          {team.name}
        </Text>
      </View>
    );
  }
  return (
    <View
      className={`flex-row items-center gap-2 px-3 py-2 ${isWinner ? "bg-brand/15" : ""}`}
      style={{ height: MATCH_HEIGHT / 2 }}
    >
      <Image
        source={team.avatar ? { uri: team.avatar } : helmet}
        className={`w-[22px] h-[22px] rounded-full ${isWinner ? "border-2 border-brand" : "border border-white/10 opacity-60"}`}
      />
      <Text
        numberOfLines={1}
        className={`flex-1 text-[11.5px] ${isWinner ? "text-white font-bold" : "text-gray-500 font-medium"}`}
      >
        {team.name}
      </Text>
      {team.points !== undefined && (
        <Text
          style={{ fontVariant: ["tabular-nums"] }}
          className={`text-[12px] ${isWinner ? "text-brand font-bold" : "text-gray-600 font-semibold"}`}
        >
          {team.points.toFixed(1)}
        </Text>
      )}
    </View>
  );
}

function MatchCard({ match, isChampionship, x, y }: { match: BracketMatch; isChampionship: boolean; x: number; y: number }) {
  const [teamA, teamB] = match.teams;
  return (
    <View
      style={{ position: "absolute", left: x, top: y, width: MATCH_WIDTH, height: MATCH_HEIGHT }}
      className={`bg-[#141416] rounded-xl overflow-hidden ${isChampionship ? "border-2 border-brand" : "border border-white/10"}`}
    >
      {isChampionship && (
        <View className="absolute -top-2 self-center bg-brand rounded-full px-1.5 py-0.5 z-10">
          <Ionicons name="trophy" size={9} color="#fff" />
        </View>
      )}
      <TeamSlot team={teamA} isWinner={!!match.winnerRosterId && teamA?.rosterId === match.winnerRosterId} />
      <View className="h-px bg-white/10" />
      <TeamSlot team={teamB} isWinner={!!match.winnerRosterId && teamB?.rosterId === match.winnerRosterId} />
    </View>
  );
}

interface Positioned {
  match: BracketMatch;
  x: number;
  y: number;
  columnIndex: number;
}

/** recursively assigns each match a vertical "slot" position (in LEAF_UNIT multiples) - a true leaf (no feeders) claims the next fresh slot; a match with one or two real feeders sits at the midpoint of them, with a missing feeder side (a bye) claiming its own fresh slot so the midpoint still lands somewhere sensible. */
function layoutMainBracket(mainMatches: BracketMatch[]): { positions: Map<number, Positioned>; totalSlots: number; columnCount: number } {
  const matchById = new Map(mainMatches.map((m) => [m.matchId, m]));
  const roundNumbers = Array.from(new Set(mainMatches.map((m) => m.round))).sort((a, b) => a - b);
  const columnIndexByRound = new Map(roundNumbers.map((r, i) => [r, i]));

  const referenced = new Set<number>();
  for (const m of mainMatches) for (const f of m.fromMatchIds) if (f !== undefined) referenced.add(f);
  const roots = mainMatches.filter((m) => !referenced.has(m.matchId));

  const positions = new Map<number, Positioned>();
  let nextSlot = 0;

  function assignY(match: BracketMatch): number {
    const [f1, f2] = match.fromMatchIds;
    const child1 = f1 !== undefined ? matchById.get(f1) : undefined;
    const child2 = f2 !== undefined ? matchById.get(f2) : undefined;

    let y: number;
    if (child1 && child2) {
      y = (assignY(child1) + assignY(child2)) / 2;
    } else if (child1) {
      const y1 = assignY(child1);
      const yBye = nextSlot * LEAF_UNIT;
      nextSlot += 1;
      y = (y1 + yBye) / 2;
    } else if (child2) {
      const y2 = assignY(child2);
      const yBye = nextSlot * LEAF_UNIT;
      nextSlot += 1;
      y = (y2 + yBye) / 2;
    } else {
      y = nextSlot * LEAF_UNIT;
      nextSlot += 1;
    }

    const columnIndex = columnIndexByRound.get(match.round) ?? 0;
    positions.set(match.matchId, { match, x: columnIndex * (MATCH_WIDTH + ROUND_GAP), y, columnIndex });
    return y;
  }

  // Sorted so ties in the visual left-to-right seed order stay stable -
  // roots normally means just the championship match, but a malformed or
  // partial bracket could surface more than one.
  for (const root of [...roots].sort((a, b) => a.matchId - b.matchId)) assignY(root);

  return { positions, totalSlots: nextSlot, columnCount: roundNumbers.length };
}

function Connector({ from, to }: { from: Positioned; to: Positioned }) {
  const startX = from.x + MATCH_WIDTH;
  const startY = from.y + MATCH_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + MATCH_HEIGHT / 2;
  const midX = startX + ROUND_GAP / 2;
  const d = `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
  return <Path d={d} stroke="#ffffff28" strokeWidth={2} fill="none" />;
}

function RoundLabels({ roundNumbers, totalRounds }: { roundNumbers: number[]; totalRounds: number }) {
  return (
    <View className="flex-row mb-3">
      {roundNumbers.map((r, i) => (
        <View key={r} style={{ width: MATCH_WIDTH, marginRight: i === roundNumbers.length - 1 ? 0 : ROUND_GAP }}>
          <Text className="text-[10px] font-bold tracking-widest text-brand text-center">
            {r === totalRounds ? "CHAMPIONSHIP" : r === totalRounds - 1 ? "SEMIFINALS" : `ROUND ${r}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MainBracketTree({ mainMatches, championRosterId }: { mainMatches: BracketMatch[]; championRosterId?: number }) {
  const { positions, totalSlots, columnCount } = useMemo(() => layoutMainBracket(mainMatches), [mainMatches]);
  const roundNumbers = useMemo(() => Array.from(new Set(mainMatches.map((m) => m.round))).sort((a, b) => a - b), [mainMatches]);
  const totalRounds = roundNumbers[roundNumbers.length - 1] ?? 1;

  const width = columnCount * MATCH_WIDTH + Math.max(0, columnCount - 1) * ROUND_GAP;
  const height = Math.max(1, totalSlots) * LEAF_UNIT - LEAF_GAP;

  const all = Array.from(positions.values());

  return (
    <View>
      <RoundLabels roundNumbers={roundNumbers} totalRounds={totalRounds} />
      <View style={{ width, height }}>
        <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
          {all.map(({ match }) =>
            match.fromMatchIds
              .filter((f): f is number => f !== undefined)
              .map((feederId) => {
                const from = positions.get(feederId);
                const to = positions.get(match.matchId);
                if (!from || !to) return null;
                return <Connector key={`${feederId}-${match.matchId}`} from={from} to={to} />;
              })
          )}
        </Svg>
        {all.map(({ match, x, y }) => (
          <MatchCard key={match.matchId} match={match} isChampionship={match.placement === 1} x={x} y={y} />
        ))}
      </View>
    </View>
  );
}

/** placement games (3rd, 5th, ...) are usually just one game each - shown as their own small labeled row rather than woven into the main tree's connector lines. */
function PlacementRow({ placement, matches }: { placement: number; matches: BracketMatch[] }) {
  return (
    <View className="mt-5">
      <Text className="text-[10px] font-bold tracking-widest text-gray-500 mb-2">{PLACEMENT_LABEL(placement)}</Text>
      <View className="flex-row gap-3">
        {matches.map((m) => {
          const [teamA, teamB] = m.teams;
          return (
            <View key={m.matchId} className="bg-[#141416] border border-white/10 rounded-xl overflow-hidden" style={{ width: MATCH_WIDTH }}>
              <TeamSlot team={teamA} isWinner={!!m.winnerRosterId && teamA?.rosterId === m.winnerRosterId} />
              <View className="h-px bg-white/10" />
              <TeamSlot team={teamB} isWinner={!!m.winnerRosterId && teamB?.rosterId === m.winnerRosterId} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function PlayoffBracket({ leagueID }: { leagueID: string }) {
  const [bracket, setBracket] = useState<Bracket | null | undefined>(undefined);

  useEffect(() => {
    if (!leagueID) return;
    let cancelled = false;
    setBracket(undefined);

    getPlayoffBracket(leagueID)
      .then((result) => {
        if (!cancelled) setBracket(result);
      })
      .catch((error) => {
        console.error("Error loading playoff bracket:", error);
        if (!cancelled) setBracket(null);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueID]);

  if (bracket === undefined) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator color="#af1222" />
      </View>
    );
  }

  if (!bracket) {
    return (
      <View className="py-8 items-center">
        <Text className="text-gray-500 text-[13px]">Playoffs haven&apos;t started yet this season.</Text>
      </View>
    );
  }

  const allMatches = bracket.rounds.flat();
  const mainMatches = allMatches.filter((m) => m.placement === undefined || m.placement === 1);
  const placementGroups = new Map<number, BracketMatch[]>();
  for (const m of allMatches) {
    if (m.placement === undefined || m.placement === 1) continue;
    if (!placementGroups.has(m.placement)) placementGroups.set(m.placement, []);
    placementGroups.get(m.placement)!.push(m);
  }

  if (mainMatches.length === 0) {
    return (
      <View className="py-8 items-center">
        <Text className="text-gray-500 text-[13px]">No bracket data for this season.</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-1 py-2">
      <View>
        <MainBracketTree mainMatches={mainMatches} championRosterId={bracket.championRosterId} />
        {Array.from(placementGroups.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([placement, matches]) => (
            <PlacementRow key={placement} placement={placement} matches={matches} />
          ))}
      </View>
    </ScrollView>
  );
}
