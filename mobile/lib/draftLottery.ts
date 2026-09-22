import { DraftProspect, DRAFT_PROSPECTS, PlayerPos } from "./draftProspects";

// League-specific draft-lottery + "way too early" mock rookie draft board.
// Not a Sleeper concept and not something every league wants, so it's
// gated to specific league ids - same pattern as leagueZones.ts and
// manualTitles.ts.
export const LOTTERY_LEAGUE_IDS = new Set(["1337305377120751616"]);

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

export interface TeamNeed {
  pos: PlayerPos;
  count: number;
  deficit: number;
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
  // A superflex slot is usually filled by a QB on a competitive build, so
  // it counts toward QB starting demand directly; a generic FLEX splits
  // its demand three ways across RB/WR/TE.
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

/** this team's single biggest positional need, from their real rostered player counts against this league's own real starting requirements (computeBaselineDepth) */
export function biggestNeed(posCounts: Record<PlayerPos, number>, baselineDepth: Record<PlayerPos, number>): TeamNeed {
  const needs = (Object.keys(baselineDepth) as PlayerPos[]).map((pos) => ({
    pos,
    count: posCounts[pos] ?? 0,
    deficit: baselineDepth[pos] - (posCounts[pos] ?? 0),
  }));
  needs.sort((a, b) => b.deficit - a.deficit);
  return needs[0];
}

export interface MockDraftPick {
  pickNumber: number;
  rosterId: string;
  teamName: string;
  avatar?: string;
  need: PlayerPos;
  prospect: DraftProspect | null;
}

/**
 * A "way-too-early" mock rookie draft, real prospects (draftProspects.ts,
 * already ranked in superflex-weighted order) against real team needs
 * (each roster's actual positional depth vs. this league's own real
 * starting requirements). Draft order is current standings -
 * lottery-position teams worst-to-best, then playoff teams in reverse
 * standings order, the same convention the real NFL draft uses - since
 * there's no actual randomized lottery draw to run here, just the
 * probabilities shown alongside it. At each pick, the team takes the best
 * remaining prospect at their single biggest positional need; if their
 * needs are already well covered, best-player-available by overall
 * (superflex) rank.
 */
export function buildMockDraftBoard(
  draftOrder: { rosterId: string; teamName: string; avatar?: string; posCounts: Record<PlayerPos, number> }[],
  baselineDepth: Record<PlayerPos, number>
): MockDraftPick[] {
  const remaining = [...DRAFT_PROSPECTS];
  const bestAt = (pos: PlayerPos) => remaining.filter((p) => p.pos === pos).sort((a, b) => a.posRank - b.posRank)[0];
  const bestOverall = () => [...remaining].sort((a, b) => a.overallRank - b.overallRank)[0];

  return draftOrder.map((team, i) => {
    const need = biggestNeed(team.posCounts, baselineDepth);
    const prospect = (need.deficit > 0 && bestAt(need.pos)) || bestOverall();
    if (prospect) remaining.splice(remaining.indexOf(prospect), 1);

    return {
      pickNumber: i + 1,
      rosterId: team.rosterId,
      teamName: team.teamName,
      avatar: team.avatar,
      need: need.pos,
      prospect: prospect ?? null,
    };
  });
}
