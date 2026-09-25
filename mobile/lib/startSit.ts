// Real multi-source start/sit consensus - four real, live, verified
// sources, each turned into a real positional rank and averaged into one
// consensus number, the same idea a real "expert consensus rankings" page
// uses, just built entirely from sources this app can actually verify
// rather than guessed at:
//   - Sleeper: this app's own real weekly projections, ranked leaguewide
//   - ESPN: ESPN's public fantasy rankings feed (espn_id, with a
//     normalized-name fallback for the players Sleeper doesn't cross-link)
//   - KTC: this app's own real KeepTradeCut market values (the same data
//     that powers Power Rankings and the Trade Calculator), ranked by
//     position - dynasty leagues only, where a trade-value market means
//     something
//   - FantasyCalc: FantasyCalc's own public values API, keyed directly by
//     Sleeper ID (no fuzzy matching needed) and pulled in the league's own
//     format (dynasty/redraft, 1QB/superflex) - works for every league
// FantasyPros and RotoBaller both gate this exact kind of data behind a
// paid/approved API this app doesn't have access to - deliberately not
// scraped around.

import { getAllPlayersData } from "./playerBio";
import { getEspnWeeklyData, normalizePlayerName } from "./espnFantasy";
import { getFantasyCalcIndex } from "./fantasyCalc";
import { computeOptimalLineupAssignment, LineupSlotAssignment } from "./tradeAnalysis";
import { computeAdjustedValue, RawPlayerValue, LeagueValueSettings } from "./playerValue";

export interface RankSource {
  label: string;
  rank: number;
}

export interface StartSitPlayer {
  playerId: string;
  name: string;
  pos: string;
  team?: string;
  /** Sleeper's own real weekly projection - what actually drives the recommended lineup below */
  projectedPoints: number;
  sources: RankSource[];
  /** average of every source's positional rank for this player - null when no source has data for them (e.g. a player none of the feeds consider relevant this week) */
  consensusRank: number | null;
  /** ESPN's own real written take for this player this week, when they've published one */
  outlook?: string;
  /** real KTC dynasty asset value, dynasty leagues only - shown as context alongside (not instead of) the KTC rank source below */
  dynastyValue?: number;
  /** the starting slot this player landed in the recommended lineup, if any - undefined means the board has them on the bench. Never set for the arbitrary-player comparison path, since there's no roster/lineup to place them into. */
  recommendedSlot?: string;
}

export interface StartSitBoard {
  lineup: LineupSlotAssignment[];
  players: StartSitPlayer[];
}

interface ScoringContext {
  week: number;
  season: string;
  playersData: Record<string, any>;
  leagueValueSettings: LeagueValueSettings;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
}

interface ScoringIndex {
  sleeperRankByPlayer: Record<string, number>;
  projByPlayer: Record<string, number>;
  espnAllPlayers: Record<string, { espn_id?: number }>;
  espnIndex: Awaited<ReturnType<typeof getEspnWeeklyData>>;
  ktcRankByPlayer: Record<string, number>;
  fantasyCalcIndex: Map<string, { positionRank: number }>;
}

async function buildScoringIndex(ctx: ScoringContext): Promise<ScoringIndex> {
  const { week, season, playersData, leagueValueSettings, valuesBySleeperId } = ctx;

  const [espnAllPlayers, espnIndex, fantasyCalcIndex] = await Promise.all([
    getAllPlayersData().catch(() => ({}) as Record<string, { espn_id?: number }>),
    getEspnWeeklyData(season, week).catch(() => ({ byId: new Map(), byName: new Map() })),
    getFantasyCalcIndex(leagueValueSettings.isDynasty, leagueValueSettings.isSuperflex).catch(() => new Map()),
  ]);

  // Sleeper's own positional rank - the same real weekly projection this
  // app already uses everywhere else, ranked against every real player at
  // that position leaguewide (not just one roster), so "rank 4 at RB"
  // means the same thing here as anywhere else in the app.
  const projByPlayer: Record<string, number> = {};
  const posGroups: Record<string, string[]> = {};
  for (const pid in playersData) {
    const p = playersData[pid];
    projByPlayer[pid] = parseFloat(p?.wi?.[String(week)]?.p || "0");
    if (!p?.pos) continue;
    (posGroups[p.pos] ??= []).push(pid);
  }
  const sleeperRankByPlayer: Record<string, number> = {};
  for (const pos in posGroups) {
    const sorted = [...posGroups[pos]].sort((a, b) => projByPlayer[b] - projByPlayer[a]);
    sorted.forEach((pid, i) => {
      sleeperRankByPlayer[pid] = i + 1;
    });
  }

  // KTC's own real market value, ranked by position across every player
  // this app has a value for (not just one roster) - the same real crawl
  // that already powers Power Rankings and the Trade Calculator, just
  // turned into a rank instead of a raw number.
  const ktcRankByPlayer: Record<string, number> = {};
  if (valuesBySleeperId) {
    const ktcGroups: Record<string, { pid: string; value: number }[]> = {};
    for (const pid in valuesBySleeperId) {
      const raw = valuesBySleeperId[pid];
      const pos = raw?.Position;
      if (!pos) continue;
      const value = computeAdjustedValue(raw, leagueValueSettings);
      if (!value) continue;
      (ktcGroups[pos] ??= []).push({ pid, value });
    }
    for (const pos in ktcGroups) {
      ktcGroups[pos]
        .sort((a, b) => b.value - a.value)
        .forEach((entry, i) => {
          ktcRankByPlayer[entry.pid] = i + 1;
        });
    }
  }

  return { sleeperRankByPlayer, projByPlayer, espnAllPlayers, espnIndex, ktcRankByPlayer, fantasyCalcIndex };
}

function scorePlayer(pid: string, playersData: Record<string, any>, idx: ScoringIndex, isDynasty: boolean): StartSitPlayer {
  const p = playersData[pid];
  const name = `${p?.fn ?? ""} ${p?.ln ?? ""}`.trim() || pid;
  const pos = p?.pos ?? "";
  const team = p?.t;

  const sources: RankSource[] = [];
  if (idx.sleeperRankByPlayer[pid] !== undefined) sources.push({ label: "Sleeper", rank: idx.sleeperRankByPlayer[pid] });

  // Sleeper's own espn_id cross-reference is the fast, exact path, but
  // it's genuinely missing for plenty of current relevant players
  // (confirmed live) - falling back to a normalized name match against
  // the same ESPN response is what actually gets real coverage.
  const espnId = idx.espnAllPlayers[pid]?.espn_id;
  const espnEntry = (espnId !== undefined ? idx.espnIndex.byId.get(espnId) : undefined) ?? idx.espnIndex.byName.get(normalizePlayerName(name));
  if (espnEntry?.rank !== undefined) sources.push({ label: "ESPN", rank: espnEntry.rank });

  // KTC - dynasty leagues only, where a trade-value market actually means something.
  if (isDynasty && idx.ktcRankByPlayer[pid] !== undefined) {
    sources.push({ label: "KTC", rank: idx.ktcRankByPlayer[pid] });
  }

  // FantasyCalc - keyed directly by Sleeper ID, works for both formats.
  const fcEntry = idx.fantasyCalcIndex.get(pid);
  if (fcEntry) sources.push({ label: "FantasyCalc", rank: fcEntry.positionRank });

  const consensusRank =
    sources.length > 0 ? Math.round((sources.reduce((s, r) => s + r.rank, 0) / sources.length) * 10) / 10 : null;

  return {
    playerId: pid,
    name,
    pos,
    team,
    projectedPoints: idx.projByPlayer[pid] ?? 0,
    sources,
    consensusRank,
    outlook: espnEntry?.outlook,
  };
}

export async function buildStartSitBoard(params: {
  rosterPlayerIds: string[];
  startingSlots: string[];
  week: number;
  season: string;
  /** from backend.fetchPlayers(leagueId) - fn/ln/pos/t/wi for every fantasy-relevant player in the NFL, not just this roster */
  playersData: Record<string, any>;
  isDynasty: boolean;
  leagueValueSettings: LeagueValueSettings;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
}): Promise<StartSitBoard> {
  const { rosterPlayerIds, startingSlots, week, season, playersData, isDynasty, leagueValueSettings, valuesBySleeperId } = params;

  const idx = await buildScoringIndex({ week, season, playersData, leagueValueSettings, valuesBySleeperId });

  const posById: Record<string, string | undefined> = {};
  const pointsById: Record<string, number> = {};
  for (const pid of rosterPlayerIds) {
    posById[pid] = playersData[pid]?.pos;
    pointsById[pid] = idx.projByPlayer[pid] ?? 0;
  }
  const lineup = computeOptimalLineupAssignment(rosterPlayerIds, pointsById, posById, startingSlots);
  const slotByPlayerId = new Map<string, string>();
  for (const a of lineup) if (a.playerId) slotByPlayerId.set(a.playerId, a.slot);

  const players: StartSitPlayer[] = rosterPlayerIds.map((pid) => {
    const scored = scorePlayer(pid, playersData, idx, isDynasty);
    let dynastyValue: number | undefined;
    if (isDynasty && valuesBySleeperId && leagueValueSettings) {
      const raw = valuesBySleeperId[pid];
      if (raw) dynastyValue = computeAdjustedValue(raw, leagueValueSettings);
    }
    return { ...scored, dynastyValue, recommendedSlot: slotByPlayerId.get(pid) };
  });

  // Starters (in their assigned slot's order) first, then the bench sorted
  // by real projection - the same "who's closest to breaking in" read a
  // manager actually wants from a bench list.
  const slotOrder = new Map(startingSlots.map((s, i) => [s, i]));
  players.sort((a, b) => {
    const aStart = a.recommendedSlot !== undefined;
    const bStart = b.recommendedSlot !== undefined;
    if (aStart !== bStart) return aStart ? -1 : 1;
    if (aStart && bStart) {
      const orderDiff = (slotOrder.get(a.recommendedSlot!) ?? 0) - (slotOrder.get(b.recommendedSlot!) ?? 0);
      if (orderDiff !== 0) return orderDiff;
    }
    return b.projectedPoints - a.projectedPoints;
  });

  return { lineup, players };
}

/**
 * The same real multi-source scoring, for any players at all - not scoped
 * to one roster or one lineup. Powers the "compare any two players" picker:
 * pick anyone in the league, real or hypothetical matchup, and see the same
 * Sleeper/ESPN/KTC/FantasyCalc breakdown side by side.
 */
export async function scoreArbitraryPlayers(params: {
  playerIds: string[];
  week: number;
  season: string;
  playersData: Record<string, any>;
  isDynasty: boolean;
  leagueValueSettings: LeagueValueSettings;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
}): Promise<StartSitPlayer[]> {
  const { playerIds, week, season, playersData, isDynasty, leagueValueSettings, valuesBySleeperId } = params;
  const idx = await buildScoringIndex({ week, season, playersData, leagueValueSettings, valuesBySleeperId });

  return playerIds.map((pid) => {
    const scored = scorePlayer(pid, playersData, idx, isDynasty);
    let dynastyValue: number | undefined;
    if (isDynasty && valuesBySleeperId) {
      const raw = valuesBySleeperId[pid];
      if (raw) dynastyValue = computeAdjustedValue(raw, leagueValueSettings);
    }
    return { ...scored, dynastyValue };
  });
}
