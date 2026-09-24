// Boogie's analyst desk - the same breaking-news voice from
// announceTransactions.ts/ensureInjuryPost.ts, but reasoning out loud
// instead of just reporting a fact: a schedule storyline, a graded trade,
// and (in the stretch run) the playoff picture. The Schefter-style wire
// covers "what happened"; this covers "what it means" - built entirely on
// data this app already computes for its own screens (Strength of
// Schedule, the Trade Calculator's value engine, Standings' Monte Carlo)
// rather than a fourth, invented source of truth.

import { sleeper, backend } from "./api";
import { buildLeagueSimData, LeagueSimData } from "./leagueSimData";
import { computeStrengthOfSchedule, TeamSOS, WeeklyOpponent } from "./strengthOfSchedule";
import { getLeagueValueSettings, computeAdjustedValue, LeagueValueSettings, RawPlayerValue } from "./playerValue";
import { rankTeams, determinePlayoffTeams, runMonteCarlo, basePointsFor } from "./whatIfSimulation";
import { ensureSystemPost } from "./posts";
import { tradeLabel } from "./announceTransactions";
import type { TradeEvent, TxAsset } from "./leagueTransactions";

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
// Orchestrator - builds one shared LeagueSimData for the whole analyst
// pass (schedule storyline + playoff picture both need it) instead of
// each post type fetching its own copy.
// ---------------------------------------------------------------------

/** runs Boogie's whole analyst pass for a league - safe to call on every Dashboard load, same as announceLeagueTransactions: every post underneath is keyed by a deterministic id and no-ops once it exists. Pass in the trade events announceLeagueTransactions already fetched so this doesn't re-fetch the season's transaction history a second time. */
export async function ensureBoogieAnalystPosts(leagueId: string, tradeEvents: TradeEvent[]): Promise<void> {
  try {
    const [{ data: nflState }, sim] = await Promise.all([sleeper.getNflState(), buildLeagueSimData(leagueId)]);
    const week = nflState.display_week || 1;

    await Promise.all([
      ensureScheduleStorylinePost(leagueId, sim, week),
      ensurePlayoffPicturePost(leagueId, sim, week),
      ensureTradeGradePosts(leagueId, tradeEvents),
    ]);
  } catch (error) {
    console.error("Error running Boogie's analyst pass:", error);
  }
}
