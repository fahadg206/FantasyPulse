// src/lib/playoffSimulator.ts
//
// Monte Carlo playoff-odds simulator, ported from the approach Dynasty Daddy
// uses (github.com/G-Sher/dynasty-daddy,
// front-end/.../services/playoff-calculator.service.ts):
//
//   1. Convert every team's power rating into a percentile within the
//      league by taking its z-score and running that through the
//      cumulative standard normal distribution.
//   2. Turn any two teams' percentiles into a head-to-head win probability:
//        team1WinProb = 0.5 + (percentile1 - percentile2) / 2
//   3. Simulate the rest of the season and the playoff bracket thousands of
//      times, drawing a random number against that win probability for
//      every game, and tally how often each team makes the playoffs, wins
//      its division, earns a bye, reaches the semifinal round, reaches the
//      championship, and wins it.
//
// One deliberate change from Dynasty Daddy: instead of one static
// season-long power rating built from KeepTradeCut *dynasty* trade values
// (which only makes sense for dynasty leagues), each team's rating here is
// recomputed per week from that week's actual starters' point projections -
// the same projections already powering the rest of this app. That keeps
// ratings responsive to bye weeks/injuries and works for redraft leagues
// too, where a dynasty trade value would be meaningless. Because a team's
// weekly rating doesn't depend on simulated outcomes, percentiles are
// precomputed once per week up front rather than recomputed on every one
// of the thousands of simulated seasons.

export interface SimMatchup {
  team1RosterId: number;
  team2RosterId: number;
}

export interface SimDivision {
  id: number;
  rosterIds: number[];
}

export interface PlayoffOdds {
  makePlayoffs: number;
  winDivision: number;
  bye: number;
  makeConfRd: number;
  makeChampionship: number;
  winChampionship: number;
}

export interface PlayoffSimulatorInput {
  /** every roster id in the league */
  rosterIds: number[];
  /** wins/losses/points-for as of right now, keyed by roster id */
  currentRecord: Record<
    number,
    { wins: number; losses: number; pointsFor: number }
  >;
  /** matchups for each remaining regular-season week, in week order */
  remainingRegularSeasonWeeks: SimMatchup[][];
  /** NFL week numbers corresponding 1:1 to remainingRegularSeasonWeeks */
  remainingRegularSeasonWeekNumbers: number[];
  /**
   * Three week numbers representing the playoff round, conference round,
   * and championship round (in that order). A two-game round reuses the
   * same week's win probability for both games, matching Dynasty Daddy's
   * own implementation, so only one week number per round is needed.
   */
  playoffWeekNumbers: [number, number, number];
  /** power rating for a given roster at a given week (e.g. that week's
   * starters' summed point projection) - higher is better */
  getRating: (rosterId: number, week: number) => number;
  /** total teams that make the playoff bracket */
  playoffTeams: number;
  /** true if playoff rounds are best-of-two (aggregate), else single game */
  twoGameRounds?: boolean;
  /** divisions, if the league uses them - division winners get playoff/bye priority */
  divisions?: SimDivision[];
  numSimulations?: number;
}

const DEFAULT_NUM_SIMULATIONS = 10000;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Abramowitz & Stegun 7.1.26 approximation of the error function.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function cumulativeStdNormalProbability(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** win probability for team1 given both teams' league percentile for the week */
function matchupWinProbability(p1: number, p2: number): number {
  return clamp01(0.5 + (p1 - p2) / 2);
}

/** precompute each roster's league percentile for every week that'll be simulated */
function buildPercentilesByWeek(
  rosterIds: number[],
  weeks: number[],
  getRating: (rosterId: number, week: number) => number
): Record<number, Record<number, number>> {
  const byWeek: Record<number, Record<number, number>> = {};
  for (const week of weeks) {
    const ratings = rosterIds.map((id) => getRating(id, week));
    const m = mean(ratings);
    const sd = standardDeviation(ratings);
    const percentiles: Record<number, number> = {};
    rosterIds.forEach((id, i) => {
      const z = sd === 0 ? 0 : (ratings[i] - m) / sd;
      percentiles[id] = cumulativeStdNormalProbability(z);
    });
    byWeek[week] = percentiles;
  }
  return byWeek;
}

interface StandingsRow {
  rosterId: number;
  wins: number;
  pointsFor: number;
}

function sortStandings(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort(
    (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor
  );
}

/** simulate one playoff round; returns the winning roster ids, in the same seed order as the input */
function simulateRound(
  seedOrder: number[],
  week: number,
  percentilesByWeek: Record<number, Record<number, number>>,
  currentRecord: PlayoffSimulatorInput["currentRecord"],
  twoGameRounds: boolean
): number[] {
  const winners: number[] = [];
  const n = seedOrder.length;
  for (let i = 0; i < Math.floor(n / 2); i++) {
    const team1 = seedOrder[i];
    const team2 = seedOrder[n - 1 - i];
    const team1WinProb = matchupWinProbability(
      percentilesByWeek[week][team1],
      percentilesByWeek[week][team2]
    );

    if (!twoGameRounds) {
      winners.push(Math.random() < team1WinProb ? team1 : team2);
      continue;
    }

    let team1Wins = 0;
    let team2Wins = 0;
    for (let game = 0; game < 2; game++) {
      if (Math.random() < team1WinProb) team1Wins++;
      else team2Wins++;
    }
    if (team1Wins === team2Wins) {
      // tie broken by season points-for, same as Dynasty Daddy
      winners.push(
        currentRecord[team1].pointsFor >= currentRecord[team2].pointsFor
          ? team1
          : team2
      );
    } else {
      winners.push(team1Wins > team2Wins ? team1 : team2);
    }
  }
  return winners;
}

export function simulatePlayoffOdds(
  input: PlayoffSimulatorInput
): Record<number, PlayoffOdds> {
  const {
    rosterIds,
    currentRecord,
    remainingRegularSeasonWeeks,
    remainingRegularSeasonWeekNumbers,
    playoffWeekNumbers,
    getRating,
    playoffTeams,
    twoGameRounds = false,
    divisions,
    numSimulations = DEFAULT_NUM_SIMULATIONS,
  } = input;

  const allSimulatedWeeks = [
    ...remainingRegularSeasonWeekNumbers,
    ...playoffWeekNumbers,
  ];
  const percentilesByWeek = buildPercentilesByWeek(
    rosterIds,
    allSimulatedWeeks,
    getRating
  );

  const tallies: Record<number, PlayoffOdds> = {};
  for (const id of rosterIds) {
    tallies[id] = {
      makePlayoffs: 0,
      winDivision: 0,
      bye: 0,
      makeConfRd: 0,
      makeChampionship: 0,
      winChampionship: 0,
    };
  }

  const numOfByeWeeks = playoffTeams % 4;
  const [round1Week, confWeek, championshipWeek] = playoffWeekNumbers;

  for (let sim = 0; sim < numSimulations; sim++) {
    // 1. simulate the rest of the regular season
    const simWins: Record<number, number> = {};
    for (const id of rosterIds) simWins[id] = currentRecord[id]?.wins || 0;

    remainingRegularSeasonWeeks.forEach((weekMatchups, i) => {
      const week = remainingRegularSeasonWeekNumbers[i];
      for (const matchup of weekMatchups) {
        const team1WinProb = matchupWinProbability(
          percentilesByWeek[week][matchup.team1RosterId],
          percentilesByWeek[week][matchup.team2RosterId]
        );
        if (Math.random() < team1WinProb) {
          simWins[matchup.team1RosterId]++;
        } else {
          simWins[matchup.team2RosterId]++;
        }
      }
    });

    const standings = sortStandings(
      rosterIds.map((id) => ({
        rosterId: id,
        wins: simWins[id],
        pointsFor: currentRecord[id]?.pointsFor || 0,
      }))
    );
    const standingsById: Record<number, StandingsRow> = {};
    standings.forEach((row) => (standingsById[row.rosterId] = row));

    // 2. seed the playoff bracket
    let nonWildCardIds: number[] = [];
    let numPlayoffSpotsLeft = playoffTeams;

    if (divisions && divisions.length > 1) {
      const divisionWinners: StandingsRow[] = divisions.map((division) => {
        const teamsInDivision = standings.filter((row) =>
          division.rosterIds.includes(row.rosterId)
        );
        return teamsInDivision[0];
      });
      const sortedDivisionWinners = sortStandings(divisionWinners);
      sortedDivisionWinners.forEach((winner, i) => {
        tallies[winner.rosterId].makePlayoffs++;
        tallies[winner.rosterId].winDivision++;
        if (i < numOfByeWeeks) tallies[winner.rosterId].bye++;
      });
      nonWildCardIds = sortedDivisionWinners.map((w) => w.rosterId);
      numPlayoffSpotsLeft -= divisions.length;
    } else {
      const byeTeams = standings.slice(0, numOfByeWeeks);
      byeTeams.forEach((row) => {
        tallies[row.rosterId].makePlayoffs++;
        tallies[row.rosterId].bye++;
      });
      nonWildCardIds = byeTeams.map((row) => row.rosterId);
      numPlayoffSpotsLeft -= numOfByeWeeks;
    }

    const wildcardIds: number[] = [];
    for (const row of standings) {
      if (numPlayoffSpotsLeft <= 0) break;
      if (nonWildCardIds.includes(row.rosterId)) continue;
      tallies[row.rosterId].makePlayoffs++;
      wildcardIds.push(row.rosterId);
      numPlayoffSpotsLeft--;
    }

    const seedOrder = [...nonWildCardIds, ...wildcardIds].sort(
      (a, b) =>
        standingsById[b].wins - standingsById[a].wins ||
        standingsById[b].pointsFor - standingsById[a].pointsFor
    );

    // 3. simulate the bracket: bye teams skip round 1
    const byeIds = seedOrder.slice(0, numOfByeWeeks);
    const round1Ids = seedOrder.slice(numOfByeWeeks);

    const round1Winners =
      round1Ids.length > 0
        ? simulateRound(
            round1Ids,
            round1Week,
            percentilesByWeek,
            currentRecord,
            twoGameRounds
          )
        : [];

    const confRdIds = [...byeIds, ...round1Winners];
    confRdIds.forEach((id) => tallies[id].makeConfRd++);

    const championshipIds = simulateRound(
      confRdIds,
      confWeek,
      percentilesByWeek,
      currentRecord,
      twoGameRounds
    );
    championshipIds.forEach((id) => tallies[id].makeChampionship++);

    const champion = simulateRound(
      championshipIds,
      championshipWeek,
      percentilesByWeek,
      currentRecord,
      twoGameRounds
    );
    champion.forEach((id) => tallies[id].winChampionship++);
  }

  const odds: Record<number, PlayoffOdds> = {};
  for (const id of rosterIds) {
    const t = tallies[id];
    odds[id] = {
      makePlayoffs: Math.round((t.makePlayoffs / numSimulations) * 100),
      winDivision: Math.round((t.winDivision / numSimulations) * 100),
      bye: Math.round((t.bye / numSimulations) * 100),
      makeConfRd: Math.round((t.makeConfRd / numSimulations) * 100),
      makeChampionship: Math.round((t.makeChampionship / numSimulations) * 100),
      winChampionship: Math.round((t.winChampionship / numSimulations) * 100),
    };
  }
  return odds;
}
