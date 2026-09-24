// Boogie's analyst desk - the same breaking-news voice from
// announceTransactions.ts/ensureInjuryPost.ts, but reasoning out loud
// instead of just reporting a fact: a schedule storyline, a graded trade,
// and (in the stretch run) the playoff picture. The Schefter-style wire
// covers "what happened"; this covers "what it means" - built entirely on
// data this app already computes for its own screens (Strength of
// Schedule, the Trade Calculator's value engine, Standings' Monte Carlo)
// rather than a fourth, invented source of truth.

import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { sleeper, backend } from "./api";
import { db } from "./firebase";
import { buildLeagueSimData, LeagueSimData } from "./leagueSimData";
import { computeStrengthOfSchedule, findOpponent, TeamSOS, WeeklyOpponent } from "./strengthOfSchedule";
import { getLeagueValueSettings, computeAdjustedValue, LeagueValueSettings, RawPlayerValue } from "./playerValue";
import { rankTeams, determinePlayoffTeams, runMonteCarlo, basePointsFor } from "./whatIfSimulation";
import { computePowerRankings, PowerRankingResult } from "./powerRankings";
import { optimalLineupPoints } from "./startSitAccuracy";
import { ensureSystemPost, postExists } from "./posts";
import { tradeLabel } from "./announceTransactions";
import type { TradeEvent, TickerEvent, AddDropEvent, TxAsset } from "./leagueTransactions";

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function nameOf(sim: LeagueSimData, userId: string): string {
  return sim.managerInfo[userId]?.name ?? "Unknown Team";
}

// ---------------------------------------------------------------------
// Schedule storyline - "with N weeks left, X has the easiest schedule,
// facing Y twice and Z once down the stretch."
// ---------------------------------------------------------------------

/** the opponent this team faces most among its remaining games, if any comes up 2+ times - real round-robin leagues routinely rematch, and that's the detail worth calling out. */
function mostFacedOpponent(remaining: WeeklyOpponent[]): { opponentUserId: string; opponentName: string; count: number } | undefined {
  const counts: Record<string, { name: string; count: number }> = {};
  for (const r of remaining) {
    if (!counts[r.opponentUserId]) counts[r.opponentUserId] = { name: r.opponentName, count: 0 };
    counts[r.opponentUserId].count += 1;
  }
  let best: { opponentUserId: string; opponentName: string; count: number } | undefined;
  for (const id in counts) {
    if (counts[id].count >= 2 && (!best || counts[id].count > best.count)) {
      best = { opponentUserId: id, opponentName: counts[id].name, count: counts[id].count };
    }
  }
  return best;
}

/** a distinct opponent this team faces exactly once, other than the repeat opponent - the "and Unc only once" contrast in the user's own example. */
function singleMeetingOpponent(remaining: WeeklyOpponent[], excludeId?: string): string | undefined {
  const others = remaining.filter((r) => r.opponentUserId !== excludeId);
  const counts: Record<string, number> = {};
  for (const r of others) counts[r.opponentUserId] = (counts[r.opponentUserId] || 0) + 1;
  const singleId = Object.keys(counts).find((id) => counts[id] === 1);
  return singleId ? others.find((r) => r.opponentUserId === singleId)?.opponentName : undefined;
}

function scheduleStorylineText(gamesLeft: number, easiest: TeamSOS, hardest: TeamSOS): string {
  const repeatOpp = mostFacedOpponent(easiest.remaining);
  const singleOppName = singleMeetingOpponent(easiest.remaining, repeatOpp?.opponentUserId);

  const repeatBit = repeatOpp ? ` — including ${repeatOpp.opponentName} ${repeatOpp.count === 2 ? "twice" : `${repeatOpp.count}x`}` : "";
  const contrastBit = singleOppName ? ` and ${singleOppName} just once` : "";

  const opener = pick([
    `📊 With ${gamesLeft} weeks left, ${easiest.name} has the easiest closing schedule in the league${repeatBit}${contrastBit} down the stretch.`,
    `📊 Strength-of-schedule check with ${gamesLeft} to go: ${easiest.name} is catching a break the rest of the way${repeatBit}${contrastBit} — about as soft a finish as it gets.`,
    `📊 Numbers say ${easiest.name}'s remaining slate is the league's kindest${repeatBit}${contrastBit}, ${gamesLeft} weeks out.`,
  ]);

  const tail = pick([
    ` On the other end, ${hardest.name} has the toughest road left in the league.`,
    ` Meanwhile ${hardest.name} isn't so lucky — hardest remaining schedule of anyone.`,
    ` Spare a thought for ${hardest.name}, staring down the league's roughest closing stretch.`,
  ]);

  return opener + tail;
}

/** posts once per week - the storyline doesn't change intra-week, and a fresh remaining-schedule read only matters once a week actually closes out. Skipped once there isn't enough runway left (under 3 games) for "closing schedule" to mean anything. */
export async function ensureScheduleStorylinePost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  try {
    const sos = computeStrengthOfSchedule(sim, currentWeek);
    if (sos.length < 2) return;
    const gamesLeft = sos[0]?.remaining.length ?? 0;
    if (gamesLeft < 3) return;

    const hardest = sos[0];
    const easiest = sos[sos.length - 1];
    if (!hardest || !easiest || hardest.userId === easiest.userId) return;

    await ensureSystemPost({
      id: `sos_story_${leagueId}_wk${currentWeek}`,
      text: scheduleStorylineText(gamesLeft, easiest, hardest),
      leagueId,
      targetType: "analysis",
      targetId: `sos_wk${currentWeek}`,
      targetLabel: "Strength of Schedule",
    });
  } catch (error) {
    console.error("Error posting schedule storyline:", error);
  }
}

// ---------------------------------------------------------------------
// Trade grade - a follow-up "expert take" on a trade that already went
// down, using the exact same KTC-based value engine the Trade Calculator
// grades hypothetical trades with (see getLeagueValueSettings/
// computeAdjustedValue), so a completed trade and a proposed one are
// judged by the same yardstick.
// ---------------------------------------------------------------------

type TwoTeamTrade = Extract<TradeEvent, { kind: "trade2" }>;

function assetValueTotal(
  assets: TxAsset[],
  valuesBySleeperId: Record<string, RawPlayerValue>,
  settings: LeagueValueSettings
): { total: number; priced: number } {
  let total = 0;
  let priced = 0;
  for (const asset of assets) {
    if (asset.isPick || !asset.id) continue; // picks have no KTC market value to price against
    const raw = valuesBySleeperId[asset.id];
    if (!raw) continue;
    total += computeAdjustedValue(raw, settings);
    priced += 1;
  }
  return { total, priced };
}

function tradeGradeText(teamA: string, teamB: string, netToA: number, totalValue: number): string {
  const pct = totalValue > 0 ? Math.abs(netToA) / totalValue : 0;

  if (pct < 0.08) {
    return pick([
      `📈 Grading that ${teamA}-${teamB} deal: dead even by value. Both sides walk away fine here.`,
      `📈 Ran the numbers on ${teamA} and ${teamB}'s trade — a fair swap, no real winner.`,
      `📈 That ${teamA} / ${teamB} trade grades out even. Nicely balanced deal.`,
    ]);
  }

  const winner = netToA > 0 ? teamA : teamB;
  const loser = netToA > 0 ? teamB : teamA;
  const magnitude = pct < 0.2 ? "a slight edge to" : pct < 0.35 ? "a real edge to" : "a lopsided win for";

  return pick([
    `📈 Grading that ${teamA}-${teamB} trade: ${magnitude} ${winner}. ${loser} paid a bit more than they got back here.`,
    `📈 Crunched the numbers on this one — leans ${winner}'s way. ${loser} will want that value back down the line.`,
    `📈 My early read on ${teamA} / ${teamB}: ${winner} comes out ahead on paper. Time will tell on the field.`,
  ]);
}

async function ensureOneTradeGrade(
  leagueId: string,
  event: TwoTeamTrade,
  settings: LeagueValueSettings,
  valuesBySleeperId: Record<string, RawPlayerValue>
): Promise<void> {
  const givesVal = assetValueTotal(event.aGives, valuesBySleeperId, settings);
  const getsVal = assetValueTotal(event.aGets, valuesBySleeperId, settings);
  // An all-picks (or otherwise unpriced) deal has nothing real to grade off - skip rather than guess.
  if (givesVal.priced === 0 && getsVal.priced === 0) return;

  const netToA = getsVal.total - givesVal.total;
  const totalValue = givesVal.total + getsVal.total;

  await ensureSystemPost({
    id: `tradegrade_${leagueId}_${event.id}`,
    text: tradeGradeText(event.teamA.name, event.teamB.name, netToA, totalValue),
    leagueId,
    targetType: "trade",
    targetId: event.id,
    targetLabel: tradeLabel(event),
    // One tick after the breaking-news post so it reads as a follow-up in the same thread, not a duplicate headline.
    createdAtMs: event.timestamp + 1000,
  });
}

/** grades every real 2-team trade this league has had, using the same value engine the Trade Calculator uses for proposed trades. 3-team+ trades are skipped - there's no clean single "winner" to call in a 3-way deal. */
export async function ensureTradeGradePosts(leagueId: string, tradeEvents: TradeEvent[]): Promise<void> {
  const twoTeamTrades = tradeEvents.filter((e): e is TwoTeamTrade => e.kind === "trade2");
  if (twoTeamTrades.length === 0) return;

  let settings: LeagueValueSettings;
  let valuesBySleeperId: Record<string, RawPlayerValue>;
  try {
    [settings, valuesBySleeperId] = await Promise.all([getLeagueValueSettings(leagueId), backend.fetchAllPlayerValues()]);
  } catch (error) {
    console.error("Error loading player values for trade grading:", error);
    return;
  }

  await Promise.all(
    twoTeamTrades.map((event) =>
      ensureOneTradeGrade(leagueId, event, settings, valuesBySleeperId).catch((error) =>
        console.error("Error posting trade grade:", error)
      )
    )
  );
}

// ---------------------------------------------------------------------
// Playoff picture - fires only in the stretch run (4 weeks or fewer left
// in the regular season), using the same Monte Carlo engine Standings'
// baseline playoff-odds column runs.
// ---------------------------------------------------------------------

function playoffPictureText(input: {
  week: number;
  topSeed: string;
  topSeedOdds: number;
  bubbleIn: string;
  bubbleInOdds: number;
  bubbleOut: string;
  bubbleOutOdds: number;
  bubbleInSOS?: TeamSOS["tier"];
  bubbleOutSOS?: TeamSOS["tier"];
}): string {
  const { week, topSeed, topSeedOdds, bubbleIn, bubbleInOdds, bubbleOut, bubbleOutOdds, bubbleInSOS, bubbleOutSOS } = input;

  const header = pick([
    `🏆 Playoff picture, Week ${week}:`,
    `🏆 Where things stand heading into Week ${week}:`,
    `🏆 Postseason math, Week ${week} edition:`,
  ]);

  const topLine =
    topSeedOdds >= 90
      ? pick([
          ` ${topSeed} controls their own destiny at the top, ${Math.round(topSeedOdds)}% to make the postseason.`,
          ` ${topSeed} is in firm control up top — ${Math.round(topSeedOdds)}% playoff odds.`,
        ])
      : ` ${topSeed} leads the way, though nothing's locked up yet.`;

  const bubbleLine = pick([
    ` The last spot is a dogfight: ${bubbleIn} (${Math.round(bubbleInOdds)}%) is barely holding off ${bubbleOut} (${Math.round(bubbleOutOdds)}%) for the final playoff spot.`,
    ` Down at the cut line, ${bubbleIn} is clinging to the final spot over ${bubbleOut}, ${Math.round(bubbleInOdds)}% to ${Math.round(bubbleOutOdds)}%.`,
  ]);

  let sosLine = "";
  if (bubbleInSOS === "Brutal" || bubbleInSOS === "Tough") {
    sosLine = ` Bad timing for ${bubbleIn}, too — one of the toughest closing schedules left in the league.`;
  } else if (bubbleOutSOS === "Favorable" || bubbleOutSOS === "Cakewalk") {
    sosLine = ` ${bubbleOut} does have a soft closing schedule working in their favor.`;
  }

  return header + topLine + bubbleLine + sosLine;
}

/** posts once per week, only inside the stretch run (4 or fewer regular-season weeks left) - a playoff picture read any earlier than that is just noise. */
export async function ensurePlayoffPicturePost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  try {
    const weeksLeft = sim.playoffStartWeek - currentWeek;
    if (weeksLeft > 4 || weeksLeft < 0) return;

    const wins: Record<string, number> = {};
    const pointsFor: Record<string, number> = {};
    sim.teamIds.forEach((id) => {
      wins[id] = parseInt((sim.managerInfo[id].wins as any) || "0", 10);
      pointsFor[id] = basePointsFor(sim.managerInfo[id]);
    });

    const ranked = rankTeams(sim.teamIds, wins, pointsFor);
    const { qualifiers } = determinePlayoffTeams(ranked, sim.managerInfo, sim.divisionsCount, sim.playoffSpots);
    const outTeams = ranked.filter((id) => !qualifiers.includes(id));
    const bubbleInId = qualifiers[qualifiers.length - 1];
    const bubbleOutId = outTeams[0];
    // Nobody on the bubble - either everyone's in, or the league's too small for a real race.
    if (!bubbleInId || !bubbleOutId) return;

    const { playoffOdds } = runMonteCarlo(
      sim.teamIds,
      sim.managerInfo,
      sim.matchupData,
      sim.projectionCache,
      sim.playoffStartWeek,
      sim.playoffSpots,
      sim.divisionsCount,
      {},
      1000
    );

    const topSeedId = ranked[0];
    const sos = computeStrengthOfSchedule(sim, currentWeek);
    const sosById = new Map(sos.map((t) => [t.userId, t]));

    const text = playoffPictureText({
      week: currentWeek,
      topSeed: nameOf(sim, topSeedId),
      topSeedOdds: playoffOdds[topSeedId] ?? 0,
      bubbleIn: nameOf(sim, bubbleInId),
      bubbleInOdds: playoffOdds[bubbleInId] ?? 0,
      bubbleOut: nameOf(sim, bubbleOutId),
      bubbleOutOdds: playoffOdds[bubbleOutId] ?? 0,
      bubbleInSOS: sosById.get(bubbleInId)?.tier,
      bubbleOutSOS: sosById.get(bubbleOutId)?.tier,
    });

    await ensureSystemPost({
      id: `playoff_picture_${leagueId}_wk${currentWeek}`,
      text,
      leagueId,
      targetType: "analysis",
      targetId: `playoffs_wk${currentWeek}`,
      targetLabel: "Playoff Picture",
    });
  } catch (error) {
    console.error("Error posting playoff picture:", error);
  }
}

// ---------------------------------------------------------------------
// Power Rankings Power Move - a weekly check-in with real week-over-week
// movement, the same "climbs to #1" / "free-fall" framing real power
// rankings columns use. The movement itself needs last week's ranks to
// diff against; rather than re-deriving a full historical ranking (this
// module's own strengthScore is forward-looking, off current rosters, not
// a point-in-time snapshot), the previous run's own output is stashed in
// a tiny Firestore doc and read back here - the cheapest way to get a
// real "up 3 spots" storyline instead of a flat, static list every week.
// ---------------------------------------------------------------------

function powerRankStateDoc(leagueId: string) {
  return doc(db, "boogieState", `${leagueId}_powerrank`);
}

async function loadLastWeekRanks(leagueId: string, currentWeek: number): Promise<Record<string, number> | null> {
  try {
    const snap = await getDoc(powerRankStateDoc(leagueId));
    if (!snap.exists()) return null;
    const data = snap.data() as { week?: number; ranks?: Record<string, number> };
    // Only useful if it's genuinely the immediately-prior week - a gap
    // (someone skipped visiting for a few weeks) makes "climbed 3 spots"
    // meaningless, so the post just falls back to a plain check-in instead.
    if (data.week !== currentWeek - 1 || !data.ranks) return null;
    return data.ranks;
  } catch (error) {
    console.error("Error loading last week's power ranks:", error);
    return null;
  }
}

function powerRankMovementText(
  currentWeek: number,
  ranked: PowerRankingResult[],
  nameById: Record<string, string>,
  lastWeekRanks: Record<string, number> | null
): string {
  const topName = nameById[ranked[0]?.userId] ?? "Unknown Team";

  let riser: { name: string; delta: number } | undefined;
  let faller: { name: string; delta: number } | undefined;
  if (lastWeekRanks) {
    for (const r of ranked) {
      const prevRank = lastWeekRanks[r.userId];
      if (prevRank === undefined) continue;
      const delta = prevRank - r.rank; // positive = moved up
      if (delta >= 2 && (!riser || delta > riser.delta)) riser = { name: nameById[r.userId] ?? "Unknown Team", delta };
      if (delta <= -2 && (!faller || delta < faller.delta)) faller = { name: nameById[r.userId] ?? "Unknown Team", delta };
    }
  }

  const header = pick([
    `📶 Power Rankings, Week ${currentWeek}: ${topName} holds the top spot.`,
    `📶 Week ${currentWeek} Power Rankings are in — ${topName} sits at #1.`,
    `📶 Checking the Power Rankings for Week ${currentWeek}: ${topName} leads the league.`,
  ]);

  const riserLine = riser
    ? pick([
        ` Biggest riser: ${riser.name}, up ${riser.delta} spots this week.`,
        ` ${riser.name} is the mover — climbing ${riser.delta} spots since last week.`,
      ])
    : "";
  const fallerLine = faller
    ? pick([
        ` On the way down: ${faller.name}, dropping ${Math.abs(faller.delta)} spots.`,
        ` ${faller.name} took the biggest hit this week, falling ${Math.abs(faller.delta)} spots.`,
      ])
    : "";

  return header + riserLine + fallerLine;
}

/** posts once per week - real movement flavor when last week's ranks are on hand, a plain check-in otherwise. Checks postExists FIRST since the ranking itself (fetchPlayers +, for dynasty, fetchAllPlayerValues) is real work worth skipping once this week's post is already up. */
export async function ensurePowerRankingsMovementPost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  const postId = `powerrank_${leagueId}_wk${currentWeek}`;
  try {
    if (await postExists(postId)) return;

    const settings = await getLeagueValueSettings(leagueId);
    const [playersData, valuesBySleeperId] = await Promise.all([
      backend.fetchPlayers(leagueId),
      settings.isDynasty ? backend.fetchAllPlayerValues() : Promise.resolve({} as Record<string, RawPlayerValue>),
    ]);

    const teams = sim.teamIds
      .map((userId) => {
        const info = sim.managerInfo[userId];
        if (!info?.rosterId) return null;
        return {
          rosterId: info.rosterId,
          userId,
          wins: parseInt((info.wins as any) || "0", 10),
          losses: parseInt((info.losses as any) || "0", 10),
          rosterSleeperIds: info.rosterPlayerIds,
          starterSleeperIds: info.starters ?? [],
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
    if (teams.length < 2) return;

    const ranked = computePowerRankings({
      teams,
      leagueSettings: settings,
      upcomingWeeks: [currentWeek, currentWeek + 1, currentWeek + 2],
      playerValuesBySleeperId: valuesBySleeperId,
      getWeeklyStarterProjection: (starterIds, week) =>
        starterIds.reduce((sum, playerId) => {
          const proj = playersData?.[playerId]?.wi?.[week.toString()]?.p;
          return sum + (proj !== undefined ? parseFloat(proj) : 0);
        }, 0),
    });

    const nameById: Record<string, string> = {};
    for (const userId of sim.teamIds) nameById[userId] = nameOf(sim, userId);

    const lastWeekRanks = await loadLastWeekRanks(leagueId, currentWeek);
    const text = powerRankMovementText(currentWeek, ranked, nameById, lastWeekRanks);

    await ensureSystemPost({
      id: postId,
      text,
      leagueId,
      targetType: "analysis",
      targetId: `powerrank_wk${currentWeek}`,
      targetLabel: "Power Rankings",
    });

    const thisWeekRanks: Record<string, number> = {};
    for (const r of ranked) thisWeekRanks[r.userId] = r.rank;
    await setDoc(powerRankStateDoc(leagueId), { week: currentWeek, ranks: thisWeekRanks }).catch((error) =>
      console.error("Error saving power rank state:", error)
    );
  } catch (error) {
    console.error("Error posting power rankings movement:", error);
  }
}

// ---------------------------------------------------------------------
// Rematch Alert - when this week's real schedule pairs up two teams who
// already played each other earlier this season (round-robin leagues
// rematch routinely, same fact the schedule storyline's "facing X twice"
// detail draws on), Boogie previews it with the first meeting's real
// result - zero extra fetches, purely off the sim already built.
// ---------------------------------------------------------------------

function rematchAlertText(a: string, b: string, week: number, firstWeek: number, marginPts: number, winnerName: string): string {
  if (marginPts < 3) {
    return pick([
      `🔥 Rematch alert: ${a} and ${b} run it back in Week ${week}. Their first meeting back in Week ${firstWeek} came down to the wire - ${winnerName} escaped by ${marginPts.toFixed(1)}.`,
      `🔥 Grudge match, Week ${week}: ${a} vs. ${b} again. Last time these two played, Week ${firstWeek}, it was decided by a nail-biting ${marginPts.toFixed(1)} points.`,
    ]);
  }
  return pick([
    `🔥 Rematch alert: ${a} and ${b} meet again in Week ${week}. ${winnerName} took the first meeting back in Week ${firstWeek} by ${marginPts.toFixed(1)} points.`,
    `🔥 Second helping: ${a} and ${b} run it back in Week ${week} after ${winnerName} won the first go-round in Week ${firstWeek} by ${marginPts.toFixed(1)}.`,
  ]);
}

/** posts once per week, only when this week's real schedule actually contains a rematch - most weeks won't, which keeps this rare enough to feel like real insider knowledge instead of routine noise. */
export async function ensureRematchAlertPost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  try {
    const seen = new Set<string>();
    let best: { a: string; b: string; firstWeek: number; marginPts: number; winnerName: string } | null = null;

    for (const userId of sim.teamIds) {
      if (seen.has(userId)) continue;
      const oppId = findOpponent(sim, currentWeek, userId);
      if (!oppId || seen.has(oppId)) continue;
      seen.add(userId);
      seen.add(oppId);

      for (let w = currentWeek - 1; w >= 1; w--) {
        const earlierOpp = findOpponent(sim, w, userId);
        if (earlierOpp !== oppId) continue;

        const myPts = parseFloat(sim.matchupData[w]?.[userId]?.team_points || "0");
        const oppPts = parseFloat(sim.matchupData[w]?.[oppId]?.team_points || "0");
        if (myPts === 0 && oppPts === 0) break; // that week never actually played out
        const marginPts = Math.abs(myPts - oppPts);
        const winnerName = nameOf(sim, myPts >= oppPts ? userId : oppId);

        // The closest of the week's rematches is the most compelling story to lead with.
        if (!best || marginPts < best.marginPts) {
          best = { a: nameOf(sim, userId), b: nameOf(sim, oppId), firstWeek: w, marginPts, winnerName };
        }
        break; // only the most recent prior meeting matters
      }
    }

    if (!best) return;

    await ensureSystemPost({
      id: `rematch_${leagueId}_wk${currentWeek}`,
      text: rematchAlertText(best.a, best.b, currentWeek, best.firstWeek, best.marginPts, best.winnerName),
      leagueId,
      targetType: "analysis",
      targetId: `rematch_wk${currentWeek}`,
      targetLabel: "Rematch Alert",
    });
  } catch (error) {
    console.error("Error posting rematch alert:", error);
  }
}

// ---------------------------------------------------------------------
// Bench Regret - the most quietly brutal fantasy storyline there is: a
// real loss that a team's own bench had the points to flip. Uses the
// exact same optimalLineupPoints greedy solver the all-time lineup-
// efficiency stat (profileActivity.ts) already trusts, run against real
// per-player box scores already sitting in sim.matchupData - no new fetch.
// ---------------------------------------------------------------------

function biggestBenchSnub(teamWeek: any): { name: string; points: number } | null {
  let best: { name: string; points: number } | null = null;
  for (const p of teamWeek?.bench_full_data || []) {
    if (!p?.fn && !p?.ln) continue;
    const pts = parseFloat(p.points || "0");
    if (!best || pts > best.points) best = { name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim(), points: pts };
  }
  return best;
}

function benchRegretText(loser: string, winner: string, week: number, benchPointsLeft: number, oppPts: number, snub: { name: string; points: number } | null): string {
  const snubBit = snub ? ` — ${snub.name} (${snub.points.toFixed(1)} pts) never left the bench` : "";
  return pick([
    `🚨 Bench regret: ${loser} left ${benchPointsLeft.toFixed(1)} points on the bench in their Week ${week} loss to ${winner}${snubBit}. That's a tough one to explain in the group chat.`,
    `🚨 Painful one: ${loser}'s best possible lineup in Week ${week} beats ${winner}'s ${oppPts.toFixed(1)}${snubBit ? snubBit : ""} - instead, the real lineup came up short.`,
    `🚨 ${loser} had the horses to win Week ${week}${snubBit} - the bench outscored the decisions, and it cost them the game against ${winner}.`,
  ]);
}

/** posts once per week for the most recently completed week - the single most dramatic "would've won with the bench" story leaguewide, not every qualifying team (most weeks have at least a couple; only the biggest swing is worth Boogie's attention). */
export async function ensureBenchRegretPost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  try {
    const targetWeek = currentWeek - 1;
    if (targetWeek < 1) return;

    const seen = new Set<string>();
    let best:
      | { loserId: string; winnerId: string; benchPointsLeft: number; oppPts: number; snub: { name: string; points: number } | null }
      | null = null;

    for (const userId of sim.teamIds) {
      if (seen.has(userId)) continue;
      const oppId = findOpponent(sim, targetWeek, userId);
      if (!oppId || seen.has(oppId)) continue;
      seen.add(userId);
      seen.add(oppId);

      const teamAWeek = sim.matchupData[targetWeek]?.[userId];
      const teamBWeek = sim.matchupData[targetWeek]?.[oppId];
      const ptsA = parseFloat(teamAWeek?.team_points || "0");
      const ptsB = parseFloat(teamBWeek?.team_points || "0");
      if (ptsA === 0 && ptsB === 0) continue; // not actually played

      const loserId = ptsA < ptsB ? userId : ptsB < ptsA ? oppId : null;
      if (!loserId) continue; // a tie has no "regret" story
      const winnerId = loserId === userId ? oppId : userId;
      const loserWeek = loserId === userId ? teamAWeek : teamBWeek;
      const winnerPts = loserId === userId ? ptsB : ptsA;

      const optimalPts = optimalLineupPoints(loserWeek?.players || [], loserWeek?.players_points || {}, sim.posById, sim.startingSlots);
      if (optimalPts <= winnerPts) continue; // the bench wouldn't have changed the outcome anyway

      const benchPointsLeft = optimalPts - parseFloat(loserWeek?.team_points || "0");
      if (!best || benchPointsLeft > best.benchPointsLeft) {
        best = { loserId, winnerId, benchPointsLeft, oppPts: winnerPts, snub: biggestBenchSnub(loserWeek) };
      }
    }

    if (!best) return;

    await ensureSystemPost({
      id: `benchregret_${leagueId}_wk${targetWeek}`,
      text: benchRegretText(nameOf(sim, best.loserId), nameOf(sim, best.winnerId), targetWeek, best.benchPointsLeft, best.oppPts, best.snub),
      leagueId,
      targetType: "analysis",
      targetId: `benchregret_wk${targetWeek}`,
      targetLabel: "Bench Regret",
    });
  } catch (error) {
    console.error("Error posting bench regret:", error);
  }
}

// ---------------------------------------------------------------------
// Waiver Wire Headliner - the one add worth Boogie's attention out of a
// week's worth of waiver moves, picked by the same KTC value engine the
// trade grades use. Every other add is deliberately left alone (see
// announceTransactions.ts) - this is a curated exception, one pickup, not
// a raw feed of every roster move.
// ---------------------------------------------------------------------

function waiverHeadlinerText(teamName: string, playerLabel: string, pos: string | undefined): string {
  const posBit = pos ? ` (${pos})` : "";
  return pick([
    `📲 Waiver wire notes: ${teamName} adds ${playerLabel}${posBit} - one of the bigger claims of the week.`,
    `📲 Hearing ${teamName} has added ${playerLabel}${posBit} off waivers. Notable pickup.`,
    `📲 Roster move: ${teamName} lands ${playerLabel}${posBit} on waivers - a name worth knowing.`,
  ]);
}

/** posts once per week - the single highest-value add among the last 7 days of adds, so it reads as a curated headline instead of a raw transactions feed. Checks postExists FIRST since pricing every add needs the KTC value bundle. */
export async function ensureWaiverHeadlinerPost(leagueId: string, events: TickerEvent[], currentWeek: number): Promise<void> {
  const postId = `waiverheadliner_${leagueId}_wk${currentWeek}`;
  try {
    if (await postExists(postId)) return;

    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const adds = events.filter((e): e is AddDropEvent => e.kind === "add" && e.timestamp >= cutoffMs);
    if (adds.length === 0) return;

    let settings: LeagueValueSettings;
    let valuesBySleeperId: Record<string, RawPlayerValue>;
    try {
      [settings, valuesBySleeperId] = await Promise.all([getLeagueValueSettings(leagueId), backend.fetchAllPlayerValues()]);
    } catch (error) {
      console.error("Error loading player values for waiver headliner:", error);
      return;
    }

    let best: { event: AddDropEvent; value: number } | null = null;
    for (const event of adds) {
      if (event.asset.isPick || !event.asset.id) continue;
      const raw = valuesBySleeperId[event.asset.id];
      if (!raw) continue;
      const value = computeAdjustedValue(raw, settings);
      if (!best || value > best.value) best = { event, value };
    }
    if (!best || best.value <= 0) return;

    await ensureSystemPost({
      id: postId,
      text: waiverHeadlinerText(best.event.team.name, best.event.asset.label, best.event.asset.pos),
      leagueId,
      targetType: "waiver",
      targetId: best.event.id,
      targetLabel: `${best.event.team.name} waiver move`,
    });
  } catch (error) {
    console.error("Error posting waiver headliner:", error);
  }
}

// ---------------------------------------------------------------------
// Orchestrator - builds one shared LeagueSimData for the whole analyst
// pass instead of each post type fetching its own copy.
// ---------------------------------------------------------------------

/** runs Boogie's whole analyst pass for a league - safe to call on every Dashboard load, same as announceLeagueTransactions: every post underneath is keyed by a deterministic id and no-ops once it exists. Pass in the transaction events announceLeagueTransactions already fetched so this doesn't re-fetch the season's transaction history a second time. */
export async function ensureBoogieAnalystPosts(leagueId: string, events: TickerEvent[]): Promise<void> {
  try {
    const [{ data: nflState }, sim] = await Promise.all([sleeper.getNflState(), buildLeagueSimData(leagueId)]);
    const week = nflState.display_week || 1;
    const tradeEvents = events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti");

    await Promise.all([
      ensureScheduleStorylinePost(leagueId, sim, week),
      ensurePlayoffPicturePost(leagueId, sim, week),
      ensureTradeGradePosts(leagueId, tradeEvents),
      ensurePowerRankingsMovementPost(leagueId, sim, week),
      ensureRematchAlertPost(leagueId, sim, week),
      ensureBenchRegretPost(leagueId, sim, week),
      ensureWaiverHeadlinerPost(leagueId, events, week),
    ]);
  } catch (error) {
    console.error("Error running Boogie's analyst pass:", error);
  }
}
