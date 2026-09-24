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
import { computeTeamNeeds, computeLeagueNeedBaseline } from "./tradeAnalysis";
import { buildSeasonToDatePPG, computeRedraftTeamNeeds, computeLeagueRedraftNeedBaseline } from "./redraftNeeds";
import type { PlayerPos } from "./draftProspects";
import { getManagerHistory } from "./getManagerHistory";
import { ensureSystemPost, postExists } from "./posts";
import type { AnalystCard } from "./posts";
import { tradeLabel } from "./announceTransactions";
import type { TradeEvent, TickerEvent, AddDropEvent, TxAsset } from "./leagueTransactions";

function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function nameOf(sim: LeagueSimData, userId: string): string {
  return sim.managerInfo[userId]?.name ?? "Unknown Team";
}

function formatValue(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** "2nd hardest" / "5th easiest" - real ordinal-rank framing instead of a bare tier label. `rank` is 1-indexed from hardest. The #1 in either direction just reads "hardest"/"easiest" - nobody says "the 1st hardest." */
function scheduleRankLabel(rank: number, total: number): string {
  if (rank * 2 <= total) return rank === 1 ? "hardest" : `${rank}${ordinalSuffix(rank)} hardest`;
  const fromEasy = total - rank + 1;
  return fromEasy === 1 ? "easiest" : `${fromEasy}${ordinalSuffix(fromEasy)} easiest`;
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

    const analystCard: AnalystCard = {
      eyebrow: "STRENGTH OF SCHEDULE",
      rows: [
        { name: easiest.name, avatar: easiest.avatar, stat: String(easiest.sosScore), statLabel: "#1 EASIEST", highlight: true },
        { name: hardest.name, avatar: hardest.avatar, stat: String(hardest.sosScore), statLabel: "#1 HARDEST" },
      ],
      footer: `${gamesLeft} weeks left`,
    };

    await ensureSystemPost({
      id: `sos_story_${leagueId}_wk${currentWeek}`,
      text: scheduleStorylineText(gamesLeft, easiest, hardest),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `sos:wk${currentWeek}`,
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
  const pct = totalValue > 0 ? Math.abs(netToA) / totalValue : 0;

  const analystCard: AnalystCard = {
    eyebrow: "TRADE GRADE",
    rows: [
      { name: event.teamA.name, avatar: event.teamA.avatar, stat: `${netToA >= 0 ? "+" : "-"}${formatValue(Math.abs(netToA))}`, statLabel: "VALUE", highlight: netToA >= 0 },
      { name: event.teamB.name, avatar: event.teamB.avatar, stat: `${netToA <= 0 ? "+" : "-"}${formatValue(Math.abs(netToA))}`, statLabel: "VALUE", highlight: netToA < 0 },
    ],
    footer: pct < 0.08 ? "Fair trade - no real winner" : `${Math.round(pct * 100)}% value swing`,
  };

  await ensureSystemPost({
    id: `tradegrade_${leagueId}_${event.id}`,
    text: tradeGradeText(event.teamA.name, event.teamB.name, netToA, totalValue),
    analystCard,
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
  /** bubbleIn/bubbleOut's real SOS rank (1-indexed from hardest) and the league size, for real "Nth toughest" framing instead of a vague tier label */
  bubbleInSOSRank?: number;
  bubbleOutSOSRank?: number;
  sosTotal: number;
}): string {
  const { week, topSeed, topSeedOdds, bubbleIn, bubbleInOdds, bubbleOut, bubbleOutOdds, bubbleInSOSRank, bubbleOutSOSRank, sosTotal } = input;

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

  // Real ordinal rank, not a vague tier ("one of the toughest") - the top
  // half of the league's remaining schedules counts as genuinely tough.
  let sosLine = "";
  if (bubbleInSOSRank !== undefined && bubbleInSOSRank * 2 <= sosTotal) {
    sosLine = ` Bad timing for ${bubbleIn}, too — the league's ${scheduleRankLabel(bubbleInSOSRank, sosTotal)} closing schedule.`;
  } else if (bubbleOutSOSRank !== undefined && bubbleOutSOSRank * 2 > sosTotal) {
    sosLine = ` ${bubbleOut} does have the ${scheduleRankLabel(bubbleOutSOSRank, sosTotal)} schedule working in their favor.`;
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
    // computeStrengthOfSchedule's own output is already sorted hardest-to-
    // easiest, so a team's index in it IS its real 1-indexed SOS rank.
    const sos = computeStrengthOfSchedule(sim, currentWeek);
    const sosRankById = new Map(sos.map((t, i) => [t.userId, i + 1]));

    const text = playoffPictureText({
      week: currentWeek,
      topSeed: nameOf(sim, topSeedId),
      topSeedOdds: playoffOdds[topSeedId] ?? 0,
      bubbleIn: nameOf(sim, bubbleInId),
      bubbleInOdds: playoffOdds[bubbleInId] ?? 0,
      bubbleOut: nameOf(sim, bubbleOutId),
      bubbleOutOdds: playoffOdds[bubbleOutId] ?? 0,
      bubbleInSOSRank: sosRankById.get(bubbleInId),
      bubbleOutSOSRank: sosRankById.get(bubbleOutId),
      sosTotal: sos.length,
    });

    const analystCard: AnalystCard = {
      eyebrow: `PLAYOFF PICTURE · WEEK ${currentWeek}`,
      rows: [
        { name: nameOf(sim, topSeedId), avatar: sim.managerInfo[topSeedId]?.avatar, stat: `${Math.round(playoffOdds[topSeedId] ?? 0)}%`, statLabel: "TOP SEED", highlight: true },
        { name: nameOf(sim, bubbleInId), avatar: sim.managerInfo[bubbleInId]?.avatar, stat: `${Math.round(playoffOdds[bubbleInId] ?? 0)}%`, statLabel: "IN" },
        { name: nameOf(sim, bubbleOutId), avatar: sim.managerInfo[bubbleOutId]?.avatar, stat: `${Math.round(playoffOdds[bubbleOutId] ?? 0)}%`, statLabel: "OUT" },
      ],
    };

    await ensureSystemPost({
      id: `playoff_picture_${leagueId}_wk${currentWeek}`,
      text,
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `playoffs:wk${currentWeek}`,
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

interface RankMover {
  userId: string;
  name: string;
  delta: number;
}

/** the biggest climb and biggest drop since last week, 2+ spots minimum - shared by the text and the card so both tell the same story. */
function findMovers(
  ranked: PowerRankingResult[],
  nameById: Record<string, string>,
  lastWeekRanks: Record<string, number> | null
): { riser?: RankMover; faller?: RankMover } {
  if (!lastWeekRanks) return {};
  let riser: RankMover | undefined;
  let faller: RankMover | undefined;
  for (const r of ranked) {
    const prevRank = lastWeekRanks[r.userId];
    if (prevRank === undefined) continue;
    const delta = prevRank - r.rank; // positive = moved up
    if (delta >= 2 && (!riser || delta > riser.delta)) riser = { userId: r.userId, name: nameById[r.userId] ?? "Unknown Team", delta };
    if (delta <= -2 && (!faller || delta < faller.delta)) faller = { userId: r.userId, name: nameById[r.userId] ?? "Unknown Team", delta };
  }
  return { riser, faller };
}

function powerRankMovementText(
  currentWeek: number,
  ranked: PowerRankingResult[],
  nameById: Record<string, string>,
  movers: { riser?: RankMover; faller?: RankMover },
  isDynasty: boolean
): string {
  const topName = nameById[ranked[0]?.userId] ?? "Unknown Team";
  const { riser, faller } = movers;

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

  // Dynasty-only: the long view actually exists here (real future assets
  // to build around), so a bottom-tier team is a rebuild story, not just
  // a bad week - a distinction that means nothing in a redraft league.
  let trajectoryLine = "";
  if (isDynasty) {
    const bottom = ranked[ranked.length - 1];
    if (bottom && bottom.tier === "Rebuild" && bottom.userId !== ranked[0]?.userId) {
      trajectoryLine = pick([
        ` On the other end, ${nameById[bottom.userId] ?? "Unknown Team"} profiles as a true rebuild right now - the long view (youth, picks) matters more than this year's record.`,
        ` Meanwhile ${nameById[bottom.userId] ?? "Unknown Team"} is in rebuild mode - this season's record is secondary to the assets being stockpiled.`,
      ]);
    }
  }

  return header + riserLine + fallerLine + trajectoryLine;
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
    const movers = findMovers(ranked, nameById, lastWeekRanks);
    const text = powerRankMovementText(currentWeek, ranked, nameById, movers, settings.isDynasty);

    const topId = ranked[0]?.userId;
    const analystCard: AnalystCard = {
      eyebrow: `POWER RANKINGS · WEEK ${currentWeek}`,
      rows: [
        { name: nameById[topId] ?? "Unknown Team", avatar: sim.managerInfo[topId]?.avatar, stat: "#1", highlight: true },
        ...(movers.riser
          ? [{ name: movers.riser.name, avatar: sim.managerInfo[movers.riser.userId]?.avatar, stat: `+${movers.riser.delta}`, statLabel: "UP" }]
          : []),
        ...(movers.faller
          ? [{ name: movers.faller.name, avatar: sim.managerInfo[movers.faller.userId]?.avatar, stat: `${movers.faller.delta}`, statLabel: "DOWN" }]
          : []),
      ],
    };

    await ensureSystemPost({
      id: postId,
      text,
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `powerrank:wk${currentWeek}`,
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
    let best:
      | { aId: string; bId: string; firstWeek: number; marginPts: number; aFirstPts: number; bFirstPts: number; winnerId: string; matchupId?: string }
      | null = null;

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
        const winnerId = myPts >= oppPts ? userId : oppId;

        // The closest of the week's rematches is the most compelling story to lead with.
        if (!best || marginPts < best.marginPts) {
          best = {
            aId: userId,
            bId: oppId,
            firstWeek: w,
            marginPts,
            aFirstPts: myPts,
            bFirstPts: oppPts,
            winnerId,
            matchupId: sim.matchupData[currentWeek]?.[userId]?.matchup_id,
          };
        }
        break; // only the most recent prior meeting matters
      }
    }

    if (!best) return;

    const analystCard: AnalystCard = {
      eyebrow: "REMATCH ALERT",
      rows: [
        { name: nameOf(sim, best.aId), avatar: sim.managerInfo[best.aId]?.avatar, stat: best.aFirstPts.toFixed(1), statLabel: `WK${best.firstWeek}`, highlight: best.aId === best.winnerId },
        { name: nameOf(sim, best.bId), avatar: sim.managerInfo[best.bId]?.avatar, stat: best.bFirstPts.toFixed(1), statLabel: `WK${best.firstWeek}`, highlight: best.bId === best.winnerId },
      ],
      footer: `Rematch in Week ${currentWeek}`,
    };

    await ensureSystemPost({
      id: `rematch_${leagueId}_wk${currentWeek}`,
      text: rematchAlertText(nameOf(sim, best.aId), nameOf(sim, best.bId), currentWeek, best.firstWeek, best.marginPts, nameOf(sim, best.winnerId)),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: best.matchupId ? `rematch:${currentWeek}:${best.matchupId}` : `rematch:wk${currentWeek}`,
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

    const matchupId = sim.matchupData[targetWeek]?.[best.loserId]?.matchup_id;

    const analystCard: AnalystCard = {
      eyebrow: "BENCH REGRET",
      rows: [
        { name: nameOf(sim, best.loserId), avatar: sim.managerInfo[best.loserId]?.avatar, stat: `-${best.benchPointsLeft.toFixed(1)}`, statLabel: "LEFT ON BENCH", highlight: true },
        { name: nameOf(sim, best.winnerId), avatar: sim.managerInfo[best.winnerId]?.avatar, stat: best.oppPts.toFixed(1), statLabel: "FINAL" },
      ],
      footer: best.snub ? `${best.snub.name} (${best.snub.points.toFixed(1)} pts) never left the bench` : `Week ${targetWeek}`,
    };

    await ensureSystemPost({
      id: `benchregret_${leagueId}_wk${targetWeek}`,
      text: benchRegretText(nameOf(sim, best.loserId), nameOf(sim, best.winnerId), targetWeek, best.benchPointsLeft, best.oppPts, best.snub),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: matchupId ? `benchregret:${targetWeek}:${matchupId}` : `benchregret:wk${targetWeek}`,
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
    const { asset, team } = best.event;
    if (!team.userId) return; // no real manager to link the post's target to

    const playerAvatar = asset.id
      ? asset.pos === "DEF"
        ? `https://sleepercdn.com/images/team_logos/nfl/${asset.id.toLowerCase()}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${asset.id}.jpg`
      : undefined;

    const analystCard: AnalystCard = {
      eyebrow: "WAIVER WIRE",
      rows: [{ name: asset.label, avatar: playerAvatar, stat: asset.pos ?? "", statLabel: "ADDED", highlight: true }],
      footer: `Added by ${team.name}`,
    };

    await ensureSystemPost({
      id: postId,
      text: waiverHeadlinerText(team.name, asset.label, asset.pos),
      analystCard,
      leagueId,
      targetType: "waiver",
      // The Trades tab has nowhere to show a waiver move - link straight to
      // the acquiring manager's profile instead (see postNavigation.ts).
      targetId: team.userId,
      targetLabel: `${team.name} waiver move`,
    });
  } catch (error) {
    console.error("Error posting waiver headliner:", error);
  }
}

// ---------------------------------------------------------------------
// Roster Watch (Team Needs) - the league's single most glaring positional
// hole this week, using the exact same value-based need engine the Trade
// Calculator already trusts: dynasty leagues reason off real KTC asset
// value (a real long-term hole, not just a thin bench), redraft leagues
// off season-to-date-blended-with-rest-of-season PPG (what actually
// matters when there's no next season to build for).
// ---------------------------------------------------------------------

function teamNeedsText(teamName: string, pos: PlayerPos, pct: number, isDynasty: boolean): string {
  const magnitude = pct >= 0.6 ? "a gaping hole" : pct >= 0.35 ? "a real hole" : "a soft spot";
  const horizon = isDynasty ? "long-term" : "the rest of this season";
  return pick([
    `🔍 Roster Watch: ${teamName} has ${magnitude} at ${pos} - ${Math.round(pct * 100)}% below the league's own bar there, ${horizon}.`,
    `🔍 Digging into the numbers: ${teamName}'s ${pos} spot is ${magnitude}, sitting ${Math.round(pct * 100)}% below where the rest of the league is.`,
    `🔍 Biggest need in the league right now: ${teamName} at ${pos}. ${Math.round(pct * 100)}% below the league bar there - worth watching on the wire.`,
  ]);
}

/** posts once per week - the single most extreme value-based need leaguewide, dynasty or redraft aware (same branch the Trade Calculator itself uses). Checks postExists first since pricing every roster (KTC values for dynasty, season PPG for redraft) is real work. */
export async function ensureTeamNeedsPost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  const postId = `teamneeds_${leagueId}_wk${currentWeek}`;
  try {
    if (await postExists(postId)) return;

    const settings = await getLeagueValueSettings(leagueId);
    const playersData = await backend.fetchPlayers(leagueId);

    let worst: { userId: string; pos: PlayerPos; score: number } | null = null;

    if (settings.isDynasty) {
      const valuesBySleeperId = await backend.fetchAllPlayerValues();
      const leagueAvg = computeLeagueNeedBaseline(sim.managerInfo, playersData, valuesBySleeperId, settings);
      for (const userId of sim.teamIds) {
        const needs = computeTeamNeeds(sim.managerInfo[userId].rosterPlayerIds, playersData, valuesBySleeperId, settings, leagueAvg);
        if (!worst || needs.biggest.score > worst.score) worst = { userId, pos: needs.biggest.pos, score: needs.biggest.score };
      }
    } else {
      const playedWeeks = sim.weekNumbers.filter((w) => w < currentWeek);
      const remainingWeeks = sim.weekNumbers.filter((w) => w >= currentWeek);
      const seasonToDatePPG = buildSeasonToDatePPG(sim.matchupData, playedWeeks);
      const leagueAvg = computeLeagueRedraftNeedBaseline(sim.managerInfo, playersData, seasonToDatePPG, remainingWeeks);
      for (const userId of sim.teamIds) {
        const needs = computeRedraftTeamNeeds(sim.managerInfo[userId].rosterPlayerIds, playersData, seasonToDatePPG, remainingWeeks, leagueAvg);
        if (!worst || needs.biggest.score > worst.score) worst = { userId, pos: needs.biggest.pos, score: needs.biggest.score };
      }
    }

    // A near-zero score means every team's roughly balanced - not a real story.
    if (!worst || worst.score < 0.2) return;

    const analystCard: AnalystCard = {
      eyebrow: "ROSTER WATCH",
      rows: [
        {
          name: nameOf(sim, worst.userId),
          avatar: sim.managerInfo[worst.userId]?.avatar,
          stat: worst.pos,
          statLabel: "BIGGEST NEED",
          highlight: true,
        },
      ],
      footer: `${Math.round(worst.score * 100)}% below league average`,
    };

    await ensureSystemPost({
      id: postId,
      text: teamNeedsText(nameOf(sim, worst.userId), worst.pos, worst.score, settings.isDynasty),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `teamneeds:wk${currentWeek}`,
      targetLabel: "Roster Watch",
    });
  } catch (error) {
    console.error("Error posting team needs:", error);
  }
}

// ---------------------------------------------------------------------
// Key Matchups - a real Week X preview, off the same projected-lineup
// numbers Schedule's own favorite/spread and O/U callouts use: the
// closest projected game (a real pick'em) and the highest-scoring
// projected shootout, picked out of every real pairing this week.
// ---------------------------------------------------------------------

function keyMatchupsText(week: number, closestA: string, closestB: string, spread: number, shootoutA: string, shootoutB: string, total: number): string {
  const spreadBit = spread < 1 ? "a true pick'em" : `a razor-thin ${spread.toFixed(1)}-point projected spread`;
  return pick([
    `📋 Key matchups, Week ${week}: keep an eye on ${closestA} vs. ${closestB} - ${spreadBit}. Elsewhere, ${shootoutA} vs. ${shootoutB} projects as the week's shootout, combined O/U of ${Math.round(total)}.`,
    `📋 Setting the table for Week ${week}: ${closestA}-${closestB} is this week's coin flip (${spreadBit}), while ${shootoutA}-${shootoutB} has shootout written all over it - O/U ${Math.round(total)}.`,
  ]);
}

/** posts once per week - purely off sim.projectionCache, already built for the week, so no new fetch. */
export async function ensureKeyMatchupsPost(leagueId: string, sim: LeagueSimData, currentWeek: number): Promise<void> {
  try {
    const seen = new Set<string>();
    const games: { aId: string; bId: string; spread: number; total: number }[] = [];

    for (const userId of sim.teamIds) {
      if (seen.has(userId)) continue;
      const oppId = findOpponent(sim, currentWeek, userId);
      if (!oppId || seen.has(oppId)) continue;
      seen.add(userId);
      seen.add(oppId);

      const aProj = sim.projectionCache[currentWeek]?.[userId] ?? 0;
      const bProj = sim.projectionCache[currentWeek]?.[oppId] ?? 0;
      games.push({ aId: userId, bId: oppId, spread: Math.abs(aProj - bProj), total: aProj + bProj });
    }

    if (games.length === 0) return;

    const closest = games.reduce((a, b) => (b.spread < a.spread ? b : a));
    const shootout = games.reduce((a, b) => (b.total > a.total ? b : a));

    const analystCard: AnalystCard = {
      eyebrow: `KEY MATCHUPS · WEEK ${currentWeek}`,
      rows: [
        {
          name: `${nameOf(sim, closest.aId)} vs ${nameOf(sim, closest.bId)}`,
          avatar: sim.managerInfo[closest.aId]?.avatar,
          stat: closest.spread < 1 ? "PICK'EM" : `-${closest.spread.toFixed(1)}`,
          statLabel: "CLOSEST",
          highlight: true,
        },
        {
          name: `${nameOf(sim, shootout.aId)} vs ${nameOf(sim, shootout.bId)}`,
          avatar: sim.managerInfo[shootout.aId]?.avatar,
          stat: Math.round(shootout.total).toString(),
          statLabel: "O/U SHOOTOUT",
        },
      ],
    };

    await ensureSystemPost({
      id: `keymatchups_${leagueId}_wk${currentWeek}`,
      text: keyMatchupsText(
        currentWeek,
        nameOf(sim, closest.aId),
        nameOf(sim, closest.bId),
        closest.spread,
        nameOf(sim, shootout.aId),
        nameOf(sim, shootout.bId),
        shootout.total
      ),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `keymatchups:wk${currentWeek}`,
      targetLabel: "Key Matchups",
    });
  } catch (error) {
    console.error("Error posting key matchups:", error);
  }
}

// ---------------------------------------------------------------------
// Hot Seat Watch - a genuinely rare, real storyline: a manager with a
// bad career win rate in this league (2+ seasons of real history, off
// getManagerHistory's own multi-season crawl - the same one the League
// History page runs) who's ALSO off to a losing start again this year.
// Posts once per season, only when someone actually qualifies - most
// seasons, for most leagues, this never fires, which is exactly right
// for a story this pointed.
// ---------------------------------------------------------------------

function hotSeatText(name: string, careerWinPct: number, wins: number, losses: number, seasonsPlayed: number): string {
  const pct = Math.round(careerWinPct * 100);
  return pick([
    `🔥 Hot seat watch: ${name} is off to a rough ${wins}-${losses} start, and it's not exactly new territory - a career ${pct}% win rate across ${seasonsPlayed} seasons in this league. The questions are starting.`,
    `🔥 The seat's warming up for ${name} - ${wins}-${losses} this year extends a rough stretch, a ${pct}% career win rate over ${seasonsPlayed} seasons.`,
    `🔥 ${name} has some explaining to do: ${wins}-${losses} so far, on top of a ${pct}% career win rate across ${seasonsPlayed} seasons here. The patience is wearing thin.`,
  ]);
}

/** posts once per SEASON per league (not weekly - re-litigating this every week would be mean, not analysis), only if a real manager qualifies: 2+ seasons in this league, a losing career win rate, AND a losing record again this year. Checks postExists first since getManagerHistory is a full multi-season crawl (the same cost the League History page pays). */
export async function ensureHotSeatPost(leagueId: string, sim: LeagueSimData, season: string): Promise<void> {
  const postId = `hotseat_${leagueId}_${season}`;
  try {
    if (await postExists(postId)) return;

    const history = await getManagerHistory(leagueId);

    let worst: { userId: string; winPct: number; seasonsPlayed: number } | null = null;
    for (const userId of sim.teamIds) {
      const stats = history[userId];
      if (!stats || stats.seasonsPlayed < 2 || stats.winPct >= 0.45) continue;
      const wins = parseInt((sim.managerInfo[userId]?.wins as any) || "0", 10);
      const losses = parseInt((sim.managerInfo[userId]?.losses as any) || "0", 10);
      if (losses <= wins) continue; // not currently struggling too - no real "hot seat" story without a bad start to go with the bad history
      if (!worst || stats.winPct < worst.winPct) worst = { userId, winPct: stats.winPct, seasonsPlayed: stats.seasonsPlayed };
    }

    if (!worst) return;

    const wins = parseInt((sim.managerInfo[worst.userId]?.wins as any) || "0", 10);
    const losses = parseInt((sim.managerInfo[worst.userId]?.losses as any) || "0", 10);

    const analystCard: AnalystCard = {
      eyebrow: "HOT SEAT WATCH",
      rows: [
        {
          name: nameOf(sim, worst.userId),
          avatar: sim.managerInfo[worst.userId]?.avatar,
          stat: `${Math.round(worst.winPct * 100)}%`,
          statLabel: "CAREER WIN%",
          highlight: true,
        },
      ],
      footer: `${wins}-${losses} this season · ${worst.seasonsPlayed} seasons in the league`,
    };

    await ensureSystemPost({
      id: postId,
      text: hotSeatText(nameOf(sim, worst.userId), worst.winPct, wins, losses, worst.seasonsPlayed),
      analystCard,
      leagueId,
      targetType: "analysis",
      targetId: `hotseat:${season}`,
      targetLabel: "Hot Seat Watch",
    });
  } catch (error) {
    console.error("Error posting hot seat watch:", error);
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
    const season = nflState.season || nflState.league_season;
    const tradeEvents = events.filter((e): e is TradeEvent => e.kind === "trade2" || e.kind === "tradeMulti");

    await Promise.all([
      ensureScheduleStorylinePost(leagueId, sim, week),
      ensurePlayoffPicturePost(leagueId, sim, week),
      ensureTradeGradePosts(leagueId, tradeEvents),
      ensurePowerRankingsMovementPost(leagueId, sim, week),
      ensureRematchAlertPost(leagueId, sim, week),
      ensureBenchRegretPost(leagueId, sim, week),
      ensureWaiverHeadlinerPost(leagueId, events, week),
      ensureTeamNeedsPost(leagueId, sim, week),
      ensureKeyMatchupsPost(leagueId, sim, week),
      ...(season ? [ensureHotSeatPost(leagueId, sim, String(season))] : []),
    ]);
  } catch (error) {
    console.error("Error running Boogie's analyst pass:", error);
  }
}
