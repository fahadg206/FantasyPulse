// Draft picks as real, valued trade assets - not just the plain-text
// "2027 Rd 2 Pick" labels the trade-history crawler already shows.
//
// Two things happen here:
//   1. Real pick INVENTORY: who currently owns which future picks. Sleeper's
//      `/traded_picks` endpoint only lists picks that have moved - a pick
//      nobody has ever traded away isn't in that list at all - so the full
//      board is "every roster's own picks for the next few draft classes,
//      overridden by whichever of those a real trade has since reassigned."
//   2. Real pick VALUE: KTC prices future 1sts/2nds/3rds/4ths as "Early/
//      Mid/Late" per year (e.g. "2027 Mid 2nd"), not one flat number per
//      round - a 1st from a team about to finish last is worth far more
//      than a 1st from the reigning champs. The tier for the SOONEST draft
//      class is real, off this league's own projected final standings
//      (lib/whatIfSimulation.ts's projectStandings - the same engine the
//      Standings page's playoff odds and What-If modal already trust).
//      Classes further out than that aren't knowable this far ahead, so
//      they default to "Mid" (the neutral, no-information assumption)
//      rather than pretending a 2-3-year-out projection means anything.
import { sleeper, backend } from "./api";
import { projectStandings, TeamSeedData, ProjectedTeamRow } from "./whatIfSimulation";
import type { LeagueSimData } from "./leagueSimData";
import { getLeagueValueSettings, computeAdjustedValue, LeagueValueSettings, RawPlayerValue } from "./playerValue";

export type PickTier = "Early" | "Mid" | "Late";

export interface TradeablePick {
  id: string;
  season: string;
  round: number;
  /** the roster this pick was originally slotted to - its real-team finish is what prices it */
  originalRosterId: number;
  originalUserId: string;
  originalTeamName: string;
  /** who actually controls it right now, after real trades */
  currentOwnerUserId: string;
  tier: PickTier;
  /** true only for the soonest draft class, where the tier is a real projection and not a neutral guess */
  tierIsProjected: boolean;
  label: string; // "2027 Mid 2nd"
  value: number;
}

interface TradedPickRaw {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
function ordinal(round: number): string {
  return ORDINALS[round] || `${round}th`;
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tierForRank(rankWorstFirst: number, totalTeams: number): PickTier {
  const third = Math.ceil(totalTeams / 3);
  if (rankWorstFirst < third) return "Early";
  if (rankWorstFirst < third * 2) return "Mid";
  return "Late";
}

// How many upcoming draft classes to generate picks for - matches exactly
// what KTC prices (checked live: it publishes Early/Mid/Late 1st-4th for
// the next 3 classes and nothing beyond that).
const DRAFT_CLASSES_AHEAD = 3;

export interface DraftPickBoard {
  picks: TradeablePick[];
  roundsInDraft: number;
}

/**
 * Builds this league's full tradeable-pick board: every roster's own picks
 * for the next few rookie draft classes, reassigned per real trade history,
 * tiered off real projected standings where that's knowable, and priced off
 * real KTC values. `simData` is optional - pass it once it's loaded (Trade
 * Calculator already builds it for win-impact) so the soonest class's tiers
 * are the real projection instead of every pick defaulting to "Mid".
 */
export async function getLeagueDraftPickBoard(
  leagueId: string,
  simData?: LeagueSimData | null
): Promise<DraftPickBoard> {
  const [{ data: league }, { data: rosters }, { data: users }, tradedPicksRes, draftsRes, valueSettings, pickValues] =
    await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getLeagueRosters(leagueId),
      sleeper.getLeagueUsers(leagueId),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then((r) => r.json()),
      getLeagueValueSettings(leagueId),
      backend.fetchDraftPickValues(),
    ]);

  const roundsInDraft: number =
    (Array.isArray(draftsRes) && draftsRes[0]?.settings?.rounds) || 4;

  const rosterOwner: Record<number, string> = {};
  const rosterName: Record<number, string> = {};
  (rosters as any[]).forEach((r: any) => {
    rosterOwner[r.roster_id] = r.owner_id;
    const user = (users as any[]).find((u) => u.user_id === r.owner_id);
    rosterName[r.roster_id] = user?.display_name || "Unknown";
  });
  const rosterIds = (rosters as any[]).map((r: any) => r.roster_id);

  const currentSeason = Number(league.season);
  const draftClasses = Array.from({ length: DRAFT_CLASSES_AHEAD }, (_, i) => String(currentSeason + 1 + i));
  const nextClass = draftClasses[0];

  const tradedPicks: TradedPickRaw[] = Array.isArray(tradedPicksRes) ? tradedPicksRes : [];
  const ownerOverride = new Map<string, number>(); // `${season}-${round}-${originalRosterId}` -> current owner roster_id
  for (const p of tradedPicks) {
    ownerOverride.set(`${p.season}-${p.round}-${p.roster_id}`, p.owner_id);
  }

  // Real projected order, worst record first - matches how a rookie draft
  // actually seeds (the team most likely to finish worst picks earliest).
  let orderWorstFirst: string[] = [];
  if (simData) {
    const seedData: Record<string, TeamSeedData> = {};
    for (const id of simData.teamIds) seedData[id] = simData.managerInfo[id];
    const projected: ProjectedTeamRow[] = projectStandings(
      simData.teamIds,
      seedData,
      simData.matchupData,
      simData.projectionCache,
      simData.playoffStartWeek,
      {},
      simData.divisionsCount,
      simData.playoffSpots
    );
    orderWorstFirst = [...projected].sort((a, b) => a.wins - b.wins || a.pointsFor - b.pointsFor).map((p) => p.userId);
  }
  const rankByUserId = new Map(orderWorstFirst.map((id, i) => [id, i]));

  const picks: TradeablePick[] = [];
  for (const season of draftClasses) {
    for (let round = 1; round <= roundsInDraft; round++) {
      for (const originalRosterId of rosterIds) {
        const originalUserId = rosterOwner[originalRosterId];
        const overrideOwnerRosterId = ownerOverride.get(`${season}-${round}-${originalRosterId}`);
        const currentOwnerUserId = overrideOwnerRosterId ? rosterOwner[overrideOwnerRosterId] ?? originalUserId : originalUserId;

        let tier: PickTier = "Mid";
        let tierIsProjected = false;
        if (season === nextClass && rankByUserId.has(originalUserId)) {
          tier = tierForRank(rankByUserId.get(originalUserId)!, orderWorstFirst.length);
          tierIsProjected = true;
        }

        const label = `${season} ${tier} ${ordinal(round)}`;
        const raw: RawPlayerValue | undefined = pickValues[normalizeKey(label)];
        const value = raw ? computeAdjustedValue({ ...raw, Position: "RDP" }, valueSettings) : 0;

        picks.push({
          id: `${season}-${round}-${originalRosterId}`,
          season,
          round,
          originalRosterId,
          originalUserId,
          originalTeamName: rosterName[originalRosterId],
          currentOwnerUserId,
          tier,
          tierIsProjected,
          label,
          value,
        });
      }
    }
  }

  return { picks, roundsInDraft };
}

export interface PickValueChartCell {
  season: string;
  tier: PickTier;
  round: number;
  label: string;
  value: number;
}

/**
 * The real KTC pick-value chart, independent of who owns what - every
 * (season, tier, round) combination KTC actually prices, adjusted for this
 * league's own format same as every other real value in the app. No
 * roster/ownership crawl needed (unlike getLeagueDraftPickBoard above), so
 * this is cheap: a standalone reference page, not a per-team board.
 */
export async function getPickValueChart(leagueId: string, roundsInDraft = 4): Promise<PickValueChartCell[]> {
  const [{ data: league }, valueSettings, pickValues] = await Promise.all([
    sleeper.getLeague(leagueId),
    getLeagueValueSettings(leagueId),
    backend.fetchDraftPickValues(),
  ]);

  const currentSeason = Number(league.season);
  const draftClasses = Array.from({ length: DRAFT_CLASSES_AHEAD }, (_, i) => String(currentSeason + 1 + i));
  const tiers: PickTier[] = ["Early", "Mid", "Late"];

  const cells: PickValueChartCell[] = [];
  for (const season of draftClasses) {
    for (const tier of tiers) {
      for (let round = 1; round <= roundsInDraft; round++) {
        const label = `${season} ${tier} ${ordinal(round)}`;
        const raw = pickValues[normalizeKey(label)];
        const value = raw ? computeAdjustedValue({ ...raw, Position: "RDP" }, valueSettings) : 0;
        cells.push({ season, tier, round, label, value });
      }
    }
  }
  return cells;
}
