// All-time lineup efficiency: across every week of every league a manager
// has ever played, how much of the points they could have scored (their
// best possible lineup from their full roster that week) did they
// actually start? The actual crawl (season enumeration, per-league
// fetches) now lives in profileActivity.ts's getAllTimeStats, merged
// together with career stats to avoid two independent full history
// crawls - this file keeps just the shared math and types.

/** exported so lib/profileActivity.ts's merged all-time crawl can apply the same slot filtering without duplicating this list */
export const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);

// Multi-position slots map to the positions eligible to fill them; every
// other slot (QB, RB, WR, TE, K, DEF, ...) is eligible for exactly itself.
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

function slotEligibility(slot: string): string[] {
  return FLEX_ELIGIBILITY[slot] ?? [slot];
}

/**
 * Greedy best-possible lineup from a roster's actual points that week:
 * highest scorer first, placed into the first slot they're eligible for -
 * preferring a dedicated position slot over a FLEX before falling back to
 * FLEX, so a flex spot isn't wasted on someone who also has their own
 * slot open. This is the same greedy approximation the fantasy industry
 * (FantasyPros and others) uses for "lineup efficiency" - not a formally
 * proven optimum in every adversarial edge case, but correct in the
 * overwhelming majority, and far simpler than a full assignment solver for
 * what's meant to be a rough all-time accuracy number.
 */
export function optimalLineupPoints(
  rosterPlayerIds: string[],
  pointsById: Record<string, number>,
  posById: Record<string, string | undefined>,
  slots: string[]
): number {
  const openSlots = [...slots];
  const sorted = [...rosterPlayerIds].sort((a, b) => (pointsById[b] ?? 0) - (pointsById[a] ?? 0));
  let total = 0;

  for (const playerId of sorted) {
    const pos = posById[playerId];
    if (!pos) continue;
    let slotIndex = openSlots.findIndex((s) => {
      const elig = slotEligibility(s);
      return elig.length === 1 && elig[0] === pos;
    });
    if (slotIndex === -1) {
      slotIndex = openSlots.findIndex((s) => slotEligibility(s).includes(pos));
    }
    if (slotIndex === -1) continue;
    openSlots.splice(slotIndex, 1);
    total += pointsById[playerId] ?? 0;
  }
  return total;
}

export interface StartSitAccuracy {
  actualPoints: number;
  optimalPoints: number;
  /** actualPoints / optimalPoints, 0-1 */
  accuracy: number;
  weeksAnalyzed: number;
}
