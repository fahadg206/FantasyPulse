// Trade Finder's matching engine - takes what a manager wants to give up
// (specific players and/or "just a position, pick my best one there") and
// what they want back (positions only), and searches every other real
// roster in the league for the fairest real trade that gets them there.
//
// Built entirely on infrastructure this app already trusts for trade
// value and team needs: computeAdjustedValue (the same real KTC-market
// value the Trade Calculator prices every player at) and
// computeTeamNeeds/computeRedraftTeamNeeds (the same dynasty-vs-redraft
// need scoring already used to show "Needs: RB, TE" badges there) - no
// new valuation model, just a search over the league using the one this
// app already has.

import { RawPlayerValue, LeagueValueSettings, computeAdjustedValue } from "./playerValue";
import { TeamNeedsResult } from "./tradeAnalysis";
import type { PlayerPos } from "./draftProspects";

/** the 4 positions real need-scoring covers (see draftLottery.ts) - K/DEF are still fully tradeable, they just never get a "needs this" / "has surplus here" reason attached, the same limitation Trade Calculator's needs badges already have. */
const NEED_POSITIONS = new Set<string>(["QB", "RB", "WR", "TE"]);

export type GiveItem = { kind: "player"; playerId: string } | { kind: "position"; pos: string };

export interface ResolvedGivePlayer {
  playerId: string;
  pos: string;
  team?: string;
  value: number;
  /** true when this player was auto-picked from a "position" give item rather than chosen by name */
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

/** picks the highest-value player on a roster at a given position, skipping any id already spoken for - the concrete player behind a bare "trade away my RB" position pick. */
function bestUnusedAtPosition(
  rosterPlayerIds: string[],
  pos: string,
  used: Set<string>,
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings
): { playerId: string; value: number } | null {
  let best: { playerId: string; value: number } | null = null;
  for (const pid of rosterPlayerIds) {
    if (used.has(pid)) continue;
    if (playersData[pid]?.pos !== pos) continue;
    const raw = valuesBySleeperId[pid];
    if (!raw) continue;
    const value = computeAdjustedValue(raw, leagueValueSettings);
    if (value > 0 && (!best || value > best.value)) best = { playerId: pid, value };
  }
  return best;
}

/** turns a mix of explicit players and bare positions into concrete, valued players - specific picks first (so a position pick never steals a player the manager explicitly named), then the best remaining player at each position. */
export function resolveGiveItems(
  items: GiveItem[],
  myRosterPlayerIds: string[],
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings
): ResolvedGivePlayer[] {
  const used = new Set<string>();
  const resolved: ResolvedGivePlayer[] = [];

  for (const item of items) {
    if (item.kind !== "player") continue;
    if (used.has(item.playerId)) continue;
    const raw = valuesBySleeperId[item.playerId];
    const value = raw ? computeAdjustedValue(raw, leagueValueSettings) : 0;
    resolved.push({
      playerId: item.playerId,
      pos: playersData[item.playerId]?.pos ?? "",
      team: playersData[item.playerId]?.t,
      value,
      auto: false,
    });
    used.add(item.playerId);
  }

  for (const item of items) {
    if (item.kind !== "position") continue;
    const pick = bestUnusedAtPosition(myRosterPlayerIds, item.pos, used, playersData, valuesBySleeperId, leagueValueSettings);
    if (!pick) continue;
    resolved.push({
      playerId: pick.playerId,
      pos: item.pos,
      team: playersData[pick.playerId]?.t,
      value: pick.value,
      auto: true,
    });
    used.add(pick.playerId);
  }

  return resolved;
}

/** every value>0 player on a roster at one of the wanted positions, sorted best first. */
function candidatesAtPositions(
  rosterPlayerIds: string[],
  wantPositions: string[],
  playersData: Record<string, any>,
  valuesBySleeperId: Record<string, RawPlayerValue>,
  leagueValueSettings: LeagueValueSettings
): TradeCandidatePlayer[] {
  const wanted = new Set(wantPositions);
  const out: TradeCandidatePlayer[] = [];
  for (const pid of rosterPlayerIds) {
    const pos = playersData[pid]?.pos;
    if (!pos || !wanted.has(pos)) continue;
    const raw = valuesBySleeperId[pid];
    if (!raw) continue;
    const value = computeAdjustedValue(raw, leagueValueSettings);
    if (value > 0) out.push({ playerId: pid, pos, team: playersData[pid]?.t, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** the closest-to-giveValue return package this roster can offer at the wanted positions - a single player when one's close enough, otherwise the best-matching pair from its top candidates (bounded search, not full combinatorics). */
function bestReturnPackage(
  candidates: TradeCandidatePlayer[],
  giveValue: number
): TradeCandidatePlayer[] | null {
  if (candidates.length === 0) return null;

  let bestSingle: TradeCandidatePlayer | null = null;
  let bestSingleGap = Infinity;
  for (const c of candidates) {
    const gap = Math.abs(giveValue - c.value);
    if (gap < bestSingleGap) {
      bestSingleGap = gap;
      bestSingle = c;
    }
  }

  // Only worth pairing up when no single player gets within 25% of the
  // target value on its own - otherwise a clean 1-for-1 reads far more
  // like a real trade than padding it with a throw-in.
  const singleIsClose = bestSingle !== null && bestSingleGap <= giveValue * 0.25;
  if (singleIsClose) return bestSingle ? [bestSingle] : null;

  const pool = candidates.slice(0, 6);
  let bestPair: TradeCandidatePlayer[] | null = null;
  let bestPairGap = bestSingleGap;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const sum = pool[i].value + pool[j].value;
      const gap = Math.abs(giveValue - sum);
      if (gap < bestPairGap) {
        bestPairGap = gap;
        bestPair = [pool[i], pool[j]];
      }
    }
  }

  return bestPair ?? (bestSingle ? [bestSingle] : null);
}

export interface FindTradeMatchesParams {
  myUserId: string;
  giveItems: GiveItem[];
  wantPositions: string[];
  myRosterPlayerIds: string[];
  /** every OTHER manager's roster - the searching manager's own id should not be a key here */
  otherRosters: Record<string, string[]>;
  playersData: Record<string, any>;
  valuesBySleeperId: Record<string, RawPlayerValue>;
  leagueValueSettings: LeagueValueSettings;
  /** dynasty-vs-redraft team needs for a given roster, already branched the same way Trade Calculator does (computeTeamNeeds vs. computeRedraftTeamNeeds) - passed in as a function so this engine doesn't need to know which format it's in. */
  getTeamNeeds: (rosterPlayerIds: string[]) => TeamNeedsResult;
  maxResults?: number;
}

export interface FindTradeMatchesResult {
  give: ResolvedGivePlayer[];
  giveValue: number;
  candidates: TradeCandidate[];
}

const NOTABLE_NEED = 0.15;
const CLEAR_SURPLUS = 0.08;

export function findTradeMatches(params: FindTradeMatchesParams): FindTradeMatchesResult {
  const {
    giveItems,
    wantPositions,
    myRosterPlayerIds,
    otherRosters,
    playersData,
    valuesBySleeperId,
    leagueValueSettings,
    getTeamNeeds,
    maxResults = 8,
  } = params;

  const give = resolveGiveItems(giveItems, myRosterPlayerIds, playersData, valuesBySleeperId, leagueValueSettings);
  const giveValue = give.reduce((s, p) => s + p.value, 0);

  if (give.length === 0 || wantPositions.length === 0 || giveValue === 0) {
    return { give, giveValue, candidates: [] };
  }

  const givePositions = [...new Set(give.map((p) => p.pos))];
  const candidates: TradeCandidate[] = [];

  for (const partnerUserId in otherRosters) {
    const roster = otherRosters[partnerUserId];
    const pool = candidatesAtPositions(roster, wantPositions, playersData, valuesBySleeperId, leagueValueSettings);
    const pkg = bestReturnPackage(pool, giveValue);
    if (!pkg) continue;

    const receiveValue = pkg.reduce((s, p) => s + p.value, 0);
    const netValue = receiveValue - giveValue;
    const fairnessRatio = Math.abs(netValue) / giveValue;

    const reasons: string[] = [];
    const theirNeeds = getTeamNeeds(roster);
    for (const pos of givePositions) {
      if (!NEED_POSITIONS.has(pos)) continue;
      if ((theirNeeds.scores[pos as PlayerPos] ?? 0) > NOTABLE_NEED) {
        reasons.push(`Needs help at ${pos}`);
      }
    }
    for (const pos of new Set(pkg.map((p) => p.pos))) {
      if (!NEED_POSITIONS.has(pos)) continue;
      if ((theirNeeds.scores[pos as PlayerPos] ?? 1) < CLEAR_SURPLUS) {
        reasons.push(`Deep at ${pos}, could afford to move one`);
      }
    }

    candidates.push({ partnerUserId, give, receive: pkg, giveValue, receiveValue, netValue, fairnessRatio, reasons });
  }

  // Fairest first, with real mutual fit (a team that actually needs what
  // you're offering and can spare what you're asking for) nudging a trade
  // up over a purely closer dollar-for-dollar match against a partner who
  // has no real reason to say yes - each real reason shaves a little off
  // the effective fairness gap without letting it override a genuinely
  // lopsided value mismatch.
  const rankScore = (c: TradeCandidate) => c.fairnessRatio - c.reasons.length * 0.05;
  candidates.sort((a, b) => rankScore(a) - rankScore(b));

  return { give, giveValue, candidates: candidates.slice(0, maxResults) };
}
