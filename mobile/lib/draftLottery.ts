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

// A typical competitive dynasty bench's depth at each position - not a
// hard rule, just the baseline "biggest need" is measured against.
const BASELINE_DEPTH: Record<PlayerPos, number> = { QB: 2, RB: 5, WR: 6, TE: 2 };

/** this team's single biggest positional need, from their real rostered player counts against typical competitive dynasty depth at each position */
export function biggestNeed(posCounts: Record<PlayerPos, number>): TeamNeed {
  const needs = (Object.keys(BASELINE_DEPTH) as PlayerPos[]).map((pos) => ({
    pos,
    count: posCounts[pos] ?? 0,
    deficit: BASELINE_DEPTH[pos] - (posCounts[pos] ?? 0),
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
 * A "way-too-early" mock rookie draft, real prospects (draftProspects.ts)
 * against real team needs (each roster's actual positional depth). Draft
 * order is current standings - lottery-position teams worst-to-best, then
 * playoff teams in reverse standings order, the same convention the real
 * NFL draft uses - since there's no actual randomized lottery draw to run
 * here, just the probabilities shown alongside it. At each pick, the team
 * takes the best remaining prospect at their single biggest positional
 * need; if their needs are already well covered, best-player-available
 * off a fixed value-order (WR/RB/QB/TE, matching how dynasty startup
 * rookie capital is typically valued).
 */
export function buildMockDraftBoard(
  draftOrder: { rosterId: string; teamName: string; avatar?: string; posCounts: Record<PlayerPos, number> }[]
): MockDraftPick[] {
  const remaining = [...DRAFT_PROSPECTS];
  const bestAt = (pos: PlayerPos) => remaining.filter((p) => p.pos === pos).sort((a, b) => a.posRank - b.posRank)[0];

  return draftOrder.map((team, i) => {
    const need = biggestNeed(team.posCounts);
    let prospect = need.deficit > 0 ? bestAt(need.pos) : undefined;
    if (!prospect) {
      for (const pos of ["WR", "RB", "QB", "TE"] as PlayerPos[]) {
        prospect = bestAt(pos);
        if (prospect) break;
      }
    }
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
