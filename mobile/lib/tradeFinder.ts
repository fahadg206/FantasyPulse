// Trade Finder's matching engine - takes what a manager wants to give up
// (specific players and/or "just a position, pick something there") and
// what they want back (positions only), and searches every other real
// roster in the league for the fairest real trade that gets them there.
//
// Real trade value comes from lib/tradeValue.ts (a real external redraft
// market for redraft leagues, real KTC dynasty market for dynasty) -
// injected as a plain lookup function so this engine doesn't need to know
// which format it's in. Team needs come from computeTeamNeeds /
// computeRedraftTeamNeeds, the same dynasty-vs-redraft need scoring
// already used to show "Needs: RB, TE" badges on Trade Calculator.
//
// A "position" give item is NOT resolved to your single best player at
// that position up front - which specific player gets offered is chosen
// per trade partner, picked from your real options there to be the
// closest value match to what that partner can actually send back. Only
// an explicitly-named player is ever fixed regardless of partner.

import { TeamNeedsResult } from "./tradeAnalysis";
import type { PlayerPos } from "./draftProspects";
import type { TradeValueLookup } from "./tradeValue";

/** the 4 positions real need-scoring covers (see draftLottery.ts) - K/DEF are still fully tradeable, they just never get a "needs this" / "has surplus here" reason attached, the same limitation Trade Calculator's needs badges already have. */
const NEED_POSITIONS = new Set<string>(["QB", "RB", "WR", "TE"]);

export type GiveItem = { kind: "player"; playerId: string } | { kind: "position"; pos: string };

export interface ResolvedGivePlayer {
  playerId: string;
  pos: string;
  team?: string;
  value: number;
  /** true when this player was picked to fill a "position" give item rather than chosen by name - which specific player varies by trade partner (see module docs), an explicit pick never does */
  auto: boolean;
}

export interface TradeCandidatePlayer {
  playerId: string;
  pos: string;
  team?: string;
  value: number;
}

export interface TradeCandidate {
  partnerUserId: string;
  give: ResolvedGivePlayer[];
  receive: TradeCandidatePlayer[];
  giveValue: number;
  receiveValue: number;
  /** receiveValue - giveValue, from the searching manager's own side */
  netValue: number;
  /** 0 = dead even, higher = more lopsided (abs(net) / giveValue) */
  fairnessRatio: number;
  reasons: string[];
}

/** one "position" give item's real options on your roster - every valued player there, best first, capped so the combo search below stays cheap. */
export interface GivePositionSlot {
  pos: string;
  pool: TradeCandidatePlayer[];
}

/** every value>0 player on a roster at a given position, best first. */
function poolAtPosition(
  rosterPlayerIds: string[],
  pos: string,
  exclude: Set<string>,
  playersData: Record<string, any>,
  valueFor: TradeValueLookup,
  cap = 6
): TradeCandidatePlayer[] {
  const out: TradeCandidatePlayer[] = [];
  for (const pid of rosterPlayerIds) {
    if (exclude.has(pid)) continue;
    if (playersData[pid]?.pos !== pos) continue;
    const value = valueFor(pid);
    if (value > 0) out.push({ playerId: pid, pos, team: playersData[pid]?.t, value });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, cap);
}

/** every value>0 player on a roster at one of the wanted positions, sorted best first. */
function candidatesAtPositions(
  rosterPlayerIds: string[],
  wantPositions: string[],
  playersData: Record<string, any>,
  valueFor: TradeValueLookup
): TradeCandidatePlayer[] {
  const wanted = new Set(wantPositions);
  const out: TradeCandidatePlayer[] = [];
  for (const pid of rosterPlayerIds) {
    const pos = playersData[pid]?.pos;
    if (!pos || !wanted.has(pos)) continue;
    const value = valueFor(pid);
    if (value > 0) out.push({ playerId: pid, pos, team: playersData[pid]?.t, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** the closest-to-targetValue return package a roster can offer at the wanted positions - a single player when one's close enough, otherwise the best-matching pair from its top candidates (bounded search, not full combinatorics). */
function bestReturnPackage(candidates: TradeCandidatePlayer[], targetValue: number): TradeCandidatePlayer[] | null {
  if (candidates.length === 0) return null;

  let bestSingle: TradeCandidatePlayer | null = null;
  let bestSingleGap = Infinity;
  for (const c of candidates) {
    const gap = Math.abs(targetValue - c.value);
    if (gap < bestSingleGap) {
      bestSingleGap = gap;
      bestSingle = c;
    }
  }

  // Only worth pairing up when no single player gets within 25% of the
  // target value on its own - otherwise a clean 1-for-1 reads far more
  // like a real trade than padding it with a throw-in.
  if (bestSingle !== null && bestSingleGap <= targetValue * 0.25) return [bestSingle];

  const pool = candidates.slice(0, 6);
  let bestPair: TradeCandidatePlayer[] | null = null;
  let bestPairGap = bestSingleGap;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const sum = pool[i].value + pool[j].value;
      const gap = Math.abs(targetValue - sum);
      if (gap < bestPairGap) {
        bestPairGap = gap;
        bestPair = [pool[i], pool[j]];
      }
    }
  }

  return bestPair ?? (bestSingle ? [bestSingle] : null);
}

/** every way to pick one player from each pool with no player repeated - small by construction (each pool capped at 6, realistically 1-3 pools), a real search rather than a single best-of-each shortcut. */
function* comboGenerator(pools: TradeCandidatePlayer[][], used: Set<string>): Generator<TradeCandidatePlayer[]> {
  if (pools.length === 0) {
    yield [];
    return;
  }
  const [first, ...rest] = pools;
  for (const candidate of first) {
    if (used.has(candidate.playerId)) continue;
    used.add(candidate.playerId);
    for (const combo of comboGenerator(rest, used)) yield [candidate, ...combo];
    used.delete(candidate.playerId);
  }
}

/** across every pool's combos, the one whose total value sits closest to targetValue - what actually offering a partner-appropriate player at each "position" slot means, instead of always your single best one. */
function bestGiveCombo(pools: TradeCandidatePlayer[][], targetValue: number, seedUsed: Set<string>): TradeCandidatePlayer[] {
  let best: TradeCandidatePlayer[] = [];
  let bestGap = Infinity;
  for (const combo of comboGenerator(pools, new Set(seedUsed))) {
    const sum = combo.reduce((s, p) => s + p.value, 0);
    const gap = Math.abs(targetValue - sum);
    if (gap < bestGap) {
      bestGap = gap;
      best = combo;
    }
  }
  return best;
}

export interface FindTradeMatchesParams {
  giveItems: GiveItem[];
  wantPositions: string[];
  myRosterPlayerIds: string[];
  /** every OTHER manager's roster - the searching manager's own id should not be a key here */
  otherRosters: Record<string, string[]>;
  playersData: Record<string, any>;
  valueFor: TradeValueLookup;
  /** dynasty-vs-redraft team needs for a given roster, already branched the same way Trade Calculator does (computeTeamNeeds vs. computeRedraftTeamNeeds) - passed in as a function so this engine doesn't need to know which format it's in. */
  getTeamNeeds: (rosterPlayerIds: string[]) => TeamNeedsResult;
  maxResults?: number;
}

export interface FindTradeMatchesResult {
  /** explicit player picks only - always the same regardless of trade partner */
  fixedGive: ResolvedGivePlayer[];
  fixedGiveValue: number;
  /** one entry per "position" give item, in the order they were added - `pool.length === 0` means you have no valued player there at all, a real dead end regardless of partner */
  positionSlots: GivePositionSlot[];
  candidates: TradeCandidate[];
}

const NOTABLE_NEED = 0.15;
const CLEAR_SURPLUS = 0.08;

export function findTradeMatches(params: FindTradeMatchesParams): FindTradeMatchesResult {
  const { giveItems, wantPositions, myRosterPlayerIds, otherRosters, playersData, valueFor, getTeamNeeds, maxResults = 8 } = params;

  const usedIds = new Set<string>();
  const fixedGive: ResolvedGivePlayer[] = [];
  for (const item of giveItems) {
    if (item.kind !== "player" || usedIds.has(item.playerId)) continue;
    fixedGive.push({
      playerId: item.playerId,
      pos: playersData[item.playerId]?.pos ?? "",
      team: playersData[item.playerId]?.t,
      value: valueFor(item.playerId),
      auto: false,
    });
    usedIds.add(item.playerId);
  }
  const fixedGiveValue = fixedGive.reduce((s, p) => s + p.value, 0);

  const positionSlots: GivePositionSlot[] = giveItems
    .filter((it): it is { kind: "position"; pos: string } => it.kind === "position")
    .map((it) => ({ pos: it.pos, pool: poolAtPosition(myRosterPlayerIds, it.pos, usedIds, playersData, valueFor) }));

  const empty: FindTradeMatchesResult = { fixedGive, fixedGiveValue, positionSlots, candidates: [] };
  if (wantPositions.length === 0) return empty;
  if (fixedGive.length === 0 && positionSlots.every((s) => s.pool.length === 0)) return empty;

  // A neutral first estimate of what you're offering, just to find each
  // partner's own ballpark return - refined per partner below.
  const baselinePicks = positionSlots.map((s) => s.pool[0]).filter((p): p is TradeCandidatePlayer => !!p);
  const baselineGiveValue = fixedGiveValue + baselinePicks.reduce((s, p) => s + p.value, 0);
  if (baselineGiveValue === 0) return empty;

  const givePositionsForReasons = [...new Set([...fixedGive.map((p) => p.pos), ...positionSlots.map((s) => s.pos)])];
  const pools = positionSlots.map((s) => s.pool);
  const candidates: TradeCandidate[] = [];

  for (const partnerUserId in otherRosters) {
    const roster = otherRosters[partnerUserId];
    const theirPool = candidatesAtPositions(roster, wantPositions, playersData, valueFor);
    if (theirPool.length === 0) continue;

    const roughPkg = bestReturnPackage(theirPool, baselineGiveValue);
    if (!roughPkg) continue;
    const roughReceiveValue = roughPkg.reduce((s, p) => s + p.value, 0);

    // Pick the specific player at each "position" slot that gets your
    // side closest to what this particular partner can actually send
    // back - a partner offering a mid-tier player back gets offered a
    // mid-tier player of yours in turn, not your best one every time.
    const combo = pools.length > 0 ? bestGiveCombo(pools, roughReceiveValue - fixedGiveValue, usedIds) : [];
    const giveValue = fixedGiveValue + combo.reduce((s, p) => s + p.value, 0);

    // One more look at their return now that your side is tuned to them,
    // in case a tighter match opens up against the refined value.
    const finalPkg = bestReturnPackage(theirPool, giveValue) ?? roughPkg;
    const receiveValue = finalPkg.reduce((s, p) => s + p.value, 0);
    const netValue = receiveValue - giveValue;
    const fairnessRatio = giveValue > 0 ? Math.abs(netValue) / giveValue : 1;

    const give: ResolvedGivePlayer[] = [
      ...fixedGive,
      ...combo.map((c) => ({ playerId: c.playerId, pos: c.pos, team: c.team, value: c.value, auto: true })),
    ];

    const reasons: string[] = [];
    const theirNeeds = getTeamNeeds(roster);
    for (const pos of givePositionsForReasons) {
      if (!NEED_POSITIONS.has(pos)) continue;
      if ((theirNeeds.scores[pos as PlayerPos] ?? 0) > NOTABLE_NEED) reasons.push(`Needs help at ${pos}`);
    }
    for (const pos of new Set(finalPkg.map((p) => p.pos))) {
      if (!NEED_POSITIONS.has(pos)) continue;
      if ((theirNeeds.scores[pos as PlayerPos] ?? 1) < CLEAR_SURPLUS) reasons.push(`Deep at ${pos}, could afford to move one`);
    }

    candidates.push({ partnerUserId, give, receive: finalPkg, giveValue, receiveValue, netValue, fairnessRatio, reasons });
  }

  // Fairest first, with real mutual fit (a team that actually needs what
  // you're offering and can spare what you're asking for) nudging a trade
  // up over a purely closer dollar-for-dollar match against a partner who
  // has no real reason to say yes - each real reason shaves a little off
  // the effective fairness gap without letting it override a genuinely
  // lopsided value mismatch.
  const rankScore = (c: TradeCandidate) => c.fairnessRatio - c.reasons.length * 0.05;
  candidates.sort((a, b) => rankScore(a) - rankScore(b));

  return { fixedGive, fixedGiveValue, positionSlots, candidates: candidates.slice(0, maxResults) };
}
