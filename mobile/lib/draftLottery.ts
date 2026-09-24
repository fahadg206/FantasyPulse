import { DraftProspect, DRAFT_PROSPECTS, PlayerPos } from "./draftProspects";

// League-specific draft-lottery + "way too early" mock rookie draft board.
// Not a Sleeper concept and not something every league wants, so it's
// gated to specific league ids - same pattern as leagueZones.ts and
// manualTitles.ts.
export const LOTTERY_LEAGUE_IDS = new Set(["1337305377120751616"]);

export const MOCK_DRAFT_ROUNDS = 4;

export interface LotteryTeam {
  rosterId: string;
  userId?: string;
  teamName: string;
  avatar?: string;
  odds: number;
}

const LOTTERY_START_PCT = 30;
const LOTTERY_STEP_PCT = 5;

/** the teams currently on the outside of the playoff picture, worst record first, each assigned descending odds starting at 30% and stepping down 5% per slot */
export function computeLotteryOdds(
  nonPlayoffTeamsWorstFirst: { rosterId: string; userId?: string; teamName: string; avatar?: string }[]
): LotteryTeam[] {
  return nonPlayoffTeamsWorstFirst.map((t, i) => ({
    ...t,
    odds: Math.max(0, LOTTERY_START_PCT - i * LOTTERY_STEP_PCT),
  }));
}

const POSITIONS: PlayerPos[] = ["QB", "RB", "WR", "TE"];

/**
 * The league's own bar for "a real starter" at each position - the
 * average, across every team, of that team's single most valuable real
 * rostered player at the position (real KeepTradeCut dynasty values, via
 * this app's own player-value API, format-adjusted for this league's
 * actual scoring/superflex settings). Computed once, from real rosters
 * only, and held fixed for the rest of a mock draft - the bar shouldn't
 * drift just because mock picks are being simulated against it.
 */
export function computeLeagueAvgBestValue(
  bestValueByRosterAndPos: Record<string, Record<PlayerPos, number>>
): Record<PlayerPos, number> {
  const rosterIds = Object.keys(bestValueByRosterAndPos);
  const avg = {} as Record<PlayerPos, number>;
  for (const pos of POSITIONS) {
    const sum = rosterIds.reduce((s, id) => s + (bestValueByRosterAndPos[id]?.[pos] ?? 0), 0);
    avg[pos] = rosterIds.length > 0 ? sum / rosterIds.length : 0;
  }
  return avg;
}

export interface TeamNeed {
  pos: PlayerPos;
  /** 0 = has a real starter at or above the league's own bar at this position; closer to 1 = far below it (or nothing rostered there at all) */
  score: number;
}

/**
 * Real, value-based need: how far below the league's own bar (see
 * computeLeagueAvgBestValue) this team's best real player at each
 * position sits - not a roster-depth headcount, which is exactly what
 * flagged a team as "needing a TE" while they were already rostering a
 * legitimately elite one. A team that's thin in bodies at a position but
 * has one genuinely great starter there isn't actually needy at it; a
 * team with plenty of bodies but nobody good is.
 */
export function needScoresForTeam(
  bestValueForTeam: Record<PlayerPos, number>,
  leagueAvg: Record<PlayerPos, number>
): Record<PlayerPos, number> {
  const scores = {} as Record<PlayerPos, number>;
  for (const pos of POSITIONS) {
    const avg = leagueAvg[pos];
    const best = bestValueForTeam[pos] ?? 0;
    scores[pos] = avg > 0 ? Math.max(0, (avg - best) / avg) : 0;
  }
  return scores;
}

/** the single position this team is weakest at, real-value-wise - display-only (the "NEEDS X" badge); pick selection uses the blended scorer below, not this alone */
export function biggestNeed(scores: Record<PlayerPos, number>): TeamNeed {
  const entries = POSITIONS.map((pos) => ({ pos, score: scores[pos] ?? 0 }));
  entries.sort((a, b) => b.score - a.score);
  return entries[0];
}

/**
 * A rough dynasty-rookie-capital curve: how a prospect's superflex
 * overall rank translates to a KTC-like value, so a mock pick can update
 * a team's "best value at this position" the same way a real acquisition
 * would (letting round 2+ needs reflect what a team actually took in
 * round 1 of this same mock) - not real KTC data (these players aren't
 * NFL assets yet), just a reasonable, consistent decay curve matching how
 * real rookie pick value charts taper off.
 */
export function impliedProspectValue(overallRank: number): number {
  return Math.round(9500 * Math.pow(0.955, overallRank - 1));
}

// How much a full (ratio 1.0 - nothing rostered at all) need is worth
// against the prospect pool's own implied-value spread - tuned so a real
// need can flip a close value decision without ever justifying a reach
// for a scrub-tier prospect over a true blue-chip at a position the team
// doesn't need.
const NEED_WEIGHT = 3500;

function pickBestProspect(
  remaining: DraftProspect[],
  needScores: Record<PlayerPos, number>
): DraftProspect | undefined {
  let best: DraftProspect | undefined;
  let bestScore = -Infinity;
  for (const p of remaining) {
    const score = impliedProspectValue(p.overallRank) + (needScores[p.pos] ?? 0) * NEED_WEIGHT;
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
  userId?: string;
  teamName: string;
  avatar?: string;
  /** set when this pick was traded away from its original team - the original team's name/avatar, for the "via" note */
  viaTeamName?: string;
  viaAvatar?: string;
  viaUserId?: string;
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
 * twice, and each team's own "best value at position" updated as they
 * pick (via impliedProspectValue) so a team's round 2 need already
 * reflects what they took in round 1 of this same mock.
 */
export function buildMockDraftBoard(
  slots: DraftSlot[],
  initialBestValueByRoster: Record<string, Record<PlayerPos, number>>,
  leagueAvg: Record<PlayerPos, number>
): MockDraftPick[] {
  const remaining = [...DRAFT_PROSPECTS];
  const bestValue: Record<string, Record<PlayerPos, number>> = {};
  for (const [id, v] of Object.entries(initialBestValueByRoster)) {
    bestValue[id] = { ...v };
  }

  return slots.map((slot, i) => {
    const current = bestValue[slot.currentRosterId] ?? ({} as Record<PlayerPos, number>);
    const needs = needScoresForTeam(current, leagueAvg);
    const need = biggestNeed(needs);
    const prospect = pickBestProspect(remaining, needs);
    if (prospect) {
      remaining.splice(remaining.indexOf(prospect), 1);
      const implied = impliedProspectValue(prospect.overallRank);
      current[prospect.pos] = Math.max(current[prospect.pos] ?? 0, implied);
      bestValue[slot.currentRosterId] = current;
    }

    return {
      ...slot,
      pickNumber: i + 1,
      need: need.pos,
      prospect: prospect ?? null,
    };
  });
}
