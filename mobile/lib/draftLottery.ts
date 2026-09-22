import { DraftProspect, DRAFT_PROSPECTS, PlayerPos } from "./draftProspects";

// League-specific draft-lottery + "way too early" mock rookie draft board.
// Not a Sleeper concept and not something every league wants, so it's
// gated to specific league ids - same pattern as leagueZones.ts and
// manualTitles.ts.
export const LOTTERY_LEAGUE_IDS = new Set(["1337305377120751616"]);

export const MOCK_DRAFT_ROUNDS = 4;

export interface LotteryTeam {
  rosterId: string;
  teamName: string;
  avatar?: string;
  odds: number;
}

const LOTTERY_START_PCT = 30;
const LOTTERY_STEP_PCT = 5;

/** the teams currently on the outside of the playoff picture, worst record first, each assigned descending odds starting at 30% and stepping down 5% per slot */
export function computeLotteryOdds(
  nonPlayoffTeamsWorstFirst: { rosterId: string; teamName: string; avatar?: string }[]
): LotteryTeam[] {
  return nonPlayoffTeamsWorstFirst.map((t, i) => ({
    ...t,
    odds: Math.max(0, LOTTERY_START_PCT - i * LOTTERY_STEP_PCT),
  }));
}

/**
 * How deep a competitive roster needs to be at each position, derived from
 * this league's actual roster_positions - not a generic guess. Real
 * starting demand first (a FLEX/SUPER_FLEX slot's demand is split across
 * whatever's actually eligible to fill it), then a depth multiplier that's
 * bigger for QB in a superflex league specifically - real QB scarcity plus
 * 2 startable QB slots is what actually drives dynasty superflex startup
 * strategy (hoard QBs), which a 1-QB league has no reason to do.
 */
export function computeBaselineDepth(rosterPositions: string[]): Record<PlayerPos, number> {
  const count = (p: string) => rosterPositions.filter((s) => s === p).length;
  const qbSlots = count("QB");
  const sfSlots = count("SUPER_FLEX") + count("SUPERFLEX");
  const rbSlots = count("RB");
  const wrSlots = count("WR");
  const teSlots = count("TE");
  const flexSlots = count("FLEX") + count("WRRB_FLEX") + count("REC_FLEX");

  const isSuperflex = sfSlots > 0;
  const qbStarters = qbSlots + sfSlots;
  const rbStarters = rbSlots + flexSlots / 3;
  const wrStarters = wrSlots + flexSlots / 3;
  const teStarters = teSlots + flexSlots / 3;

  return {
    QB: Math.ceil(qbStarters * (isSuperflex ? 1.8 : 1.5)),
    RB: Math.ceil(rbStarters * 1.8),
    WR: Math.ceil(wrStarters * 1.8),
    TE: Math.ceil(teStarters * 1.6),
  };
}

export interface TeamNeed {
  pos: PlayerPos;
  count: number;
  deficit: number;
}

/** this team's single biggest positional need, from their real rostered player counts against this league's own real starting requirements - display-only (the "NEEDS X" badge); pick selection uses the blended scorer below, not this alone */
export function biggestNeed(posCounts: Record<PlayerPos, number>, baselineDepth: Record<PlayerPos, number>): TeamNeed {
  const needs = (Object.keys(baselineDepth) as PlayerPos[]).map((pos) => ({
    pos,
    count: posCounts[pos] ?? 0,
    deficit: baselineDepth[pos] - (posCounts[pos] ?? 0),
  }));
  needs.sort((a, b) => b.deficit - a.deficit);
  return needs[0];
}

// How much one unit of positional need is worth against the prospect
// pool's own value spread (0..poolSize on overallRank) - tuned so a real
// need can flip a close value decision (a mid-pack rank gap) without ever
// justifying reaching for a deep-bench prospect over a true blue-chip at
// a position the team doesn't need. Superflex value still wins the big
// gaps; need only wins the close ones - which is the balance actually
// asked for here.
const NEED_WEIGHT = 6;

/**
 * The actual pick: scores every remaining prospect as (value from their
 * superflex-weighted overall rank) + (need bonus at their position for
 * this team), and takes the highest. Not "fill the biggest need no matter
 * what," and not pure best-player-available either - both matter, the
 * same way a real dynasty rookie draft decision actually gets made.
 */
function pickBestProspect(
  remaining: DraftProspect[],
  posCounts: Record<PlayerPos, number>,
  baselineDepth: Record<PlayerPos, number>
): DraftProspect | undefined {
  const poolSize = remaining.length;
  let best: DraftProspect | undefined;
  let bestScore = -Infinity;
  for (const p of remaining) {
    const deficit = Math.max(0, baselineDepth[p.pos] - (posCounts[p.pos] ?? 0));
    const valueScore = poolSize - p.overallRank;
    const score = valueScore + deficit * NEED_WEIGHT;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export interface DraftSlot {
  round: number;
  originalRosterId: string;
  /** who's actually making this pick - equals originalRosterId unless the pick was traded */
  currentRosterId: string;
  teamName: string;
  avatar?: string;
  /** set when this pick was traded away from its original team - the original team's name, for the "via" note */
  viaTeamName?: string;
}

export interface MockDraftPick extends DraftSlot {
  pickNumber: number;
  need: PlayerPos;
  prospect: DraftProspect | null;
}

/**
 * Runs the full mock draft across every round in `slots` (already in
 * round-major pick order - round 1 picks 1..N, then round 2, etc.), one
 * shrinking prospect pool shared across all of it so nobody gets drafted
 * twice, and each team's own positional counts updated as they pick -
 * a team's round 2 need already reflects what they took in round 1 of
 * this same mock, same as a real draft.
 */
export function buildMockDraftBoard(
  slots: DraftSlot[],
  initialPosCounts: Record<string, Record<PlayerPos, number>>,
  baselineDepth: Record<PlayerPos, number>
): MockDraftPick[] {
  const remaining = [...DRAFT_PROSPECTS];
  const posCounts: Record<string, Record<PlayerPos, number>> = {};
  for (const [rosterId, counts] of Object.entries(initialPosCounts)) {
    posCounts[rosterId] = { ...counts };
  }

  return slots.map((slot, i) => {
    const counts = posCounts[slot.currentRosterId] ?? { QB: 0, RB: 0, WR: 0, TE: 0 };
    const need = biggestNeed(counts, baselineDepth);
    const prospect = pickBestProspect(remaining, counts, baselineDepth);
    if (prospect) {
      remaining.splice(remaining.indexOf(prospect), 1);
      counts[prospect.pos] = (counts[prospect.pos] ?? 0) + 1;
      posCounts[slot.currentRosterId] = counts;
    }

    return {
      ...slot,
      pickNumber: i + 1,
      need: need.pos,
      prospect: prospect ?? null,
    };
  });
}
