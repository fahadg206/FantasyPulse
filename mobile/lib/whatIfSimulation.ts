// Shared Monte Carlo simulation used by both the Standings page's baseline
// playoff-odds column and the What-If modal's scenario explorer. Keeping
// this in one place means both always agree on tiebreakers and playoff
// format instead of drifting into two slightly different implementations.
//
// Tiebreaker: Sleeper's own standings page (and most fantasy platforms)
// break ties in wins by total points-for - the public league API doesn't
// expose a more granular custom tiebreaker config than that, so wins then
// points-for is what's modeled here.
//
// Playoff format: when a league has divisions, each division's leader gets
// an automatic bid (the standard format division-based leagues use), and
// the remaining spots go to the next-best teams overall by the same
// wins-then-points-for order. Leagues without divisions just take the top
// `playoffSpots` teams overall.

export type Outcome = "win" | "loss";
export type Overrides = Record<number, Record<string, Outcome>>;

export interface TeamSeedData {
  wins?: string;
  losses?: string;
  team_points_for?: string;
  team_points_for_dec?: string;
  division?: number;
}

export interface WeekGame {
  a: string;
  b: string;
  played: boolean;
  scoreA?: number;
  scoreB?: number;
}

export function basePointsFor(team: TeamSeedData): number {
  return (
    (parseFloat(team.team_points_for || "0") || 0) +
    (parseFloat(team.team_points_for_dec || "0") || 0) / 100
  );
}

// Pairs up every team into its week's matchup exactly once. A "played" game
// carries its real final score; an unplayed one carries none (the caller
// simulates or uses a supplied projection for it instead).
export function getWeekGames(
  week: number,
  matchupData: Record<number, any>,
  teamIds: string[]
): WeekGame[] {
  const games: WeekGame[] = [];
  const seen = new Set<string>();
  for (const id of teamIds) {
    if (seen.has(id)) continue;
    const me = matchupData[week]?.[id];
    const oppId = me?.opponent_id;
    if (!oppId || seen.has(oppId)) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    seen.add(oppId);
    const scoreA = parseFloat(me?.team_points || "0");
    const scoreB = parseFloat(matchupData[week]?.[oppId]?.team_points || "0");
    const played = scoreA > 0 || scoreB > 0;
    games.push({ a: id, b: oppId, played, scoreA: played ? scoreA : undefined, scoreB: played ? scoreB : undefined });
  }
  return games;
}

// Typical week-to-week fantasy scoring variance modeled as a +/-30% swing
// off the projection - crude, but far more informative than a coin flip,
// and it's what lets a Monte Carlo run produce a believable points-for
// tiebreaker instead of just a win/loss coin flip with no point total.
function simulateScore(projection: number): number {
  const variance = 0.3;
  const factor = 1 + (Math.random() * 2 - 1) * variance;
  return Math.max(0, projection * factor);
}

export function rankTeams(teamIds: string[], wins: Record<string, number>, pointsFor: Record<string, number>): string[] {
  return [...teamIds].sort((a, b) => wins[b] - wins[a] || pointsFor[b] - pointsFor[a]);
}

export function determinePlayoffTeams(
  ranked: string[],
  managerInfo: Record<string, TeamSeedData>,
  divisionsCount: number,
  playoffSpots: number
): { qualifiers: string[]; divisionWinners: Record<number, string> } {
  if (divisionsCount <= 1) {
    return { qualifiers: ranked.slice(0, playoffSpots), divisionWinners: {} };
  }
  const divisionWinners: Record<number, string> = {};
  const winnerIds = new Set<string>();
  for (let d = 1; d <= divisionsCount; d++) {
    const winner = ranked.find((id) => managerInfo[id].division === d);
    if (winner) {
      divisionWinners[d] = winner;
      winnerIds.add(winner);
    }
  }
  const remainingSpots = Math.max(0, playoffSpots - winnerIds.size);
  const wildcards = ranked.filter((id) => !winnerIds.has(id)).slice(0, remainingSpots);
  const seededWinners = Object.values(divisionWinners).sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return { qualifiers: [...seededWinners, ...wildcards], divisionWinners };
}

// Runs one simulated remainder-of-season: baseline wins/points already
// reflect games that have been played, so only unplayed weeks contribute
// randomness (or a forced result from `overrides`).
function simulateOneIteration(
  teamIds: string[],
  managerInfo: Record<string, TeamSeedData>,
  matchupData: Record<number, any>,
  projectionCache: Record<number, Record<string, number>>,
  playoffStartWeek: number,
  overrides: Overrides
): { wins: Record<string, number>; pointsFor: Record<string, number> } {
  const wins: Record<string, number> = {};
  const pointsFor: Record<string, number> = {};
  teamIds.forEach((id) => {
    wins[id] = parseInt(managerInfo[id].wins || "0");
    pointsFor[id] = basePointsFor(managerInfo[id]);
  });

  for (let week = 1; week < playoffStartWeek; week++) {
    const games = getWeekGames(week, matchupData, teamIds);
    for (const g of games) {
      if (g.played) continue; // already counted in baseline wins/points

      const projA = projectionCache[week]?.[g.a] ?? 0;
      const projB = projectionCache[week]?.[g.b] ?? 0;
      const forcedA = overrides[week]?.[g.a];
      const forcedB = overrides[week]?.[g.b];

      let scoreA = simulateScore(projA);
      let scoreB = simulateScore(projB);
      const forceAWin = forcedA === "win" || forcedB === "loss";
      const forceBWin = forcedA === "loss" || forcedB === "win";
      if (forceAWin && scoreA <= scoreB) scoreA = scoreB + 0.1;
      if (forceBWin && scoreB <= scoreA) scoreB = scoreA + 0.1;

      if (scoreA > scoreB) wins[g.a] += 1;
      else wins[g.b] += 1;
      pointsFor[g.a] += scoreA;
      pointsFor[g.b] += scoreB;
    }
  }

  return { wins, pointsFor };
}

export interface SimResult {
  playoffOdds: Record<string, number>;
  divisionOdds: Record<string, number>;
  avgPointsFor: Record<string, number>;
}

export function runMonteCarlo(
  teamIds: string[],
  managerInfo: Record<string, TeamSeedData>,
  matchupData: Record<number, any>,
  projectionCache: Record<number, Record<string, number>>,
  playoffStartWeek: number,
  playoffSpots: number,
  divisionsCount: number,
  overrides: Overrides,
  iterations: number
): SimResult {
  const playoffCount: Record<string, number> = {};
  const divisionCount: Record<string, number> = {};
  const pointsTotal: Record<string, number> = {};
  teamIds.forEach((id) => {
    playoffCount[id] = 0;
    divisionCount[id] = 0;
    pointsTotal[id] = 0;
  });

  for (let i = 0; i < iterations; i++) {
    const { wins, pointsFor } = simulateOneIteration(
      teamIds,
      managerInfo,
      matchupData,
      projectionCache,
      playoffStartWeek,
      overrides
    );
    const ranked = rankTeams(teamIds, wins, pointsFor);
    const { qualifiers, divisionWinners } = determinePlayoffTeams(ranked, managerInfo, divisionsCount, playoffSpots);
    qualifiers.forEach((id) => (playoffCount[id] += 1));
    Object.values(divisionWinners).forEach((id) => (divisionCount[id] += 1));
    teamIds.forEach((id) => (pointsTotal[id] += pointsFor[id]));
  }

  const playoffOdds: Record<string, number> = {};
  const divisionOdds: Record<string, number> = {};
  const avgPointsFor: Record<string, number> = {};
  teamIds.forEach((id) => {
    playoffOdds[id] = (playoffCount[id] / iterations) * 100;
    divisionOdds[id] = (divisionCount[id] / iterations) * 100;
    avgPointsFor[id] = pointsTotal[id] / iterations;
  });
  return { playoffOdds, divisionOdds, avgPointsFor };
}

export interface ProjectedTeamRow {
  userId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  madePlayoffs: boolean;
  isDivisionLeader: boolean;
}

// A single deterministic pass (no randomness) instead of a Monte Carlo run
// - every undecided game resolves to whichever side has the higher
// projection unless the caller has forced a result for it. This is what
// powers the "live standings" preview: it needs to recompute instantly on
// every toggle tap, not run hundreds of simulated iterations.
export function projectStandings(
  teamIds: string[],
  managerInfo: Record<string, TeamSeedData>,
  matchupData: Record<number, any>,
  projectionCache: Record<number, Record<string, number>>,
  playoffStartWeek: number,
  overrides: Overrides,
  divisionsCount: number,
  playoffSpots: number
): ProjectedTeamRow[] {
  const wins: Record<string, number> = {};
  const losses: Record<string, number> = {};
  const pointsFor: Record<string, number> = {};
  teamIds.forEach((id) => {
    wins[id] = parseInt(managerInfo[id].wins || "0");
    losses[id] = parseInt(managerInfo[id].losses || "0");
    pointsFor[id] = basePointsFor(managerInfo[id]);
  });

  for (let week = 1; week < playoffStartWeek; week++) {
    const games = getWeekGames(week, matchupData, teamIds);
    for (const g of games) {
      if (g.played) continue;
      const projA = projectionCache[week]?.[g.a] ?? 0;
      const projB = projectionCache[week]?.[g.b] ?? 0;
      const forcedA = overrides[week]?.[g.a];
      const forcedB = overrides[week]?.[g.b];
      let aWins: boolean;
      if (forcedA === "win" || forcedB === "loss") aWins = true;
      else if (forcedA === "loss" || forcedB === "win") aWins = false;
      else aWins = projA >= projB;

      if (aWins) {
        wins[g.a] += 1;
        losses[g.b] += 1;
      } else {
        wins[g.b] += 1;
        losses[g.a] += 1;
      }
      pointsFor[g.a] += projA;
      pointsFor[g.b] += projB;
    }
  }

  const ranked = rankTeams(teamIds, wins, pointsFor);
  const { qualifiers, divisionWinners } = determinePlayoffTeams(ranked, managerInfo, divisionsCount, playoffSpots);
  const qualifierSet = new Set(qualifiers);
  const leaderSet = new Set(Object.values(divisionWinners));

  return ranked.map((userId) => ({
    userId,
    wins: wins[userId],
    losses: losses[userId],
    pointsFor: pointsFor[userId],
    madePlayoffs: qualifierSet.has(userId),
    isDivisionLeader: leaderSet.has(userId),
  }));
}
