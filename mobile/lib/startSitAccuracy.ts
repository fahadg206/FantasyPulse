import { backend } from "./api";

// All-time lineup efficiency: across every week of every league a manager
// has ever played, how much of the points they could have scored (their
// best possible lineup from their full roster that week) did they
// actually start? Same season-enumeration approach as
// profileActivity.ts's getCareerStats, for the same reason - a league the
// manager has since left still counts, not just their current leagues.

const SLEEPER = "https://api.sleeper.app/v1";
const EARLIEST_SLEEPER_SEASON = 2017;
const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);

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

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
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
function optimalLineupPoints(
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

export async function getStartSitAccuracy(sleeperUserId: string, currentSeason: string): Promise<StartSitAccuracy> {
  const endYear = parseInt(currentSeason, 10) || new Date().getFullYear();
  const seasons = Array.from(
    { length: Math.max(0, endYear - EARLIEST_SLEEPER_SEASON + 1) },
    (_, i) => String(EARLIEST_SLEEPER_SEASON + i)
  );

  const seasonLeagueLists = await Promise.all(
    seasons.map((season) => fetchJson(`${SLEEPER}/user/${sleeperUserId}/leagues/nfl/${season}`).catch(() => []))
  );
  const leagueIds = Array.from(
    new Set(seasonLeagueLists.flat().map((l: any) => l.league_id as string).filter(Boolean))
  );

  if (leagueIds.length === 0) {
    return { actualPoints: 0, optimalPoints: 0, accuracy: 0, weeksAnalyzed: 0 };
  }

  let actualPoints = 0;
  let optimalPoints = 0;
  let weeksAnalyzed = 0;
  // Player position lookup is global, not per-league - fetched once and
  // shared across every league processed below (a race where more than
  // one league fetches it before the first finishes just means a couple
  // of redundant fetches, never a correctness problem).
  let posById: Record<string, string | undefined> | null = null;

  await Promise.all(
    leagueIds.map(async (leagueId) => {
      try {
        const [leagueInfo, rosters] = await Promise.all([
          fetchJson(`${SLEEPER}/league/${leagueId}`),
          fetchJson(`${SLEEPER}/league/${leagueId}/rosters`),
        ]);
        const myRoster = rosters.find((r: any) => r.owner_id === sleeperUserId);
        if (!myRoster) return;

        const slots: string[] = (leagueInfo.roster_positions || []).filter(
          (p: string) => !NON_STARTER_SLOTS.has(p)
        );
        if (slots.length === 0) return;

        if (!posById) {
          const playersData = await backend.fetchPlayers(leagueId).catch(() => ({}));
          const map: Record<string, string | undefined> = {};
          for (const pid in playersData) map[pid] = (playersData as any)[pid]?.pos;
          posById = map;
        }

        const weeksCount = Math.max(1, (leagueInfo.settings?.playoff_week_start ?? 15) - 1);
        const weeks = Array.from({ length: weeksCount }, (_, i) => i + 1);
        const weekResults = await Promise.all(
          weeks.map((w) => fetchJson(`${SLEEPER}/league/${leagueId}/matchups/${w}`).catch(() => []))
        );

        for (const matchups of weekResults) {
          const mine = (matchups as any[]).find((m) => m.roster_id === myRoster.roster_id);
          if (!mine?.starters || !mine?.players_points || !mine?.players) continue;

          const starters: string[] = mine.starters.filter((id: string) => id && id !== "0");
          const rosterIds: string[] = mine.players;
          if (starters.length === 0 || rosterIds.length === 0) continue;

          // Skip weeks nobody's actually played yet (future weeks, or a
          // bye before the season starts) - every player reading 0 is the
          // giveaway, not "week < current" (that's exactly the premature-
          // final heuristic already fixed elsewhere in this app).
          const pointsById: Record<string, number> = mine.players_points;
          const weekHasRealScoring = Object.values(pointsById).some((p) => (p as number) !== 0);
          if (!weekHasRealScoring) continue;

          const actual = starters.reduce((sum, id) => sum + (pointsById[id] ?? 0), 0);
          const optimal = optimalLineupPoints(rosterIds, pointsById, posById!, slots);

          actualPoints += actual;
          // optimalLineupPoints can't score lower than the actual lineup
          // by construction, but guards against float noise making it
          // look that way.
          optimalPoints += Math.max(optimal, actual);
          weeksAnalyzed += 1;
        }
      } catch (error) {
        console.error(`Error computing start/sit accuracy for league ${leagueId}:`, error);
      }
    })
  );

  return {
    actualPoints,
    optimalPoints,
    accuracy: optimalPoints > 0 ? actualPoints / optimalPoints : 0,
    weeksAnalyzed,
  };
}
