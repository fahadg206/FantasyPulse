// Real multi-source start/sit consensus - two real, live, verified expert
// sources (Sleeper's own weekly projections, already the projection
// engine behind every other part of this app, and ESPN's public fantasy
// rankings feed, cross-referenced player-by-player via Sleeper's own
// espn_id field, no fuzzy name matching), each turned into a real
// positional rank, averaged into one consensus number - same idea a real
// "expert consensus rankings" page uses, just built from sources this app
// can actually verify rather than guessed at. FantasyPros and RotoBaller
// both gate this exact data behind a paid/approved API this app doesn't
// have access to - deliberately not scraped around.

import { getAllPlayersData } from "./playerBio";
import { getEspnWeeklyData, normalizePlayerName } from "./espnFantasy";
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
  /** average of every source's positional rank for this player - null when no source has data for them (e.g. a player neither feed considers relevant this week) */
  consensusRank: number | null;
  /** ESPN's own real written take for this player this week, when they've published one */
  outlook?: string;
  /** real KTC dynasty asset value, dynasty leagues only - shown as context, not folded into the start/sit consensus (it measures long-term value, not this week's matchup) */
  dynastyValue?: number;
  /** the starting slot this player landed in the recommended lineup, if any - undefined means the board has them on the bench */
  recommendedSlot?: string;
}

export interface StartSitBoard {
  lineup: LineupSlotAssignment[];
  players: StartSitPlayer[];
}

export async function buildStartSitBoard(params: {
  rosterPlayerIds: string[];
  startingSlots: string[];
  week: number;
  season: string;
  /** from backend.fetchPlayers(leagueId) - fn/ln/pos/t/wi for every player relevant to this league */
  playersData: Record<string, any>;
  isDynasty: boolean;
  valuesBySleeperId?: Record<string, RawPlayerValue>;
  leagueValueSettings?: LeagueValueSettings;
}): Promise<StartSitBoard> {
  const { rosterPlayerIds, startingSlots, week, season, playersData, isDynasty, valuesBySleeperId, leagueValueSettings } = params;

  const [allPlayers, espnIndex] = await Promise.all([
    getAllPlayersData().catch(() => ({}) as Record<string, { espn_id?: number }>),
    getEspnWeeklyData(season, week).catch(() => ({ byId: new Map(), byName: new Map() })),
  ]);

  // Sleeper's own positional rank - the same real weekly projection this
  // app already uses everywhere else, ranked against every real player at
  // that position leaguewide (not just this one roster), so "rank 4 at
  // RB" means the same thing here as it would anywhere else in the app.
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

  const posById: Record<string, string | undefined> = {};
  const pointsById: Record<string, number> = {};
  for (const pid of rosterPlayerIds) {
    posById[pid] = playersData[pid]?.pos;
    pointsById[pid] = projByPlayer[pid] ?? 0;
  }
  const lineup = computeOptimalLineupAssignment(rosterPlayerIds, pointsById, posById, startingSlots);
  const slotByPlayerId = new Map<string, string>();
  for (const a of lineup) if (a.playerId) slotByPlayerId.set(a.playerId, a.slot);

  const players: StartSitPlayer[] = rosterPlayerIds.map((pid) => {
    const p = playersData[pid];
    const name = `${p?.fn ?? ""} ${p?.ln ?? ""}`.trim() || pid;
    const pos = p?.pos ?? "";
    const team = p?.t;

    const sources: RankSource[] = [];
    if (sleeperRankByPlayer[pid] !== undefined) sources.push({ label: "Sleeper", rank: sleeperRankByPlayer[pid] });

    // Sleeper's own espn_id cross-reference is the fast, exact path, but
    // it's genuinely missing for plenty of current relevant players
    // (confirmed live) - falling back to a normalized name match against
    // the same ESPN response is what actually gets real coverage.
    const espnId = allPlayers[pid]?.espn_id;
    const espnEntry = (espnId !== undefined ? espnIndex.byId.get(espnId) : undefined) ?? espnIndex.byName.get(normalizePlayerName(name));
    if (espnEntry?.rank !== undefined) sources.push({ label: "ESPN", rank: espnEntry.rank });

    const consensusRank =
      sources.length > 0 ? Math.round((sources.reduce((s, r) => s + r.rank, 0) / sources.length) * 10) / 10 : null;

    let dynastyValue: number | undefined;
    if (isDynasty && valuesBySleeperId && leagueValueSettings) {
      const raw = valuesBySleeperId[pid];
      if (raw) dynastyValue = computeAdjustedValue(raw, leagueValueSettings);
    }

    return {
      playerId: pid,
      name,
      pos,
      team,
      projectedPoints: pointsById[pid],
      sources,
      consensusRank,
      outlook: espnEntry?.outlook,
      dynastyValue,
      recommendedSlot: slotByPlayerId.get(pid),
    };
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
